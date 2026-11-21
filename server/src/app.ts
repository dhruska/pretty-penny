import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Db } from './db/client.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerAuthRoutes, type AuthOptions } from './routes/auth.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerCategoryRoutes } from './routes/categories.js';
import { registerFlagRoutes } from './routes/flags.js';
import { registerImportRoutes } from './routes/import.js';
import { registerPayeeRoutes } from './routes/payees.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerScheduledRoutes } from './routes/scheduled.js';
import { registerTransactionRoutes } from './routes/transactions.js';
import { localToday } from './schedule.js';
import { createYnabClient, DEFAULT_YNAB_API_URL, type FetchFn } from './ynab/client.js';

interface AppOptions extends AuthOptions {
  logger?: boolean;
  /** Today's date as YYYY-MM-DD; tests replace it to control when schedules come due. */
  today?: () => string;
  /** YNAB's API address; browser tests point it at a fake server. */
  ynabApiUrl?: string;
  /** Replaces network requests to YNAB in tests. */
  fetch?: FetchFn;
}

export function buildApp(db: Db, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  // Every route is recorded, so a test can check each one requires signing in.
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routes.push({ method, url: route.url });
  });
  app.decorate('routeList', routes);

  // Registered first, so its check runs before every other route.
  registerAuthRoutes(app, db, options);

  app.get('/api/hello', async () => {
    await db.execute(sql`select 1`);
    return { message: 'Hello from Pretty Penny' };
  });

  registerAccountRoutes(app, db);
  registerTransactionRoutes(app, db);
  registerCategoryRoutes(app, db);
  registerBudgetRoutes(app, db);
  registerPayeeRoutes(app, db);
  registerFlagRoutes(app, db);
  registerScheduledRoutes(app, db, options.today);
  registerReportRoutes(app, db, options.today);
  registerImportRoutes(
    app,
    db,
    createYnabClient(options.ynabApiUrl ?? DEFAULT_YNAB_API_URL, options.fetch),
    options.today ?? localToday,
  );

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}
