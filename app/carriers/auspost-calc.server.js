// ─────────────────────────────────────────────────────────────────────────────
// Australia Post — Postage Assessment Calculator (PAC) API.
// Docs: https://developers.auspost.com.au/apis/pac/spec
//
// Unlike FedEx/Canada Post, PAC needs no OAuth step — a single API key goes
// in the `AUTH-KEY` header on every request. Endpoints used:
//   Domestic:      GET /postage/parcel/domestic/service
//   International: GET /postage/parcel/international/service
// (no .json suffix needed — Accept: application/json is enough, verified
// against a real account)
// Both return a list of services with a price for the given parcel/route.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://digitalapi.auspost.com.au";

async function callPacApi(apiKey, path, searchParams) {
  const url = `${BASE_URL}${path}?${new URLSearchParams(searchParams).toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "AUTH-KEY": apiKey, "Accept": "application/json" },
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json?.error?.errorMessage || json?.error_description || `Australia Post request failed (${response.status})`;
    throw new Error(message);
  }
  return json;
}

/**
 * Validate the API key with a minimal real domestic quote (Sydney → Melbourne,
 * 1kg). Used by the "Sync" button.
 */
export async function testAusPostCredentials({ apiKey }) {
  if (!apiKey) throw new Error("Australia Post API Key is required.");
  await callPacApi(apiKey, "/postage/parcel/domestic/service", {
    from_postcode: "2000",
    to_postcode: "3000",
    length: "20",
    width: "15",
    height: "10",
    weight: "1",
  });
  return { ok: true };
}

/**
 * Request live rate quotes from Australia Post PAC.
 *
 * @param {object} credentials  { apiKey }
 * @param {object} params
 *   origin:      { postalCode, countryCode }
 *   destination: { postalCode, countryCode }
 *   weightKg:    number
 *   dimensions:  { length, width, height } in cm (defaults applied if absent)
 *   serviceCodes: string[] — optional filter of PAC service codes
 * @returns {Promise<Array<{ serviceCode, serviceName, amount, currency }>>}
 */
export async function fetchAusPostRates(credentials, params) {
  const { origin, destination, weightKg, dimensions, serviceCodes } = params;

  if (origin.countryCode !== "AU") {
    throw new Error("Australia Post PAC rates require an Australian origin address.");
  }

  const weight = Math.max(Number(weightKg) || 0.5, 0.1).toFixed(2);
  const length = String(dimensions?.length || 20);
  const width  = String(dimensions?.width  || 15);
  const height = String(dimensions?.height || 10);

  let json;
  if (destination.countryCode === "AU") {
    json = await callPacApi(credentials.apiKey, "/postage/parcel/domestic/service", {
      from_postcode: origin.postalCode,
      to_postcode:   destination.postalCode,
      length, width, height, weight,
    });
  } else {
    json = await callPacApi(credentials.apiKey, "/postage/parcel/international/service", {
      country_code: destination.countryCode,
      weight,
    });
  }

  // PAC returns a single object (not an array) when there's only one
  // matching service — normalize to an array either way.
  const raw = json?.services?.service;
  const serviceList = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  let rates = serviceList.map((svc) => ({
    serviceCode: svc.code,
    serviceName: svc.name || svc.code,
    amount: Number(svc.price) || 0,
    currency: "AUD",
  }));

  if (Array.isArray(serviceCodes) && serviceCodes.length > 0) {
    rates = rates.filter((r) => serviceCodes.includes(r.serviceCode));
  }

  return rates;
}