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
import { getCarrierCredential } from "../models/liveCarrierRate.server";
import { getCarrier } from "../carriers/definitions";
import { fetchRates as fetchLiveCarrierRates } from "../carriers/index.server";

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY testing fallback — used only if the shop's location(s) and
// store address both come back without a usable zip/country (e.g. while the
// `read_locations` scope hasn't been accepted by the store yet). Lets you
// confirm the FedEx live-rate call itself works end-to-end before the real
// origin lookup is fixed. Remove this block once getShopOriginAddress()
// reliably resolves a real origin.
// ─────────────────────────────────────────────────────────────────────────────
const TEMP_FALLBACK_ORIGIN = {
  postalCode: process.env.LIVE_CARRIER_TEST_ORIGIN_ZIP || "T5L3B0",
  countryCode: process.env.LIVE_CARRIER_TEST_ORIGIN_COUNTRY || "CA",
};

/**
 * Resolves the "origin" address for live carrier rate requests.
 *
 * A shop can have multiple Locations (Settings → Locations) — POS-only
 * locations, warehouses, etc. — so we can't just grab the first one.
 * Priority:
 *   1) The location that actually fulfills online orders (fulfillsOnlineOrders)
 *      and has a complete address — this is the one checkout ships from.
 *   2) Any other location with a complete address, as a fallback.
 *   3) The shop's general Store details address (Settings → General —
 *      `shop.shopAddress` (the Admin API's replacement for the now-
 *      deprecated `shop.billingAddress`), the Admin API equivalent of the Liquid
 *      `shop.address` fields: https://shopify.dev/docs/api/liquid/objects/shop).
 *
 * NOTE: reading locations requires the `read_locations` access scope. If the
 * app was installed before that scope was added, this falls through to the
 * store address and logs a reminder to reinstall / accept the updated scopes.
 */
async function getShopOriginAddress(shopDomain) {
  const session = await db.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    select: { accessToken: true },
  });
  if (!session?.accessToken) {
    console.warn(`[carrier:live] No offline session token for ${shopDomain} — cannot resolve origin address`);
    return null;
  }

  const graphql = async (query) => {
    const resp = await fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const json = await resp.json().catch(() => ({}));
    return { ok: resp.ok, json };
  };

  // ── 1) & 2): Locations — issued as its own request so an ACCESS_DENIED
  // error here (missing `read_locations` scope) can't null out the shop query.
  try {
    const { ok, json } = await graphql(`{
      locations(first: 20) {
        edges {
          node {
            name
            isActive
            fulfillsOnlineOrders
            address { zip countryCode }
          }
        }
      }
    }`);

    if (!ok) {
      console.warn(`[carrier:live] Locations query failed: HTTP request error`);
    } else if (json.errors) {
      const accessDenied = json.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
      if (accessDenied) {
        console.warn(`[carrier:live] Locations query denied — the app is missing the "read_locations" scope. Add it to shopify.app.toml, run "shopify app deploy", and have the store owner reinstall/accept the updated scopes.`);
      } else {
        console.warn(`[carrier:live] Locations query errors: ${JSON.stringify(json.errors)}`);
      }
    } else {
      const locations = (json?.data?.locations?.edges ?? []).map((e) => e.node);
      const hasAddress = (loc) => loc?.address?.zip && loc?.address?.countryCode;

      const fulfillmentLocation = locations.find((loc) => loc.isActive && loc.fulfillsOnlineOrders && hasAddress(loc));
      if (fulfillmentLocation) {
        console.log(`[carrier:live] Using origin from location "${fulfillmentLocation.name}" (fulfills online orders): ${fulfillmentLocation.address.zip}, ${fulfillmentLocation.address.countryCode}`);
        return { postalCode: fulfillmentLocation.address.zip, countryCode: fulfillmentLocation.address.countryCode };
      }

      const anyLocation = locations.find((loc) => loc.isActive && hasAddress(loc));
      if (anyLocation) {
        console.log(`[carrier:live] Using origin from location "${anyLocation.name}" (fallback — no location is flagged as fulfilling online orders): ${anyLocation.address.zip}, ${anyLocation.address.countryCode}`);
        return { postalCode: anyLocation.address.zip, countryCode: anyLocation.address.countryCode };
      }
    }
  } catch (e) {
    console.error(`[carrier:live] Locations query threw: ${e.message}`);
  }

  // ── 3) Settings → General store address, as its own independent request.
  try {
    const { ok, json } = await graphql(`{ shop { shopAddress { zip countryCodeV2 } } }`);
    if (!ok) {
      console.warn(`[carrier:live] Shop address query failed: HTTP request error`);
    } else if (json.errors) {
      console.warn(`[carrier:live] Shop address query errors: ${JSON.stringify(json.errors)}`);
    } else {
      const shopAddress = json?.data?.shop?.shopAddress;
      if (shopAddress?.zip && shopAddress?.countryCodeV2) {
        console.log(`[carrier:live] Using shop store address as origin (fallback — no location has a complete address): ${shopAddress.zip}, ${shopAddress.countryCodeV2}`);
        return { postalCode: shopAddress.zip, countryCode: shopAddress.countryCodeV2 };
      }
    }
  } catch (e) {
    console.error(`[carrier:live] Shop address query threw: ${e.message}`);
  }

  console.warn(`[carrier:live] No location or store address has a zip/country set — live rates need a complete origin address. Set one under Settings → Locations, or Settings → General → Store details.`);
  console.warn(`[carrier:live] TEMP: using hardcoded testing origin ${TEMP_FALLBACK_ORIGIN.postalCode}, ${TEMP_FALLBACK_ORIGIN.countryCode} — remove TEMP_FALLBACK_ORIGIN in carrier-service.jsx once the real origin lookup works.`);
  return TEMP_FALLBACK_ORIGIN;
}

/**
 * Resolves live carrier rates for a zone into carrier-service rate entries.
 * Falls back to the merchant-configured flat fallback rate if the carrier
 * call fails, times out, or isn't implemented for that carrier yet.
 */
async function resolveLiveCarrierRates(shopDomain, zone, cartData, currency) {
  const results = [];
  const origin = await getShopOriginAddress(shopDomain);
  const destinationZip = (cartData.destination?.postal_code ?? "").trim();
  // Shopify's carrier-service payload uses `country` (a 2-letter code, e.g. "CA"),
  // NOT `country_code` — that field doesn't exist on the request at all, so reading
  // it silently fell back to "US" on every single request regardless of the
  // customer's actual address. That's why Canada Post rates were always taking the
  // "international" branch (wrong destination shape) instead of "domestic", and
  // always returning the same quote no matter which address was entered.
  const destinationCountry = cartData.destination?.country ?? "US";
  const weightKg = cartData.totalWeightKg;
  const weightLb = weightKg * 2.20462;

  console.log(`[carrier:live] origin=${origin ? `${origin.postalCode},${origin.countryCode}` : "null"} destination=${destinationZip},${destinationCountry} weightKg=${weightKg.toFixed(3)}`);

  for (const liveRate of zone.liveCarrierRates ?? []) {
    const carrier = getCarrier(liveRate.carrierKey);
    let services = [];
    try { services = JSON.parse(liveRate.services || "[]"); } catch { /* ignore */ }
    const serviceCodes = (carrier?.serviceCodeMap && services.length > 0)
      ? services.map((s) => carrier.serviceCodeMap[s]).filter(Boolean)
      : undefined;

    // Use the smallest configured package as the parcel dimensions, if any
    // were set up on this live rate (Packing measurements → Add package).
    let dimensions;
    try {
      const packages = JSON.parse(liveRate.packages || "[]");
      const first = packages[0];
      if (first) {
        dimensions = {
          length: Number(first.length) || undefined,
          width:  Number(first.width)  || undefined,
          height: Number(first.height) || undefined,
        };
      }
    } catch { /* ignore */ }

    let quotes = null;
    if (origin && destinationZip) {
      try {
        const credRecord = await getCarrierCredential(shopDomain, liveRate.carrierKey);
        if (credRecord) {
          const credentials = JSON.parse(credRecord.credentials);
          quotes = await fetchLiveCarrierRates(liveRate.carrierKey, credentials, {
            origin,
            destination: { postalCode: destinationZip, countryCode: destinationCountry },
            weightKg,
            weightLb,
            dimensions,
            serviceCodes,
          });
          console.log(`[carrier:live] ${liveRate.carrierKey}: ${quotes?.length ?? 0} quote(s) returned`);
        } else {
          console.warn(`[carrier:live] No saved credentials for carrier "${liveRate.carrierKey}" on ${shopDomain} — using fallback rate`);
        }
      } catch (e) {
        console.error(`[carrier:live] Live rate fetch failed for ${liveRate.carrierKey}: ${e.message}`);
      }
    } else {
      console.warn(`[carrier:live] Skipping live fetch for ${liveRate.carrierKey} — missing origin or destination zip`);
    }

    if (quotes && quotes.length > 0) {
      for (const q of quotes) {
        results.push({
          service_name: q.serviceName,
          service_code: `live_${liveRate.carrierKey}_${q.serviceCode}`,
          total_price: Math.round(q.amount * 100),
          description: liveRate.notes || "",
          currency: q.currency || currency,   // use the carrier's quoted currency, not the cart's
          scenario: zone.name,
          min_delivery_date: q.deliveryDate ?? null,
          max_delivery_date: q.deliveryDate ?? null,
        });
      }
    } else {
      // No live quotes — use the configured fallback rate (in the store's currency).
      results.push({
        service_name: liveRate.fallbackName || liveRate.name,
        service_code: `live_${liveRate.carrierKey}_fallback_${liveRate.id}`,
        total_price: Math.round((liveRate.fallbackRate || 0) * 100),
        description: liveRate.fallbackDescription || "",
        currency,
        scenario: zone.name,
        min_delivery_date: null,
        max_delivery_date: null,
      });
    }
  }

  return results;
}

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

  // 6. Collect applicable rates from ALL matching scenarios.
  //    - Live carrier rates: return EVERY quoted/fallback rate as-is, so the
  //      customer can choose between e.g. FedEx Ground / 2Day / Overnight.
  //    - Fixed (tiered) rates: keep prior behaviour — when multiple scenarios/
  //      tiers match, return only the single HIGHEST-PRICED one.
  const liveRates  = [];
  const fixedRates = [];

  for (const zone of zones) {
    console.log(`[carrier] Zone "${zone.name}": ${zone.liveCarrierRates?.length ?? 0} live carrier rate(s), ${zone.rates?.length ?? 0} fixed rate(s)`);

    if (zone.liveCarrierRates?.length > 0) {
      const liveResults = await resolveLiveCarrierRates(shopDomain, zone, cartData, currency);
      liveRates.push(...liveResults);
    }
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

      fixedRates.push({
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

  if (liveRates.length === 0 && fixedRates.length === 0) {
    console.log("[carrier] No rates match the cart criteria");
    console.log(`[carrier] ✓ Total response time: ${Date.now() - t0}ms`);
    return Response.json({ rates: [] });
  }

  // Pick the single highest-priced FIXED rate across all matching scenarios
  // (unchanged legacy behaviour). Live carrier rates are never collapsed.
  let selectedFixedRates = [];
  if (fixedRates.length > 0) {
    const highestFixed = fixedRates.reduce((best, r) => (r.total_price > best.total_price ? r : best));
    console.log(
      `[carrier] Highest fixed rate: "${highestFixed.service_name}" ` +
      `$${(highestFixed.total_price / 100).toFixed(2)} (from scenario "${highestFixed.scenario}")`
    );
    selectedFixedRates = [highestFixed];
  }

  const finalRates = [...liveRates, ...selectedFixedRates].map((r) => ({
    service_name:      r.service_name,
    service_code:      r.service_code,
    total_price:       Math.round(r.total_price).toString(),
    description:       r.description,
    currency:          r.currency || currency,
    min_delivery_date: r.min_delivery_date,
    max_delivery_date: r.max_delivery_date,
  }));

  console.log(`[carrier] Returning ${finalRates.length} rate(s): ${finalRates.map(r => `${r.service_name} ($${(Number(r.total_price) / 100).toFixed(2)})`).join(", ")}`);
  console.log(`[carrier] ✓ Total response time: ${Date.now() - t0}ms`);
  return Response.json({ rates: finalRates });
};