import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv();

// Separate ports and the test database keep browser tests away from a running dev server and its data.
const API_PORT = '3101';
const WEB_PORT = '5273';
const FAKE_YNAB_PORT = '3102';
const FAKE_PLAID_PORT = '3103';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required');

export default defineConfig({
  testDir: './e2e',
  // Tests share one database and clear it before each test.
  workers: 1,
  // Signs in once with the test password; every test starts with that session.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    storageState: 'e2e/.auth/signed-in.json',
    // Like a user who turns animation off: closing menus leave at once. One test checks motion.
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/phone/**' },
    {
      // A typical phone screen, with touch, for the phone layouts.
      name: 'phone',
      testMatch: '**/phone/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      // Stands in for YNAB's API, so the import test never contacts YNAB.
      command: 'npx tsx e2e/support/fake-ynab.ts',
      url: `http://127.0.0.1:${FAKE_YNAB_PORT}/health`,
      env: { FAKE_YNAB_PORT },
    },
    {
      // Stands in for Plaid's API, so bank tests never contact Plaid.
      command: 'npx tsx e2e/support/fake-plaid.ts',
      url: `http://127.0.0.1:${FAKE_PLAID_PORT}/health`,
      env: { FAKE_PLAID_PORT },
    },
    {
      command: 'npm run start:test -w server',
      url: `http://localhost:${API_PORT}/api/hello`,
      env: {
        API_PORT,
        DATABASE_URL: testDatabaseUrl,
        YNAB_API_URL: `http://127.0.0.1:${FAKE_YNAB_PORT}/v1`,
        // Made-up settings for the fake Plaid server; the key exists only for these tests.
        PLAID_CLIENT_ID: 'e2e-client',
        PLAID_SECRET: 'e2e-secret',
        PLAID_ENV: 'sandbox',
        PLAID_API_URL: `http://127.0.0.1:${FAKE_PLAID_PORT}`,
        BANK_TOKEN_KEY: 'ZTJlLW9ubHkta2V5LWZvci1mYWtlLXBsYWlkLXRlc3Q=',
      },
    },
    {
      command: `npm run dev -w client -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT },
    },
  ],
});
