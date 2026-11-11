import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { getApiPort, getDatabaseUrl } from './env.js';
import { localToday } from './schedule.js';
import { postDueScheduled } from './scheduled.js';

const HOUR_MS = 60 * 60 * 1000;

const { db } = createDb(getDatabaseUrl());
const app = buildApp(db, { logger: true });

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

await app.listen({ port: getApiPort(), host: '127.0.0.1' });

await postScheduled();
setInterval(postScheduled, HOUR_MS);
