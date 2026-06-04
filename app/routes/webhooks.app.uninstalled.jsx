import { authenticate } from "../shopify.server";
import { deleteCarrierService } from "../carrier.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, admin } = await authenticate.webhook(request);

  console.log(`[webhook] App uninstalled: ${shop}`);

  // 1. Delete carrier service from Shopify (while the access token is still valid)
  //    then remove from DB. If we delete sessions first we lose the token.
  try {
    await deleteCarrierService(admin, shop);
  } catch (e) {
    console.error("[webhook] Could not delete carrier service:", e.message);
  }

  // 2. Delete all zones + rates (cascade handles rates via Prisma relation)
  await db.zone.deleteMany({ where: { shopDomain: shop } }).catch(() => {});

  // 3. Delete sessions last (invalidates the access token we needed above)
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
