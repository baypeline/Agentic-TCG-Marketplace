

-- CreateTable
CREATE TABLE "market"."RwaAsset" (
    "id" UUID NOT NULL,
    "cardVariantId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "nftAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "physicalHash" TEXT NOT NULL,
    "metadataDigest" TEXT NOT NULL,
    "metadataUri" TEXT NOT NULL,
    "mintTxHash" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "custodyMode" TEXT NOT NULL DEFAULT 'DEMO',

    CONSTRAINT "RwaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."RwaListing" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "chainListingId" TEXT NOT NULL,
    "marketAddress" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,

    CONSTRAINT "RwaListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."RwaRedemption" (
    "id" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "claimant" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,

    CONSTRAINT "RwaRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."RwaChainEvent" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,

    CONSTRAINT "RwaChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."RwaChainCursor" (
    "id" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,

    CONSTRAINT "RwaChainCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market"."RwaAction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "resultJson" TEXT,

    CONSTRAINT "RwaAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RwaAsset_inventoryItemId_key" ON "market"."RwaAsset"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RwaAsset_physicalHash_key" ON "market"."RwaAsset"("physicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "RwaAsset_chainId_nftAddress_tokenId_key" ON "market"."RwaAsset"("chainId", "nftAddress", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "RwaListing_marketAddress_chainListingId_key" ON "market"."RwaListing"("marketAddress", "chainListingId");

-- AddForeignKey
ALTER TABLE "market"."RwaListing" ADD CONSTRAINT "RwaListing_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "market"."RwaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market"."RwaRedemption" ADD CONSTRAINT "RwaRedemption_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "market"."RwaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
