CREATE TABLE "auth"."WalletIdentity" (
  "address" VARCHAR(42) PRIMARY KEY,
  "userId" UUID NOT NULL UNIQUE,
  "agentId" UUID NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "auth"."WalletChallenge" (
  "id" UUID PRIMARY KEY,
  "address" VARCHAR(42) NOT NULL,
  "message" TEXT NOT NULL,
  "bindingHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "WalletChallenge_expiresAt_idx" ON "auth"."WalletChallenge"("expiresAt");
CREATE TABLE "auth"."WalletSession" (
  "tokenHash" VARCHAR(64) PRIMARY KEY,
  "userId" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "address" VARCHAR(42) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "WalletSession_expiresAt_idx" ON "auth"."WalletSession"("expiresAt");
