import { request, type FullConfig } from '@playwright/test';
import postgres from 'postgres';
import { hashPassword } from '../server/src/auth';

/** The test database's password. It guards only made-up test data. */
export const TEST_PASSWORD = 'e2e test password';
export const SIGNED_IN_STATE = 'e2e/.auth/signed-in.json';

/** Sets the test password and signs in once, so every browser test starts signed in. */
export default async function globalSetup(config: FullConfig) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
  }
  const sql = postgres(url, { onnotice: () => {} });
  try {
    const value = await hashPassword(TEST_PASSWORD);
    await sql`insert into settings (key, value) values ('password_hash', ${value})
      on conflict (key) do update set value = excluded.value`;
    await sql`delete from sessions`;
  } finally {
    await sql.end();
  }

  const context = await request.newContext({ baseURL: config.projects[0]!.use.baseURL });
  const response = await context.post('/api/auth/login', { data: { password: TEST_PASSWORD } });
  if (!response.ok())
    throw new Error(`Couldn’t sign in for the browser tests: ${await response.text()}`);
  await context.storageState({ path: SIGNED_IN_STATE });
  await context.dispose();
}
