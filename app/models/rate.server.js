import db from "../db.server";

async function generateRateId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await db.rate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return id;
  }
  throw new Error("Could not generate a unique 6-digit rate ID. Try again.");
}

export async function getRate(id) {
  return db.rate.findUnique({ where: { id } });
}

export async function createRate(zoneId, data) {
  const id = await generateRateId();
  return db.rate.create({
    data: {
      id,
      zoneId,
      name: data.name,
      description: data.description?.trim() || null,
      type:        data.type      || "price",
      valueType:   data.valueType  || "fixed",
      status:      data.status     || "enabled",
      profileId:   data.profileId   || null,
      profileName: data.profileName || null,
      minValue:    parseFloat(data.minValue) || 0,
      maxValue:    data.maxValue !== "" && data.maxValue != null
        ? parseFloat(data.maxValue) : null,
      price:           parseFloat(data.price) || 0,
      minDeliveryDays: data.minDeliveryDays != null && data.minDeliveryDays !== "" ? parseInt(data.minDeliveryDays, 10) : null,
      maxDeliveryDays: data.maxDeliveryDays != null && data.maxDeliveryDays !== "" ? parseInt(data.maxDeliveryDays, 10) : null,
    },
  });
}

export async function updateRate(id, data) {
  return db.rate.update({
    where: { id },
    data: {
      name:        data.name,
      description: data.description?.trim() || null,
      profileId:   data.profileId   ?? undefined,
      profileName: data.profileName ?? undefined,
      type:        data.type        ?? undefined,
      valueType:   data.valueType   ?? undefined,
      status:      data.status      ?? undefined,
      minValue:    parseFloat(data.minValue) || 0,
      maxValue:    data.maxValue !== "" && data.maxValue != null
        ? parseFloat(data.maxValue) : null,
      price:           parseFloat(data.price) || 0,
      minDeliveryDays: data.minDeliveryDays != null && data.minDeliveryDays !== "" ? parseInt(data.minDeliveryDays, 10) : null,
      maxDeliveryDays: data.maxDeliveryDays != null && data.maxDeliveryDays !== "" ? parseInt(data.maxDeliveryDays, 10) : null,
      updatedAt:       new Date(),
    },
  });
}

export async function deleteRate(id) {
  return db.rate.delete({ where: { id } });
}