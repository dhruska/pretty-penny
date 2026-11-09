import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

export async function resetDb(db: Db) {
  await db.execute(sql`truncate accounts, transactions restart identity cascade`);
}
