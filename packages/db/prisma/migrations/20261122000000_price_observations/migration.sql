-- CreateEnum
CREATE TYPE "catalog"."PriceDataSource" AS ENUM ('MOCK', 'MARKET');

-- CreateTable
CREATE TABLE "catalog"."PriceObservation" (
    "id" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "amount" TEXT NOT NULL,
    "dataSource" "catalog"."PriceDataSource" NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceObservation_cardVariantId_dataSource_observedAt_idx" ON "catalog"."PriceObservation"("cardVariantId", "dataSource", "observedAt");

-- AddForeignKey
ALTER TABLE "catalog"."PriceObservation" ADD CONSTRAINT "PriceObservation_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
