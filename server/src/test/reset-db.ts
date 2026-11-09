import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/** Clears all data except the Ready to Assign category seeded by migrations. */
export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate accounts, transactions, transaction_lines, monthly_assignments restart identity cascade`,
  );
  await db.execute(sql`delete from categories where system_key is null`);
  await db.execute(sql`delete from category_groups`);
}
