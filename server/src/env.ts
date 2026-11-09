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
export const getTestDatabaseUrl = () => required('TEST_DATABASE_URL');
export const getApiPort = () => Number(process.env.API_PORT ?? 3001);
