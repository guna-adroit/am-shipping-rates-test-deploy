/**
 * PUBLIC ROUTE — no Shopify session auth.
 * Shopify POSTs here at checkout to retrieve shipping rates.
 *
 * Path:   /carrier-service
 * Header: X-Shopify-Shop-Domain: storename.myshopify.com
 * Body:   { rate: { origin, destination, items, currency } }
 */
import db from "../db.server";
import { findMatchingScenario } from "../models/zone.server";

export const loader = async () => {
  return Response.json({ status: "Scenario-based Carrier Service active" });
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 1. Identify shop
  const shopDomain =
    request.headers.get("X-Shopify-Shop-Domain") ||
    "am-shipping-rates.myshopify.com";
  if (!shopDomain) {
    console.error("[carrier] Missing X-Shopify-Shop-Domain header");
    return Response.json({ error: "Missing shop domain" }, { status: 400 });
  }

  // 2. Verify shop has the app installed
  const carrierRecord = await db.carrierService.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!carrierRecord) {
    console.error(`[carrier] No carrier record for ${shopDomain}`);
    return Response.json({ rates: [] });
  }

  // 3. Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rateRequest = body?.rate;
  if (!rateRequest) return Response.json({ rates: [] });

  const destination    = rateRequest.destination ?? {};
  const zip            = (destination.postal_code ?? "").trim();
  const currency       = rateRequest.currency || "AUD";
  const items          = rateRequest.items ?? [];
  const customerRaw    = rateRequest.customer ?? null;   // { id, tags[] }

  console.log(`[carrier] Shop: ${shopDomain} | Zip: "${zip}" | Items: ${items.length} | Customer: ${customerRaw?.id ?? "guest"}`);

  // ── Fetch full customer details from Admin API ─────────────────────────────
  // The carrier request includes customer.id and customer.tags[], but the tags
  // array can be empty or stale in real Shopify requests. Always fetch the full
  // customer from the Admin API for accurate, up-to-date data.
  let customer = null;
  if (customerRaw?.id) {
    try {
      // Find the offline session access token for this shop.
      // Offline sessions (isOnline: false) have permanent access tokens — use these
      // for Admin API calls. The Session model has no updatedAt field, so no orderBy.
      const session = await db.session.findFirst({
        where:  { shop: shopDomain, isOnline: false },
        select: { accessToken: true },
      });

      if (!session?.accessToken) {
        console.warn(`[carrier] No session/access token found for ${shopDomain} — customer conditions will be skipped`);
      } else {
        const resp = await fetch(
          `https://${shopDomain}/admin/api/2024-01/customers/${customerRaw.id}.json`,
          { headers: { "X-Shopify-Access-Token": session.accessToken } }
        );

        if (!resp.ok) {
          console.warn(`[carrier] Admin API returned ${resp.status} for customer ${customerRaw.id}`);
        } else {
          const json = await resp.json();
          if (json.customer) {
            // Admin API returns tags as a comma-separated string e.g. "VIP, wholesale"
            // Convert to array for consistent evaluation
            const tagsRaw   = json.customer.tags ?? "";
            const tagsArray = typeof tagsRaw === "string"
              ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
              : (Array.isArray(tagsRaw) ? tagsRaw : []);

            customer = {
              ...json.customer,
              tags: tagsArray,
            };

            console.log(
              `[carrier] Customer ${customerRaw.id} fetched: ` +
              `email=${customer.email ?? "none"} | ` +
              `tags=[${tagsArray.join(", ")}]`
            );
          }
        }
      }
    } catch (e) {
      console.error(`[carrier] Failed to fetch customer ${customerRaw.id}: ${e.message}`);
    }

    // Fallback: if API fetch failed, use what the carrier request provided
    if (!customer && customerRaw) {
      const fallbackTags = Array.isArray(customerRaw.tags)
        ? customerRaw.tags
        : [];
      customer = { id: customerRaw.id, tags: fallbackTags };
      console.warn(`[carrier] Using carrier request fallback for customer ${customerRaw.id} | tags=[${fallbackTags.join(", ")}]`);
    }
  }

  // 4. Build cart data for condition evaluation
  const totalDollars  = items.reduce((s, i) => s + i.price * i.quantity, 0) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const totalWeightKg = items.reduce((s, i) => s + (i.grams ?? 0) * i.quantity, 0) / 1000;

  console.log(`[carrier] Cart: $${totalDollars.toFixed(2)} | qty:${totalQuantity} | ${totalWeightKg.toFixed(3)}kg`);

  const cartData = {
    zip,
    items,
    totalDollars,
    totalQuantity,
    totalWeightKg,
    destination,
    customer,          // null for guest checkouts
  };

  // 5. Find matching scenario
  const result = await findMatchingScenario(shopDomain, cartData);

  if (!result) {
    console.log("[carrier] No matching scenario — returning no rates");
    return Response.json({ rates: [] });
  }

  const { zone, isFallback } = result;
  console.log(`[carrier] Matched: "${zone.name}" (${zone.rates.length} rates)${isFallback ? " [FALLBACK]" : ""}`);

  if (zone.rates.length === 0) {
    return Response.json({ rates: [] });
  }

  // 6. Filter rates by min/max criteria and compute price
  const matchedRates = zone.rates
    .filter((rate) => {
      const val = rate.type === "weight" ? totalWeightKg : totalDollars;
      return val >= rate.minValue && (rate.maxValue == null || val <= rate.maxValue);
    })
    .map((rate) => {
      // percentage rates: price is % of cart total
      const dollarPrice = rate.valueType === "percentage"
        ? totalDollars * (rate.price / 100)
        : rate.price;
      return {
        service_name:      rate.name,
        service_code:      `scenario_rate_${rate.id}`,
        total_price:       Math.round(dollarPrice * 100).toString(),
        description:       rate.description ?? "",
        currency,
        min_delivery_date: null,
        max_delivery_date: null,
      };
    });

  console.log(`[carrier] Returning ${matchedRates.length} rate(s)`);
  return Response.json({ rates: matchedRates });
};