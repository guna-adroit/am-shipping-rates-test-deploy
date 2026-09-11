// ─────────────────────────────────────────────────────────────────────────────
// FedEx live rates — Sandbox OAuth (client_credentials) + Rate v1 quotes API.
// Mirrors the flow verified via Postman:
//   1. POST https://apis-sandbox.fedex.com/oauth/token
//   2. POST https://apis-sandbox.fedex.com/rate/v1/rates/quotes
//
// NOTE: only sandbox credentials are supported right now
// (https://apis-sandbox.fedex.com). Point BASE_URL at
// https://apis.fedex.com once production FedEx credentials are available.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://apis-sandbox.fedex.com";

export async function getFedexToken({ apiKey, secretKey }) {
  if (!apiKey || !secretKey) {
    throw new Error("FedEx API Key and Secret Key are required.");
  }

  const response = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: secretKey,
    }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.access_token) {
    const message = json.errors?.[0]?.message || json.error_description || `FedEx auth failed (${response.status})`;
    throw new Error(message);
  }

  return json.access_token;
}

/**
 * Validate credentials by requesting a token. Used by the "Sync" button.
 */
export async function testFedexCredentials(credentials) {
  await getFedexToken(credentials);
  return { ok: true };
}

/**
 * Request live rate quotes from FedEx.
 *
 * @param {object} credentials  { apiKey, secretKey, accountNumber }
 * @param {object} params
 *   origin:      { postalCode, countryCode }
 *   destination: { postalCode, countryCode }
 *   weightLb:    number  — total shipment weight in pounds
 *   serviceCodes: string[] — FedEx serviceType codes to filter to (optional)
 * @returns {Promise<Array<{ serviceCode, serviceName, amount, currency, transitTime }>>}
 */
export async function fetchFedexRates(credentials, params) {
  const token = await getFedexToken(credentials);
  const { origin, destination, weightLb, serviceCodes } = params;

  const body = {
    accountNumber: { value: credentials.accountNumber },
    requestedShipment: {
      shipper: { address: { postalCode: origin.postalCode, countryCode: origin.countryCode } },
      recipient: { address: { postalCode: destination.postalCode, countryCode: destination.countryCode } },
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      rateRequestType: ["ACCOUNT", "LIST"],
      requestedPackageLineItems: [
        { weight: { units: "LB", value: Math.max(weightLb || 1, 0.1) } },
      ],
    },
  };

  const response = await fetch(`${BASE_URL}/rate/v1/rates/quotes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = json.errors?.[0]?.message || `FedEx rate request failed (${response.status})`;
    throw new Error(message);
  }

  const rateDetails = json.output?.rateReplyDetails ?? [];

  let rates = rateDetails.map((detail) => {
    const shipmentDetail =
      detail.ratedShipmentDetails?.find((r) => r.rateType === "ACCOUNT") ??
      detail.ratedShipmentDetails?.[0];
    const totalNetCharge = shipmentDetail?.totalNetCharge ?? shipmentDetail?.totalNetFedExCharge ?? 0;
    const currency = shipmentDetail?.currency ?? "USD";

    return {
      serviceCode: detail.serviceType,
      serviceName: detail.serviceName || detail.serviceType,
      amount: Number(totalNetCharge) || 0,
      currency,
      transitTime: detail.commit?.transitTime || detail.operationalDetail?.transitTime || null,
    };
  });

  if (Array.isArray(serviceCodes) && serviceCodes.length > 0) {
    rates = rates.filter((r) => serviceCodes.includes(r.serviceCode));
  }

  return rates;
}
