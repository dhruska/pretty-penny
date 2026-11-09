import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { getApiPort, getDatabaseUrl } from './env.js';

const { db } = createDb(getDatabaseUrl());
const app = buildApp(db, { logger: true });

await app.listen({ port: getApiPort(), host: '127.0.0.1' });
