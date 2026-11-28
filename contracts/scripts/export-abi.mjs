import { readFile, writeFile } from 'node:fs/promises';
const entries = [];
for (const name of ['CardVaultNFT', 'CardMarketplace']) {
  const artifact = JSON.parse(await readFile(new URL(`../out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
  entries.push(`export const ${name === 'CardVaultNFT' ? 'cardVaultAbi' : 'cardMarketplaceAbi'} = ${JSON.stringify(artifact.abi, null, 2)} as const;`);
}
await writeFile(new URL('../../packages/payment-client/src/rwa-abi.ts', import.meta.url), '// Generated from pinned Solidity sources; run pnpm --filter @tcg/solidity build && pnpm --filter @tcg/solidity abi.\n' + entries.join('\n'));
