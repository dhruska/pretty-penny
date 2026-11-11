import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Db } from './db/client.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerCategoryRoutes } from './routes/categories.js';
import { registerPayeeRoutes } from './routes/payees.js';
import { registerScheduledRoutes } from './routes/scheduled.js';
import { registerTransactionRoutes } from './routes/transactions.js';

interface AppOptions {
  logger?: boolean;
  /** Today's date as YYYY-MM-DD; tests replace it to control when schedules come due. */
  today?: () => string;
}

export function buildApp(db: Db, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/api/hello', async () => {
    await db.execute(sql`select 1`);
    return { message: 'Hello from Pretty Penny' };
  });

  registerAccountRoutes(app, db);
  registerTransactionRoutes(app, db);
  registerCategoryRoutes(app, db);
  registerBudgetRoutes(app, db);
  registerPayeeRoutes(app, db);
  registerScheduledRoutes(app, db, options.today);

  return app;
}
