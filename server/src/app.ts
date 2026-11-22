import { sql } from 'drizzle-orm';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { bankConfig, type BankConfig, type PlaidOptions } from './bank/service.js';
import type { Db } from './db/client.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerAuthRoutes, type AuthOptions } from './routes/auth.js';
import { registerBankRoutes } from './routes/bank.js';
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
  /** Replaces network requests to YNAB and Plaid in tests. */
  fetch?: FetchFn;
  /** Plaid's settings from .env; bank sync explains what's missing until they're all there. */
  plaid?: PlaidOptions;
  /** Encrypts bank access tokens; see docs/self-hosting.md. */
  bankTokenKey?: string;
  /** Built once by the caller when the hourly job shares it; otherwise built from the above. */
  bank?: BankConfig;
  /** The built client's folder. In production one server serves both the app and the API. */
  clientDir?: string;
  /** Logs every request; production turns this off, so logs stay small. */
  logRequests?: boolean;
}

export function buildApp(db: Db, options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: options.logRequests === false }),
    // Forwarded headers count only from this machine, such as Tailscale's HTTPS proxy, so nothing
    // else can claim a request came over HTTPS or from another host.
    trustProxy: ['127.0.0.1', '::1'],
  });

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
  registerTransactionRoutes(app, db, options.today);
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

  registerBankRoutes(
    app,
    db,
    options.bank ?? bankConfig({ ...options, fetch: options.fetch }),
    options.today ?? localToday,
  );

  if (options.clientDir) serveClient(app, options.clientDir);

  return app;
}

/**
 * Serves the built app. Hashed assets are cached for good; everything else, including page
 * addresses such as /accounts/3, gets index.html fresh, so updates show up right away.
 */
function serveClient(app: FastifyInstance, root: string) {
  app.register(fastifyStatic, {
    root,
    setHeaders: (reply, path) => {
      reply.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ message: 'Not found' });
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}
