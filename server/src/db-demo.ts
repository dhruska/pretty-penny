import { createDb } from './db/client.js';
import { addDemoData } from './demo.js';
import { getDatabaseUrl } from './env.js';
import { localToday } from './schedule.js';

/** `npm run db:demo`: fills an empty database with a made-up budget to explore. */
const { db, close } = createDb(getDatabaseUrl());
try {
  const counts = await addDemoData(db, localToday().slice(0, 7));
  if (counts === null) {
    console.error(
      'This database already has data, so nothing was added. The demo budget only goes into an empty database.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Added a made-up demo budget: ${counts.accounts} accounts, ${counts.categories} categories and ${counts.transactions} transactions.`,
    );
  }
} finally {
  await close();
}
