import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Variables already set in the environment take precedence over the .env file.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see .env.example`);
  return value;
}

export const getDatabaseUrl = () => required('DATABASE_URL');

export function getTestDatabaseUrl() {
  const url = required('TEST_DATABASE_URL');
  // Tests clear every table, so never let them run against a real database.
  if (!/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
  }
  return url;
}

export const getApiPort = () => Number(process.env.API_PORT ?? 3001);

/** Browser tests point the import at a fake YNAB server; otherwise it uses YNAB's real API. */
export const getYnabApiUrl = () => process.env.YNAB_API_URL || undefined;

/** Where the server listens. Only this machine by default; a proxy such as Tailscale's is in front. */
export const getHost = () => process.env.HOST || '127.0.0.1';

/** In production, the server also serves the built client. */
export const isProduction = () => process.env.NODE_ENV === 'production';

/** Marks the session cookie HTTPS-only; set when the app is reached over HTTPS. */
export const getSecureCookies = () => process.env.SECURE_COOKIES === 'true';

/** The app's address on the tailnet, such as https://mac-mini.example.ts.net. */
export const getPublicUrl = () => process.env.PUBLIC_URL || undefined;
