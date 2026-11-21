import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { getTestDatabaseUrl } from './env.js';

const { db, close } = createDb(getTestDatabaseUrl());
let clientDir: string;
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  // A stand-in for the built client: index.html and one hashed asset.
  clientDir = await mkdtemp(join(tmpdir(), 'pretty-penny-client-'));
  await mkdir(join(clientDir, 'assets'));
  await writeFile(join(clientDir, 'index.html'), '<!doctype html><title>Pretty Penny</title>');
  await writeFile(join(clientDir, 'assets', 'index-abc123.js'), 'console.log(1);');
  app = buildApp(db, { clientDir });
});

afterAll(async () => {
  await app.close();
  await close();
  await rm(clientDir, { recursive: true });
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('serving the built app', () => {
  it('serves the app, fresh each time, at its own address and every page address', async () => {
    for (const url of ['/', '/accounts/3', '/reports?range=year', '/login']) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body).toContain('<title>Pretty Penny</title>');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });

  it('lets browsers keep hashed assets for good', async () => {
    const response = await get('/assets/index-abc123.js');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('still requires signing in for the API, and doesn’t answer unknown API addresses with the app', async () => {
    expect((await get('/api/accounts')).statusCode).toBe(401);
    expect((await get('/api/hello')).statusCode).toBe(200);
    const open = buildApp(db, { clientDir, requireLogin: false });
    const missing = await open.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ message: 'Not found' });
    expect((await open.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
    await open.close();
  });
});
