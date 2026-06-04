import db from "./db.server";

const CREATE_CARRIER_SERVICE = `#graphql
  mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService {
        id
        name
        callbackUrl
        active
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_CARRIER_SERVICE = `#graphql
  mutation carrierServiceDelete($id: ID!) {
    carrierServiceDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

// Query to verify the carrier service actually exists in Shopify
const GET_CARRIER_SERVICE = `#graphql
  query GetCarrierService($id: ID!) {
    deliveryCarrierService(id: $id) {
      id
      name
      callbackUrl
      active
    }
  }
`;

/**
 * Register the carrier service.
 * If one already exists BUT the callback URL has changed, re-registers it.
 */
export async function registerCarrierService(admin, shopDomain) {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL env variable is not set");

  const callbackUrl = `${appUrl}/carrier-service`;
  const existing    = await db.carrierService.findUnique({ where: { shopDomain } });

  // Already registered with the correct URL — skip
  if (existing && existing.callbackUrl === callbackUrl) {
    return existing;
  }

  // URL has changed (tunnel restart in dev) — delete old, create new
  if (existing) {
    console.log(`[CarrierService] URL changed for ${shopDomain} — re-registering`);
    await _deleteFromShopify(admin, existing.serviceId);
    await db.carrierService.delete({ where: { shopDomain } });
  }

  return _createInShopify(admin, shopDomain, callbackUrl);
}

/**
 * Force-delete then re-create the carrier service.
 * Called when merchant manually deleted it from Shopify Settings.
 */
export async function reRegisterCarrierService(admin, shopDomain) {
  const existing = await db.carrierService.findUnique({ where: { shopDomain } });
  if (existing) {
    await _deleteFromShopify(admin, existing.serviceId);
    await db.carrierService.delete({ where: { shopDomain } });
  }
  const callbackUrl = `${process.env.SHOPIFY_APP_URL}/carrier-service`;
  return _createInShopify(admin, shopDomain, callbackUrl);
}

/**
 * Verify the carrier service actually exists in Shopify, not just in our DB.
 * Returns { existsInShopify, shopifyRecord } 
 */
export async function verifyCarrierServiceWithShopify(admin, shopDomain) {
  const dbRecord = await db.carrierService.findUnique({ where: { shopDomain } });
  if (!dbRecord) return { existsInShopify: false, dbRecord: null, shopifyRecord: null };

  try {
    const response = await admin.graphql(GET_CARRIER_SERVICE, {
      variables: { id: dbRecord.serviceId },
    });
    const { data } = await response.json();
    const shopifyRecord = data?.deliveryCarrierService ?? null;

    return {
      existsInShopify: !!shopifyRecord,
      dbRecord,
      shopifyRecord,
    };
  } catch (e) {
    console.error("[CarrierService] Shopify verify failed:", e.message);
    return { existsInShopify: false, dbRecord, shopifyRecord: null };
  }
}

/**
 * Full status object for the Settings page.
 * Does a live Shopify API check to detect if merchant manually deleted the service.
 */
export async function getCarrierServiceStatusFull(admin, shopDomain) {
  const appUrl      = process.env.SHOPIFY_APP_URL ?? "";
  const currentUrl  = `${appUrl}/carrier-service`;
  const { existsInShopify, dbRecord, shopifyRecord } = await verifyCarrierServiceWithShopify(admin, shopDomain);

  if (!dbRecord && !existsInShopify) {
    return {
      status:       "not_registered",
      label:        "Not registered",
      description:  "The carrier service has not been registered with Shopify.",
      callbackUrl:  currentUrl,
      serviceId:    null,
      urlMismatch:  false,
      registered:   false,
    };
  }

  if (dbRecord && !existsInShopify) {
    return {
      status:       "deleted_in_shopify",
      label:        "Deleted in Shopify",
      description:  "The carrier service was manually deleted from Shopify Settings. Click Register to restore it.",
      callbackUrl:  currentUrl,
      serviceId:    dbRecord.serviceId,
      urlMismatch:  false,
      registered:   false,
    };
  }

  if (dbRecord?.callbackUrl !== currentUrl) {
    return {
      status:       "url_mismatch",
      label:        "URL mismatch",
      description:  `Registered URL: ${dbRecord.callbackUrl}. Current URL: ${currentUrl}. Re-register to fix.`,
      callbackUrl:  currentUrl,
      serviceId:    dbRecord.serviceId,
      urlMismatch:  true,
      registered:   true,
    };
  }

  return {
    status:       "active",
    label:        "Active",
    description:  "The carrier service is registered and active.",
    callbackUrl:  shopifyRecord?.callbackUrl ?? currentUrl,
    serviceId:    dbRecord.serviceId,
    urlMismatch:  false,
    registered:   true,
  };
}

/**
 * Lightweight status check (no Shopify API call) — used on the Scenarios list page.
 */
export async function getCarrierServiceStatus(shopDomain) {
  const record     = await db.carrierService.findUnique({ where: { shopDomain } });
  const currentUrl = `${process.env.SHOPIFY_APP_URL}/carrier-service`;
  return {
    registered:           !!record,
    serviceId:            record?.serviceId ?? null,
    registeredCallbackUrl: record?.callbackUrl ?? null,
    currentCallbackUrl:   currentUrl,
    urlMismatch:          !!record && record.callbackUrl !== currentUrl,
  };
}

/**
 * Delete carrier service on app uninstall.
 */
export async function deleteCarrierService(admin, shopDomain) {
  const existing = await db.carrierService.findUnique({ where: { shopDomain } });
  if (!existing) return;
  await _deleteFromShopify(admin, existing.serviceId);
  await db.carrierService.delete({ where: { shopDomain } });
}

// ─── private helpers ─────────────────────────────────────────────────────────

async function _createInShopify(admin, shopDomain, callbackUrl) {
  console.log(`[CarrierService] Registering for ${shopDomain} → ${callbackUrl}`);

  const response = await admin.graphql(CREATE_CARRIER_SERVICE, {
    variables: {
      input: {
        name:                     "AM Shipping Rates",
        callbackUrl,
        active:                   true,
        supportsServiceDiscovery: false,
      },
    },
  });

  const { data }                        = await response.json();
  const { carrierService, userErrors }  = data.carrierServiceCreate;

  if (userErrors?.length > 0) {
    const msg = userErrors.map((e) => `[${e.field}] ${e.message}`).join("; ");
    throw new Error(msg);
  }

  return db.carrierService.create({
    data: { shopDomain, serviceId: carrierService.id, callbackUrl },
  });
}

async function _deleteFromShopify(admin, serviceId) {
  if (!admin || !serviceId) return;
  try {
    await admin.graphql(DELETE_CARRIER_SERVICE, {
      variables: { id: serviceId },
    });
  } catch (e) {
    console.error("[CarrierService] Shopify delete failed:", e.message);
  }
}