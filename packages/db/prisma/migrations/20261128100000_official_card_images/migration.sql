CREATE TABLE "catalog"."CardImageReference" (
  "cardVariantId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "officialCardId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "setCode" TEXT NOT NULL,
  "cardNumber" TEXT NOT NULL,
  "printedNumber" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CardImageReference_pkey" PRIMARY KEY ("cardVariantId")
);
CREATE INDEX "CardImageReference_provider_officialCardId_idx" ON "catalog"."CardImageReference"("provider", "officialCardId");
ALTER TABLE "catalog"."CardImageReference" ADD CONSTRAINT "CardImageReference_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
