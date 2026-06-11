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

  const t0 = Date.now();

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
    const tCustomer = Date.now();
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

    console.log(`[carrier] Customer fetch: ${Date.now() - tCustomer}ms`);

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
  const tScenario = Date.now();
  const result = await findAllMatchingScenarios(shopDomain, cartData);
  console.log(`[carrier] Scenario matching: ${Date.now() - tScenario}ms`);

  if (!result) {
    console.log("[carrier] No matching scenario — returning no rates");
    console.log(`[carrier] ✓ Total response time: ${Date.now() - t0}ms`);
    return Response.json({ rates: [] });
  }

  const { zones, isFallback } = result;
  console.log(`[carrier] ${zones.length} scenario(s) matched${isFallback ? " [FALLBACK]" : ""}: ${zones.map(z => `"${z.name}"`).join(", ")}`);

  // 6. Collect ALL applicable rates from ALL matching scenarios.
  //    When multiple scenarios match, return the HIGHEST-PRICED rate.
  const allRates = [];

  for (const zone of zones) {
    for (const rate of zone.rates) {
      const val = rate.type === "weight" ? totalWeightKg : totalDollars;
      if (val < rate.minValue || (rate.maxValue != null && val > rate.maxValue)) continue;

      const dollarPrice = rate.valueType === "percentage"
        ? totalDollars * (rate.price / 100)
        : rate.price;

      // Build delivery text: "Delivered in X to Y days" or "Delivered in X days"
      let deliveryText = "";
      if (rate.minDeliveryDays != null && rate.maxDeliveryDays != null) {
        deliveryText = `Delivered in ${rate.minDeliveryDays} to ${rate.maxDeliveryDays} days`;
      } else if (rate.minDeliveryDays != null) {
        deliveryText = `Delivered in ${rate.minDeliveryDays} days`;
      } else if (rate.maxDeliveryDays != null) {
        deliveryText = `Delivered in up to ${rate.maxDeliveryDays} days`;
      }

      // Combine merchant description + delivery text (separated by space if both exist)
      const description = [rate.description, deliveryText].filter(Boolean).join(" · ");

      allRates.push({
        service_name:      rate.name,
        service_code:      `scenario_rate_${rate.id}`,
        total_price:       Math.round(dollarPrice * 100),
        description,
        scenario:          zone.name,
        min_delivery_date: null,   // using description text instead of exact dates
        max_delivery_date: null,
      });
    }
  }

  if (allRates.length === 0) {
    console.log("[carrier] No rates match the cart criteria");
    console.log(`[carrier] ✓ Total response time: ${Date.now() - t0}ms`);
    return Response.json({ rates: [] });
  }

  // Pick the single highest-priced rate across all matching scenarios
  const highestRate = allRates.reduce((best, r) =>
    r.total_price > best.total_price ? r : best
  );

  console.log(
    `[carrier] Highest rate: "${highestRate.service_name}" ` +
    `$${(highestRate.total_price / 100).toFixed(2)} ` +
    `(from scenario "${highestRate.scenario}")`
  );

  const finalRates = [{
    service_name:      highestRate.service_name,
    service_code:      highestRate.service_code,
    total_price:       highestRate.total_price.toString(),
    description:       highestRate.description,
    currency,
    min_delivery_date: highestRate.min_delivery_date,
    max_delivery_date: highestRate.max_delivery_date,
  }];
   
  console.log(`[carrier] Returning ${finalRates.length} rate(s)`);
  console.log(`[carrier] ✓ Total response time: ${Date.now() - t0}ms`);
  return Response.json({ rates: finalRates });
};