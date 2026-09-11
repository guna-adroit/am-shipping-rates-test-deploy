import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { getCarrier } from "../carriers/definitions";
import { testCredentials } from "../carriers/index.server";
import { upsertCarrierCredential, getCarrierCredential } from "../models/liveCarrierRate.server";

// POST /app/api/carrier-credentials
// body: { carrierKey, ...credentialFieldValues, ...extraToggleValues }
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const carrierKey = formData.get("carrierKey")?.toString();

  const carrier = getCarrier(carrierKey);
  if (!carrier) {
    return data({ ok: false, error: "Unknown carrier." }, { status: 400 });
  }

  const credentials = {};
  for (const field of carrier.credentialFields) {
    credentials[field.name] = formData.get(field.name)?.toString().trim() ?? "";
  }
  for (const toggle of carrier.extraToggles || []) {
    credentials[toggle.name] = formData.get(toggle.name) === "true";
  }

  let result;
  try {
    result = await testCredentials(carrierKey, credentials);
  } catch (e) {
    result = { verified: false, error: e.message };
  }

  await upsertCarrierCredential(session.shop, carrierKey, credentials, result);

  if (result.error) {
    return data({ ok: false, error: result.error, verified: false }, { status: 200 });
  }

  return data({
    ok: true,
    verified: result.verified,
    message: result.verified
      ? `${carrier.label} credentials verified successfully.`
      : `${carrier.label} credentials saved. Live sync isn't available for this carrier yet — the fallback rate will be used at checkout.`,
  });
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const carrierKey = url.searchParams.get("carrierKey");
  if (!carrierKey) return data({ credential: null });
  const record = await getCarrierCredential(session.shop, carrierKey);
  if (!record) return data({ credential: null });
  return data({
    credential: {
      status: record.status,
      lastSyncedAt: record.lastSyncedAt,
      lastError: record.lastError,
    },
  });
};
