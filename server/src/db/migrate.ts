import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { getDatabaseUrl } from '../env.js';
import { createDb } from './client.js';

const { db, close } = createDb(getDatabaseUrl());

try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)),
  });
  console.log('Migrations applied');
} finally {
  await close();
}
