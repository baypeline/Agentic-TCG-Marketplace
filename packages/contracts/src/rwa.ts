import { z } from 'zod';
const address = z.string().regex(/^0x[\da-fA-F]{40}$/);
export const rwaActionSchema = z.object({ id:z.uuid(), status:z.enum(['PREPARING','PENDING','COMPLETED','FAILED']), txHash:z.string().nullable() });
export const rwaViewSchema = z.object({
  custodyMode:z.literal('DEMO'),wallet:address,role:z.enum(['buyer','custodian']),currency:z.literal('tOKRW'),proceeds:z.string(),
  deployment:z.object({market:address,nft:address}),
  cards:z.array(z.object({id:z.uuid(),name:z.string(),imageUrl:z.string().nullable(),localizedNames:z.array(z.object({locale:z.string(),name:z.string()})).optional()})),
  assets:z.array(z.object({id:z.uuid(),inventoryItemId:z.uuid(),cardVariantId:z.uuid(),tokenId:z.string(),nftAddress:address,ownerWallet:address,state:z.string(),physicalHash:z.string(),metadataDigest:z.string(),mintTxHash:z.string(),custodyMode:z.literal('DEMO'),
    listings:z.array(z.object({id:z.uuid(),chainListingId:z.string(),sellerWallet:address,price:z.string(),status:z.string()})),
    redemptions:z.array(z.object({id:z.string(),status:z.string(),claimant:address,txHash:z.string()})),
  })),
});
export type RwaView = z.infer<typeof rwaViewSchema>;
