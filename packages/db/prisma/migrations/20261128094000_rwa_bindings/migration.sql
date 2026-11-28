ALTER TABLE "market"."RwaAsset" ADD CONSTRAINT "RwaAsset_cardVariantId_fkey" FOREIGN KEY ("cardVariantId") REFERENCES "catalog"."CardVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market"."RwaAsset" ADD CONSTRAINT "RwaAsset_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "market"."InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "market"."RwaListing" ADD CONSTRAINT "RwaListing_id_fkey" FOREIGN KEY ("id") REFERENCES "market"."Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
