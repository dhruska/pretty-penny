import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv();

// Separate ports and the test database keep browser tests away from a running dev server and its data.
const API_PORT = '3101';
const WEB_PORT = '5273';
const FAKE_YNAB_PORT = '3102';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');

export default defineConfig({
  testDir: './e2e',
  // Tests share one database and clear it before each test.
  workers: 1,
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Stands in for YNAB's API, so the import test never contacts YNAB.
      command: 'npx tsx e2e/support/fake-ynab.ts',
      url: `http://127.0.0.1:${FAKE_YNAB_PORT}/health`,
      env: { FAKE_YNAB_PORT },
    },
    {
      command: 'npm run start:test -w server',
      url: `http://localhost:${API_PORT}/api/hello`,
      env: {
        API_PORT,
        DATABASE_URL: testDatabaseUrl,
        YNAB_API_URL: `http://127.0.0.1:${FAKE_YNAB_PORT}/v1`,
      },
    },
    {
      command: `npm run dev -w client -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT },
    },
  ],
});
