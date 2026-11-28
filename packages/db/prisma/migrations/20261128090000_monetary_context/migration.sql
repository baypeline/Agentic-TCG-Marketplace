CREATE TABLE "market"."MonetaryContext" (
  "id" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  CONSTRAINT "MonetaryContext_pkey" PRIMARY KEY ("id")
);
