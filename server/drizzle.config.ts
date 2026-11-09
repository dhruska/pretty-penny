import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './src/env.js';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  dbCredentials: { url: getDatabaseUrl() },
});
