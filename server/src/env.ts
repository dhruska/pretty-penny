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
