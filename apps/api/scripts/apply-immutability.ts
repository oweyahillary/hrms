/**
 * Apply (or roll back) the database-level immutability guards.
 *   cd apps/api
 *   npx ts-node scripts/apply-immutability.ts                    # apply db/immutability.sql
 *   npx ts-node scripts/apply-immutability.ts db/immutability-down.sql   # roll back
 * Reads DATABASE_URL from .env (same as the seed scripts). No psql needed.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (check apps/api/.env)');
  const arg = process.argv[2] ?? join(__dirname, '..', 'db', 'immutability.sql');
  const file = isAbsolute(arg) ? arg : join(process.cwd(), arg);
  const sql = readFileSync(file, 'utf8');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql); // simple-query protocol: multi-statement + $$-quoting OK
    console.log(`\u2713 applied ${file}`);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error('\u2717 apply failed:', (e as Error).message); process.exit(1); });
