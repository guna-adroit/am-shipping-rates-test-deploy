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

/**
 * Register the carrier service.
 * If one already exists BUT the callback URL has changed (e.g. tunnel restarted
 * in dev), it deletes the stale one and creates a fresh registration.
 */
export async function registerCarrierService(admin, shopDomain) {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!appUrl) throw new Error("SHOPIFY_APP_URL env variable is not set");

  const callbackUrl = `${appUrl}/carrier-service`;
  const existing = await db.carrierService.findUnique({ where: { shopDomain } });

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

  console.log(`[CarrierService] Registering for ${shopDomain} → ${callbackUrl}`);

  const response = await admin.graphql(CREATE_CARRIER_SERVICE, {
    variables: {
      input: {
        name: "Zip Code Shipping Rates",
        callbackUrl,
        active: true,
        supportsServiceDiscovery: false,
      },
    },
  });

  const { data } = await response.json();
  const { carrierService, userErrors } = data.carrierServiceCreate;

  if (userErrors?.length > 0) {
    const msg = userErrors.map((e) => `[${e.field}] ${e.message}`).join("; ");
    throw new Error(msg);
  }

  return db.carrierService.create({
    data: { shopDomain, serviceId: carrierService.id, callbackUrl },
  });
}

/**
 * Force-delete then re-create the carrier service.
 * Exposed via the "Re-register" button in the app UI.
 */
export async function reRegisterCarrierService(admin, shopDomain) {
  const existing = await db.carrierService.findUnique({ where: { shopDomain } });
  if (existing) {
    await _deleteFromShopify(admin, existing.serviceId);
    await db.carrierService.delete({ where: { shopDomain } });
  }
  return registerCarrierService(admin, shopDomain);
}

/**
 * Returns the registration status shown in the UI banner.
 */
export async function getCarrierServiceStatus(shopDomain) {
  const record = await db.carrierService.findUnique({ where: { shopDomain } });
  const currentUrl = `${process.env.SHOPIFY_APP_URL}/carrier-service`;

  return {
    registered: !!record,
    serviceId: record?.serviceId ?? null,
    registeredCallbackUrl: record?.callbackUrl ?? null,
    currentCallbackUrl: currentUrl,
    // true when tunnel changed and Shopify is calling the wrong URL
    urlMismatch: !!record && record.callbackUrl !== currentUrl,
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
