/**
 * PUBLIC ROUTE — no Shopify session auth.
 * Shopify POSTs here at checkout to retrieve shipping rates.
 *
 * Path:   /carrier-service
 * Header: X-Shopify-Shop-Domain: storename.myshopify.com
 * Body:   { rate: { origin, destination, items, currency } }
 */
import db from "../db.server";
import { findAllMatchingScenarios } from "../models/zone.server";

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

  // 5. Find ALL matching scenarios
  const result = await findAllMatchingScenarios(shopDomain, cartData);

  if (!result) {
    console.log("[carrier] No matching scenario — returning no rates");
    return Response.json({ rates: [] });
  }

  const { zones, isFallback } = result;
  console.log(`[carrier] ${zones.length} scenario(s) matched${isFallback ? " [FALLBACK]" : ""}: ${zones.map(z => `"${z.name}"`).join(", ")}`);

  // 6. Collect ALL applicable rates from ALL matching scenarios
  //    "Applicable" = rate's min/max range covers the current cart value
  //
  //    When multiple scenarios match, we return the HIGHEST-PRICED rate
  //    per service name — so the more specific/expensive rule always wins.
  //    (e.g. Scenario A: Standard $20, Scenario B: Standard $30 → show $30)

  const allRates = [];

  for (const zone of zones) {
    for (const rate of zone.rates) {
      const val = rate.type === "weight" ? totalWeightKg : totalDollars;
      if (val < rate.minValue || (rate.maxValue != null && val > rate.maxValue)) {
        continue; // rate's range doesn't cover this cart
      }

      const dollarPrice = rate.valueType === "percentage"
        ? totalDollars * (rate.price / 100)
        : rate.price;

      allRates.push({
        service_name: rate.name,
        service_code: `scenario_rate_${rate.id}`,
        total_price:  Math.round(dollarPrice * 100),   // keep as number for comparison
        description:  rate.description ?? "",
        scenario:     zone.name,
      });
    }
  }

  if (allRates.length === 0) {
    console.log("[carrier] No rates match the cart criteria");
    return Response.json({ rates: [] });
  }

  // Per service_name: keep only the HIGHEST total_price across all matching scenarios
  const highestByName = new Map();
  for (const rate of allRates) {
    const existing = highestByName.get(rate.service_name);
    if (!existing || rate.total_price > existing.total_price) {
      highestByName.set(rate.service_name, rate);
    }
  }

  const finalRates = [...highestByName.values()].map((rate) => ({
    service_name:      rate.service_name,
    service_code:      rate.service_code,
    total_price:       rate.total_price.toString(),
    description:       rate.description,
    currency,
    min_delivery_date: null,
    max_delivery_date: null,
  }));

  if (zones.length > 1) {
    for (const [name, rate] of highestByName) {
      console.log(`[carrier] "${name}": highest rate = $${(rate.total_price / 100).toFixed(2)} (from scenario "${rate.scenario}")`);
    }
  }

  console.log(`[carrier] Returning ${finalRates.length} rate(s)`);
  return Response.json({ rates: finalRates });
};