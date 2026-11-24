-- CreateEnum
CREATE TYPE "market"."InventoryStatus" AS ENUM ('AVAILABLE', 'LISTED', 'RESERVED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "market"."ListingStatus" AS ENUM ('ACTIVE', 'RESERVED', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "trading"."BuyOrderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'MATCH_PENDING', 'FILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "trading"."MatchQuoteStatus" AS ENUM ('RESERVED', 'PAYMENT_PENDING', 'SETTLED', 'COMPLETED', 'RELEASED', 'RECONCILING');

-- CreateTable
CREATE TABLE "market"."InventoryItem" (
    "id" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "status" "market"."InventoryStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."Listing" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "price" TEXT NOT NULL,
    "status" "market"."ListingStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading"."BuyOrder" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "maxPrice" TEXT NOT NULL,
    "status" "trading"."BuyOrderStatus" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BuyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading"."MatchQuote" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "buyerAgentId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "buyOrderId" UUID,
    "paymentAttemptId" UUID,
    "amount" TEXT NOT NULL,
    "status" "trading"."MatchQuoteStatus" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading"."Trade" (
    "id" UUID NOT NULL,
    "matchQuoteId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "price" TEXT NOT NULL,
    "paymentAttemptId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_ownerId_idx" ON "market"."InventoryItem"("ownerId");

-- CreateIndex
CREATE INDEX "Listing_cardVariantId_status_idx" ON "market"."Listing"("cardVariantId", "status");

-- CreateIndex
CREATE INDEX "BuyOrder_agentId_buyerId_idx" ON "trading"."BuyOrder"("agentId", "buyerId");

-- CreateIndex
CREATE INDEX "BuyOrder_status_expiresAt_idx" ON "trading"."BuyOrder"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchQuote_paymentAttemptId_key" ON "trading"."MatchQuote"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "MatchQuote_status_expiresAt_idx" ON "trading"."MatchQuote"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_matchQuoteId_key" ON "trading"."Trade"("matchQuoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_paymentAttemptId_key" ON "trading"."Trade"("paymentAttemptId");

-- AddForeignKey
ALTER TABLE "market"."InventoryItem" ADD CONSTRAINT "InventoryItem_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market"."Listing" ADD CONSTRAINT "Listing_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "market"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."BuyOrder" ADD CONSTRAINT "BuyOrder_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."MatchQuote" ADD CONSTRAINT "MatchQuote_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "market"."Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."MatchQuote" ADD CONSTRAINT "MatchQuote_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "market"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."MatchQuote" ADD CONSTRAINT "MatchQuote_buyOrderId_fkey" FOREIGN KEY ("buyOrderId") REFERENCES "trading"."BuyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."Trade" ADD CONSTRAINT "Trade_matchQuoteId_fkey" FOREIGN KEY ("matchQuoteId") REFERENCES "trading"."MatchQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading"."Trade" ADD CONSTRAINT "Trade_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "market"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retain history while restricting each card and buy order to one live reservation.
CREATE UNIQUE INDEX "Listing_one_live_per_inventory" ON "market"."Listing"("inventoryItemId")
    WHERE "status" IN ('ACTIVE', 'RESERVED');

CREATE UNIQUE INDEX "MatchQuote_one_live_per_inventory" ON "trading"."MatchQuote"("inventoryItemId")
    WHERE "status" IN ('RESERVED', 'PAYMENT_PENDING', 'SETTLED', 'RECONCILING');

CREATE UNIQUE INDEX "MatchQuote_one_live_per_order" ON "trading"."MatchQuote"("buyOrderId")
    WHERE "status" IN ('RESERVED', 'PAYMENT_PENDING', 'SETTLED', 'RECONCILING') AND "buyOrderId" IS NOT NULL;

ALTER TABLE "market"."Listing" ADD CONSTRAINT "Listing_valid_price" CHECK ("price" ~ '^(0|[1-9][0-9]*)$');
ALTER TABLE "trading"."BuyOrder" ADD CONSTRAINT "BuyOrder_valid_price" CHECK ("maxPrice" ~ '^(0|[1-9][0-9]*)$');
ALTER TABLE "trading"."MatchQuote" ADD CONSTRAINT "MatchQuote_valid_amount" CHECK ("amount" ~ '^(0|[1-9][0-9]*)$');
ALTER TABLE "trading"."Trade" ADD CONSTRAINT "Trade_valid_price" CHECK ("price" ~ '^(0|[1-9][0-9]*)$');
