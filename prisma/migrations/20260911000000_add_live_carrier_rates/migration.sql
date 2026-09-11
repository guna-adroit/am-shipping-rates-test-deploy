-- CreateTable
CREATE TABLE "CarrierCredential" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "carrierKey" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarrierCredential_shopDomain_idx" ON "CarrierCredential"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierCredential_shopDomain_carrierKey_key" ON "CarrierCredential"("shopDomain", "carrierKey");

-- CreateTable
CREATE TABLE "LiveCarrierRate" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "carrierKey" TEXT NOT NULL,
    "shippingLocation" TEXT NOT NULL DEFAULT 'shopify_location',
    "services" TEXT NOT NULL DEFAULT '[]',
    "packagingMethod" TEXT NOT NULL DEFAULT 'cart_attributes',
    "packageSplittingRule" TEXT NOT NULL DEFAULT 'cart_quantity',
    "productFilter" TEXT NOT NULL DEFAULT 'all_products',
    "packages" TEXT NOT NULL DEFAULT '[]',
    "fallbackName" TEXT NOT NULL DEFAULT 'Flat rate',
    "fallbackDescription" TEXT,
    "fallbackType" TEXT NOT NULL DEFAULT 'fixed',
    "fallbackRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveCarrierRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveCarrierRate_zoneId_idx" ON "LiveCarrierRate"("zoneId");

-- AddForeignKey
ALTER TABLE "LiveCarrierRate" ADD CONSTRAINT "LiveCarrierRate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
