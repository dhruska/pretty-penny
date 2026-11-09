import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { getTestDatabaseUrl } from './env.js';

const { db, close } = createDb(getTestDatabaseUrl());
const app = buildApp(db);

afterAll(async () => {
  await app.close();
  await close();
});

describe('GET /api/hello', () => {
  it('responds after querying the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/hello' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Hello from Pretty Penny' });
  });
});
