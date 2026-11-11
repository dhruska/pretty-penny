import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Db } from './db/client.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerCategoryRoutes } from './routes/categories.js';
import { registerPayeeRoutes } from './routes/payees.js';
import { registerTransactionRoutes } from './routes/transactions.js';

export function buildApp(db: Db, options: { logger?: boolean } = {}) {
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

  return app;
}
