-- AlterTable
ALTER TABLE "catalog"."CardVariant" ADD COLUMN     "externalIdentityId" UUID,
ADD COLUMN     "lastCollectedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "CardVariant_externalIdentityId_key" ON "catalog"."CardVariant"("externalIdentityId");

-- AddForeignKey
ALTER TABLE "catalog"."CardVariant" ADD CONSTRAINT "CardVariant_externalIdentityId_fkey" FOREIGN KEY ("externalIdentityId") REFERENCES "catalog"."ExternalCardIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 외부 참조와 카드 본문의 내부 UUID를 동일하게 유지한다.
ALTER TABLE "catalog"."CardVariant" ADD CONSTRAINT "CardVariant_externalIdentityId_matches_id"
CHECK ("externalIdentityId" IS NULL OR "externalIdentityId" = "id");
