-- CreateEnum
CREATE TYPE "catalog"."CardProvider" AS ENUM ('TCGDEX');

-- CreateTable
CREATE TABLE "catalog"."ExternalCardIdentity" (
    "id" UUID NOT NULL,
    "provider" "catalog"."CardProvider" NOT NULL,
    "externalId" VARCHAR(128) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "edition" VARCHAR(64) NOT NULL,
    "condition" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCardIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCardIdentity_reference_key" ON "catalog"."ExternalCardIdentity"("provider", "externalId", "language", "edition", "condition");
