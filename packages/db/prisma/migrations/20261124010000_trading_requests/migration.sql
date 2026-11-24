CREATE TABLE "trading"."TradingRequest" (
  "id" VARCHAR(64) PRIMARY KEY,
  "userId" UUID NOT NULL,
  "agentId" UUID,
  "operation" VARCHAR(32) NOT NULL,
  "requestKey" VARCHAR(128) NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  "resultJson" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TradingRequest_userId_agentId_idx" ON "trading"."TradingRequest"("userId", "agentId");
