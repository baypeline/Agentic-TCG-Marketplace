-- CreateTable
CREATE TABLE "catalog"."MarketPriceSnapshot" (
    "id" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "externalId" VARCHAR(128) NOT NULL,
    "providerVariant" VARCHAR(64) NOT NULL,
    "priceType" VARCHAR(32) NOT NULL,
    "originalCurrency" VARCHAR(3) NOT NULL,
    "originalAmount" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MarketPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."MarketPriceAssessment" (
    "snapshotId" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "matchEvidenceUrl" TEXT NOT NULL,
    "usdcAmount" TEXT NOT NULL,
    "fxRate" TEXT NOT NULL,
    "fxSourceUrl" TEXT NOT NULL,
    "fxObservedAt" TIMESTAMPTZ(3) NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MarketPriceAssessment_pkey" PRIMARY KEY ("snapshotId")
);

-- CreateIndex
CREATE INDEX "MarketPriceSnapshot_cardVariantId_observedAt_idx" ON "catalog"."MarketPriceSnapshot"("cardVariantId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPriceSnapshot_cardVariantId_provider_providerVariant__key" ON "catalog"."MarketPriceSnapshot"("cardVariantId", "provider", "providerVariant", "priceType", "observedAt");

-- AddForeignKey
ALTER TABLE "catalog"."MarketPriceSnapshot" ADD CONSTRAINT "MarketPriceSnapshot_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."MarketPriceAssessment" ADD CONSTRAINT "MarketPriceAssessment_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "catalog"."MarketPriceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
