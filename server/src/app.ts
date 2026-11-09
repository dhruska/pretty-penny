import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Db } from './db/client.js';

export function buildApp(db: Db, options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/api/hello', async () => {
    await db.execute(sql`select 1`);
    return { message: 'Hello from Pretty Penny' };
  });

  return app;
}
