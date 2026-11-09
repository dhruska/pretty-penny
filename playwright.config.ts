import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv();

// Separate ports and the test database keep browser tests away from a running dev server and its data.
const API_PORT = '3101';
const WEB_PORT = '5273';
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
      command: 'npm run start:test -w server',
      url: `http://localhost:${API_PORT}/api/hello`,
      env: { API_PORT, DATABASE_URL: testDatabaseUrl },
    },
    {
      command: `npm run dev -w client -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT },
    },
  ],
});
