import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { bankConfig, refreshAllConnections } from './bank/service.js';
import { createDb } from './db/client.js';
import {
  getApiPort,
  getBankTokenKey,
  getDatabaseUrl,
  getHost,
  getPlaidOptions,
  getPublicUrl,
  getSecureCookies,
  getYnabApiUrl,
  isProduction,
} from './env.js';
import { localToday } from './schedule.js';
import { postDueScheduled } from './scheduled.js';

const HOUR_MS = 60 * 60 * 1000;

const { db } = createDb(getDatabaseUrl());
const production = isProduction();
const bank = bankConfig({
  plaid: getPlaidOptions(),
  bankTokenKey: getBankTokenKey(),
  publicUrl: getPublicUrl(),
});
const app = buildApp(db, {
  bank,
  logger: true,
  ynabApiUrl: getYnabApiUrl(),
  secureCookies: getSecureCookies(),
  publicUrl: getPublicUrl(),
  // Production serves the built client and logs only startup, warnings and errors.
  logRequests: !production,
  ...(production && {
    clientDir: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  }),
});

/** Posts scheduled transactions that have come due, as YNAB does on their date. */
async function postScheduled() {
  try {
    const result = await postDueScheduled(db, localToday());
    if (result.posted > 0) app.log.info(`Posted ${result.posted} scheduled transaction(s)`);
    for (const failure of result.failed) {
      app.log.warn(`Scheduled transaction ${failure.scheduleId} not posted: ${failure.message}`);
    }
  } catch (error) {
    app.log.error(error, 'Posting scheduled transactions failed');
  }
}

/** Fetches each bank connection's balances, and notices connections that need fixing. */
async function refreshBanks() {
  try {
    const result = await refreshAllConnections(db, bank);
    for (const failure of result.failed) {
      app.log.warn(`Bank connection ${failure.connectionId} not updated: ${failure.message}`);
    }
  } catch (error) {
    app.log.error(error, 'Updating bank connections failed');
  }
}

async function hourly() {
  await postScheduled();
  await refreshBanks();
}

await app.listen({ port: getApiPort(), host: getHost() });

await hourly();
setInterval(hourly, HOUR_MS);
