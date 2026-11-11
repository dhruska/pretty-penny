import postgres from 'postgres';

/** Clears all data except the Ready to Assign category seeded by migrations. */
export async function resetDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
  }

  const sql = postgres(url, { onnotice: () => {} });
  try {
    await sql`truncate accounts, transactions, transaction_lines, monthly_assignments, payees, scheduled_transactions restart identity cascade`;
    await sql`delete from categories where system_key is null`;
    await sql`delete from category_groups`;
  } finally {
    await sql.end();
  }
}
