import db from "../db.server";

// ─────────────────────────────────────────────────────────────────────────────
// CarrierCredential
// ─────────────────────────────────────────────────────────────────────────────

export async function getCarrierCredential(shopDomain, carrierKey) {
  return db.carrierCredential.findUnique({
    where: { shopDomain_carrierKey: { shopDomain, carrierKey } },
  });
}

export async function getCarrierCredentialsMap(shopDomain) {
  const rows = await db.carrierCredential.findMany({ where: { shopDomain } });
  const map = {};
  for (const row of rows) {
    map[row.carrierKey] = {
      status: row.status,
      lastSyncedAt: row.lastSyncedAt,
      lastError: row.lastError,
    };
  }
  return map;
}

export async function upsertCarrierCredential(shopDomain, carrierKey, credentials, result) {
  const data = {
    credentials: JSON.stringify(credentials),
    status: result.verified ? "verified" : (result.error ? "failed" : "unverified"),
    lastSyncedAt: new Date(),
    lastError: result.error || null,
  };
  return db.carrierCredential.upsert({
    where: { shopDomain_carrierKey: { shopDomain, carrierKey } },
    update: data,
    create: { shopDomain, carrierKey, ...data },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveCarrierRate
// ─────────────────────────────────────────────────────────────────────────────

export async function getLiveCarrierRate(id) {
  return db.liveCarrierRate.findUnique({ where: { id } });
}

export async function createLiveCarrierRate(zoneId, data) {
  return db.liveCarrierRate.create({
    data: {
      zoneId,
      name: data.name,
      notes: data.notes || null,
      status: data.status || "enabled",
      carrierKey: data.carrierKey,
      shippingLocation: data.shippingLocation || "shopify_location",
      services: JSON.stringify(data.services || []),
      packagingMethod: data.packagingMethod || "cart_attributes",
      packageSplittingRule: data.packageSplittingRule || "cart_quantity",
      productFilter: data.productFilter || "all_products",
      packages: JSON.stringify(data.packages || []),
      fallbackName: data.fallbackName || "Flat rate",
      fallbackDescription: data.fallbackDescription || null,
      fallbackType: data.fallbackType || "fixed",
      fallbackRate: parseFloat(data.fallbackRate) || 0,
    },
  });
}

export async function updateLiveCarrierRate(id, data) {
  return db.liveCarrierRate.update({
    where: { id },
    data: {
      name: data.name,
      notes: data.notes || null,
      status: data.status || "enabled",
      carrierKey: data.carrierKey,
      shippingLocation: data.shippingLocation || "shopify_location",
      services: JSON.stringify(data.services || []),
      packagingMethod: data.packagingMethod || "cart_attributes",
      packageSplittingRule: data.packageSplittingRule || "cart_quantity",
      productFilter: data.productFilter || "all_products",
      packages: JSON.stringify(data.packages || []),
      fallbackName: data.fallbackName || "Flat rate",
      fallbackDescription: data.fallbackDescription || null,
      fallbackType: data.fallbackType || "fixed",
      fallbackRate: parseFloat(data.fallbackRate) || 0,
      updatedAt: new Date(),
    },
  });
}

export async function deleteLiveCarrierRate(id) {
  return db.liveCarrierRate.delete({ where: { id } });
}

export async function toggleLiveCarrierRateStatus(id, newStatus) {
  return db.liveCarrierRate.update({ where: { id }, data: { status: newStatus } });
}
