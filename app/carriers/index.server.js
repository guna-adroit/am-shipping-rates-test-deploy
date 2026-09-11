import { getCarrier } from "./definitions";
import { testFedexCredentials, fetchFedexRates } from "./fedex.server";

// ─────────────────────────────────────────────────────────────────────────────
// testCredentials — called by the "Sync" button in the credentials modal.
// Only FedEx does a real live check (OAuth token request) right now. Other
// carriers just confirm the required fields were filled in, are marked
// "unverified" in the DB, and will use the fallback rate at checkout until
// their live-rate APIs are wired up.
// ─────────────────────────────────────────────────────────────────────────────
export async function testCredentials(carrierKey, credentials) {
  const carrier = getCarrier(carrierKey);
  if (!carrier) throw new Error(`Unknown carrier: ${carrierKey}`);

  const missing = carrier.credentialFields
    .filter((f) => !f.optional && !credentials[f.name])
    .map((f) => f.label);
  if (missing.length > 0) {
    throw new Error(`Missing required field(s): ${missing.join(", ")}`);
  }

  if (carrierKey === "fedex") {
    await testFedexCredentials(credentials);
    return { verified: true };
  }

  // No live verification implemented for this carrier yet.
  return { verified: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchRates — called at checkout by /carrier-service to get live quotes.
// Returns null when live rates aren't available for this carrier (checkout
// then falls back to the merchant-configured flat fallback rate).
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchRates(carrierKey, credentials, params) {
  if (carrierKey === "fedex") {
    return fetchFedexRates(credentials, params);
  }
  return null;
}
