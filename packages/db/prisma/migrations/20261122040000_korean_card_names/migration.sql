-- CreateEnum
CREATE TYPE "catalog"."CardNameSource" AS ENUM ('POKEAPI_SPECIES');

-- CreateTable
CREATE TABLE "catalog"."PokemonNameTranslation" (
    "speciesId" INTEGER NOT NULL,
    "englishName" TEXT NOT NULL,
    "englishKey" TEXT NOT NULL,
    "koreanName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PokemonNameTranslation_pkey" PRIMARY KEY ("speciesId")
);

-- CreateTable
CREATE TABLE "catalog"."CardLocalizedName" (
    "cardVariantId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "name" TEXT NOT NULL,
    "source" "catalog"."CardNameSource" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "speciesId" INTEGER NOT NULL,

    CONSTRAINT "CardLocalizedName_pkey" PRIMARY KEY ("cardVariantId","locale")
);

-- CreateIndex
CREATE UNIQUE INDEX "PokemonNameTranslation_englishKey_key" ON "catalog"."PokemonNameTranslation"("englishKey");

-- CreateIndex
CREATE INDEX "PokemonNameTranslation_koreanName_idx" ON "catalog"."PokemonNameTranslation"("koreanName");

-- CreateIndex
CREATE INDEX "CardLocalizedName_locale_name_idx" ON "catalog"."CardLocalizedName"("locale", "name");

-- AddForeignKey
ALTER TABLE "catalog"."CardLocalizedName" ADD CONSTRAINT "CardLocalizedName_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."CardLocalizedName" ADD CONSTRAINT "CardLocalizedName_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "catalog"."PokemonNameTranslation"("speciesId") ON DELETE RESTRICT ON UPDATE CASCADE;
