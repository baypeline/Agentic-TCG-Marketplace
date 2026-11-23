-- CreateEnum
CREATE TYPE "catalog"."CatalogCollectionStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "catalog"."CatalogCollectionRun" (
    "id" UUID NOT NULL,
    "provider" "catalog"."CardProvider" NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "setId" VARCHAR(128) NOT NULL,
    "setName" TEXT NOT NULL,
    "externalIds" JSONB NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "catalog"."CatalogCollectionStatus" NOT NULL DEFAULT 'PENDING',
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogCollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCollectionRun_provider_language_setId_key" ON "catalog"."CatalogCollectionRun"("provider", "language", "setId");
