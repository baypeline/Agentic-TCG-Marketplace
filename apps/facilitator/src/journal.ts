import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SettleResponse } from '@x402/core/types';

type Row = { fingerprint: string; transaction_hash: string | null; result: string | null };
export function createJournal(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'settlements.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, transaction_hash TEXT, result TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  return {
    claim(id: string, fingerprint: string) { return db.prepare('INSERT OR IGNORE INTO settlements(id,fingerprint) VALUES (?,?)').run(id, fingerprint).changes === 1; },
    get(id: string) { return db.prepare('SELECT fingerprint,transaction_hash,result FROM settlements WHERE id=?').get(id) as Row | undefined; },
    broadcast(id: string, hash: string) { db.prepare('UPDATE settlements SET transaction_hash=? WHERE id=?').run(hash, id); },
    finish(id: string, result: SettleResponse) { db.prepare('UPDATE settlements SET result=?,transaction_hash=COALESCE(NULLIF(?,\'\'),transaction_hash) WHERE id=?').run(JSON.stringify(result), result.transaction, id); },
    close() { db.close(); },
  };
}
export type Journal = ReturnType<typeof createJournal>;
