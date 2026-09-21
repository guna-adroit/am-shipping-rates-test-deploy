// ─────────────────────────────────────────────────────────────────────────────
// Canada Post live rates — API Gateway OAuth (client_credentials, IBM API
// Connect style) + Rating v1 /prices endpoint.
// Verified via Postman:
//   1. POST https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/cpc-api-native-oauth-provider/oauth2/token
//      headers: X-IBM-Client-Id, X-IBM-Client-Secret
//      body (x-www-form-urlencoded): scope=merchant&grant_type=client_credentials
//   2. POST https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/rating/v1/prices
//      headers: Authorization: Bearer <token>, X-IBM-Client-Id
//      body (json): customerNumber, contractId, parcelCharacteristics, services, originPostalCode, destination
// ─────────────────────────────────────────────────────────────────────────────

const OAUTH_URL =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/cpc-api-native-oauth-provider/oauth2/token";
const RATES_URL =
  "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/rating/v1/prices";

/** Strips spaces/dashes so "T5L 3B0" → "T5L3B0", as the API expects. */
function cleanPostalCode(zip) {
  return (zip || "").replace(/[\s-]/g, "").toUpperCase();
}

export async function getCanadaPostToken({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) {
    throw new Error("Canada Post Client Id and Client Secret are required.");
  }

  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "X-IBM-Client-Id": clientId,
      "X-IBM-Client-Secret": clientSecret,
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ scope: "merchant", grant_type: "client_credentials" }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.access_token) {
    const message = json.error_description || json.error || `Canada Post auth failed (${response.status})`;
    throw new Error(message);
  }

  return json.access_token;
}

/**
 * Validate credentials by requesting a token. Used by the "Sync" button.
 */
export async function testCanadaPostCredentials(credentials) {
  await getCanadaPostToken(credentials);
  return { ok: true };
}

/**
 * Request live rate quotes from Canada Post.
 *
 * @param {object} credentials  { clientId, clientSecret, customerNumber, contractId }
 * @param {object} params
 *   origin:      { postalCode, countryCode }
 *   destination: { postalCode, countryCode }
 *   weightKg:    number — total shipment weight in kilograms
 *   dimensions:  { length, width, height } in cm (optional — a reasonable
 *                default is used if not supplied; Canada Post's schema wants
 *                *some* dimensions even though only weight really drives most
 *                domestic parcel rates)
 *   serviceCodes: string[] — Canada Post service codes to request (optional;
 *                omit to let Canada Post return every service it can quote)
 * @returns {Promise<Array<{ serviceCode, serviceName, amount, currency, transitTime, deliveryDate }>>}
 */
export async function fetchCanadaPostRates(credentials, params) {
  const token = await getCanadaPostToken(credentials);
  const { origin, destination, weightKg, dimensions, serviceCodes } = params;

  // Canada Post's /prices endpoint only quotes domestic (Canada→Canada) and
  // Canada→international lanes from a Canadian origin. If either side isn't
  // Canada, there's nothing sensible to request here.
  if (origin.countryCode !== "CA") {
    throw new Error("Canada Post rates require a Canadian origin address.");
  }

  const body = {
    customerNumber: credentials.customerNumber,
    ...(credentials.contractId ? { contractId: credentials.contractId } : {}),
    quoteType: "commercial",
    parcelCharacteristics: {
      weight: Math.max(Number(weightKg) || 0.5, 0.1),
      dimensions: {
        length: dimensions?.length || 20,
        width:  dimensions?.width  || 15,
        height: dimensions?.height || 10,
      },
      unpackaged: false,
      mailingTube: false,
      oversized: false,
    },
    ...(Array.isArray(serviceCodes) && serviceCodes.length > 0 ? { services: serviceCodes } : {}),
    originPostalCode: cleanPostalCode(origin.postalCode),
    destination: destination.countryCode === "CA"
      ? { domestic: { postalCode: cleanPostalCode(destination.postalCode) } }
      : { international: { countryCode: destination.countryCode } },
  };

  const response = await fetch(RATES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-IBM-Client-Id": credentials.clientId,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json?.messages?.[0]?.description || json?.message || `Canada Post rate request failed (${response.status})`;
    throw new Error(message);
  }

  // The /prices response is a plain array of rate objects (not wrapped).
  const rateList = Array.isArray(json) ? json : (json.prices ?? []);

  return rateList.map((rate) => ({
    serviceCode: rate.serviceCode,
    serviceName: rate.serviceName || rate.serviceCode,
    amount: Number(rate.priceDetails?.due) || 0,
    currency: "CAD",
    transitTime: rate.serviceStandard?.expectedTransitTime ?? null,
    deliveryDate: rate.serviceStandard?.expectedDeliveryDate ?? null,
  }));
}