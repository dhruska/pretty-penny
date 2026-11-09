import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { getDatabaseUrl, getTestDatabaseUrl } from '../env.js';
import { createDb } from './client.js';

const url = process.argv.includes('--test') ? getTestDatabaseUrl() : getDatabaseUrl();
const { db, close } = createDb(url);

try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  console.log('Migrations applied');
} finally {
  await close();
}
