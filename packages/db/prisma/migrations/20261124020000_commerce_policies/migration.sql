BEGIN;
-- A historical transferred row must have verifiable completed ownership evidence.
UPDATE "market"."InventoryItem" AS item SET "ownerId" = last_trade."buyerId", "status" = 'AVAILABLE'
FROM (SELECT DISTINCT ON ("inventoryItemId") "inventoryItemId", "buyerId" FROM "trading"."Trade" ORDER BY "inventoryItemId", "completedAt" DESC, "id" DESC) AS last_trade
WHERE item."id" = last_trade."inventoryItemId" AND item."status" = 'TRANSFERRED';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "market"."InventoryItem" WHERE "status" = 'TRANSFERRED') THEN
    RAISE EXCEPTION 'TRANSFERRED inventory has no completed Trade; reconcile ownership before migration';
  END IF;
END $$;
ALTER TABLE "market"."InventoryItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "market"."InventoryStatus" RENAME TO "InventoryStatus_old";
CREATE TYPE "market"."InventoryStatus" AS ENUM ('AVAILABLE', 'LISTED', 'RESERVED');
ALTER TABLE "market"."InventoryItem" ALTER COLUMN "status" TYPE "market"."InventoryStatus" USING "status"::text::"market"."InventoryStatus";
ALTER TABLE "market"."InventoryItem" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
DROP TYPE "market"."InventoryStatus_old";
ALTER TABLE "trading"."MatchQuote" ADD COLUMN "policyId" UUID;
CREATE TABLE "payment"."SpendingPolicy" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL, "agentId" UUID NOT NULL, "version" INTEGER NOT NULL,
 "policyJson" TEXT NOT NULL, "totalBudget" TEXT NOT NULL, "spentAmount" TEXT NOT NULL DEFAULT '0', "reservedAmount" TEXT NOT NULL DEFAULT '0',
 CHECK ("version" > 0), CHECK ("totalBudget" ~ '^(0|[1-9][0-9]*)$'), CHECK ("spentAmount" ~ '^(0|[1-9][0-9]*)$'), CHECK ("reservedAmount" ~ '^(0|[1-9][0-9]*)$'),
 CHECK ("totalBudget"::numeric >= "spentAmount"::numeric + "reservedAmount"::numeric)
);
CREATE INDEX "SpendingPolicy_userId_agentId_idx" ON "payment"."SpendingPolicy"("userId","agentId");
CREATE TABLE "payment"."PolicyVersion" (
 "id" TEXT PRIMARY KEY, "policyId" UUID NOT NULL REFERENCES "payment"."SpendingPolicy"("id"), "version" INTEGER NOT NULL,
 "policyJson" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL,
 UNIQUE ("policyId", "version")
);
CREATE TABLE "payment"."PaymentAttempt" (
 "id" UUID PRIMARY KEY, "matchQuoteId" UUID NOT NULL UNIQUE REFERENCES "trading"."MatchQuote"("id"),
 "userId" UUID NOT NULL, "agentId" UUID NOT NULL, "policyId" UUID NOT NULL REFERENCES "payment"."SpendingPolicy"("id"), "policyVersion" INTEGER NOT NULL,
 "amount" TEXT NOT NULL CHECK ("amount" ~ '^(0|[1-9][0-9]*)$'),
 "status" TEXT NOT NULL CHECK ("status" IN ('REQUIRED','PENDING','UNKNOWN','FAILED','SETTLED')),
 "requirementsJson" TEXT NOT NULL, "payloadHash" TEXT, "transactionHash" TEXT, "submittedAt" TIMESTAMPTZ(3), "updatedAt" TIMESTAMPTZ(3) NOT NULL, "needsReview" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "PaymentAttempt_status_updatedAt_idx" ON "payment"."PaymentAttempt"("status","updatedAt");
CREATE INDEX "PaymentAttempt_userId_agentId_idx" ON "payment"."PaymentAttempt"("userId","agentId");
CREATE TABLE "agent"."AgentRun" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL, "agentId" UUID NOT NULL,
 "policyId" UUID NOT NULL REFERENCES "payment"."SpendingPolicy"("id"), "instruction" TEXT NOT NULL,
 "status" TEXT NOT NULL CHECK ("status" IN ('RUNNING','STOPPED','COMPLETED','FAILED')),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "result" TEXT
);
CREATE INDEX "AgentRun_userId_agentId_status_idx" ON "agent"."AgentRun"("userId","agentId","status");

COMMIT;
