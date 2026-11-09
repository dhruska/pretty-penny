import postgres from 'postgres';

export async function resetDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
  }

  const sql = postgres(url, { onnotice: () => {} });
  try {
    await sql`truncate accounts, transactions restart identity cascade`;
  } finally {
    await sql.end();
  }
}
