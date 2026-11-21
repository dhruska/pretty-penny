import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { getTestDatabaseUrl } from '../env.js';
import { resetDb } from '../test/reset-db.js';
import { setPassword } from './auth.js';

const { db, close } = createDb(getTestDatabaseUrl());
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = 'a long test password';

let clock = new Date('2026-11-20T12:00:00Z');
const app = buildApp(db, { wrongPasswordDelayMs: 0, now: () => clock });

beforeEach(async () => {
  await resetDb(db);
  await db.execute(sql`delete from sessions`);
  await db.execute(sql`delete from settings`);
  clock = new Date('2026-11-20T12:00:00Z');
});

afterAll(async () => {
  await app.close();
  await close();
});

const login = (password: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { password }, headers });

/** Signs in and returns the cookie to send with later requests. */
async function signIn() {
  await setPassword(db, PASSWORD);
  const response = await login(PASSWORD);
  expect(response.statusCode, response.body).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

const getAccounts = (cookie?: string) =>
  app.inject({ method: 'GET', url: '/api/accounts', headers: cookie ? { cookie } : {} });

describe('signing in', () => {
  it('requires a session for every route except signing in and the health check', async () => {
    await app.ready();
    const open = [
      'GET /api/hello',
      'GET /api/auth/session',
      'POST /api/auth/login',
      'POST /api/auth/logout',
    ];
    const protectedRoutes = app.routeList.filter(
      (route) => route.method !== 'HEAD' && !open.includes(`${route.method} ${route.url}`),
    );
    expect(protectedRoutes.length).toBeGreaterThan(40);

    for (const route of protectedRoutes) {
      const url = route.url.replace(/:[a-z]+/gi, '1');
      const response = await app.inject({ method: route.method as 'GET', url });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(response.json()).toEqual({ message: 'Sign in to continue.', code: 'SIGNED_OUT' });
    }
    expect((await app.inject({ method: 'GET', url: '/api/hello' })).statusCode).toBe(200);
  });

  it('explains how to set a password when none is set', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).json()).toEqual({
      signedIn: false,
      passwordSet: false,
    });
    const response = await login(PASSWORD);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'NO_PASSWORD' });
    expect(response.json().message).toContain('npm run set-password');
  });

  it('refuses a wrong password and signs in with the right one', async () => {
    await setPassword(db, PASSWORD);
    const wrong = await login('not the password');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().message).toBe('That password isn’t right.');
    expect(wrong.headers['set-cookie']).toBeUndefined();

    const right = await login(PASSWORD, { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' });
    expect(right.statusCode).toBe(200);
    const cookie = String(right.headers['set-cookie']);
    expect(cookie).toMatch(
      /^pp_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/,
    );
    expect(right.body).not.toContain(PASSWORD);
    expect(right.body).not.toContain(cookie.split(';')[0]!.split('=')[1]);

    const sessionCookie = cookie.split(';')[0]!;
    expect((await getAccounts(sessionCookie)).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: sessionCookie },
        })
      ).json(),
    ).toEqual({ signedIn: true, passwordSet: true });

    // Only a hash of the session ID is stored.
    const [stored] = await db.select().from(sessions);
    expect(stored!.idHash).not.toBe(sessionCookie.split('=')[1]);
    expect(stored!.device).toBe('Safari on iPhone');
  });

  it('marks the cookie Secure when reached over HTTPS through a proxy', async () => {
    await setPassword(db, PASSWORD);
    const response = await login(PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(String(response.headers['set-cookie'])).toMatch(/; Secure$/);
  });

  it('refuses a made-up or missing session', async () => {
    await signIn();
    expect((await getAccounts()).statusCode).toBe(401);
    expect((await getAccounts('pp_session=made-up')).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('last 30 days from their last use', async () => {
    const cookie = await signIn();

    // Within an hour, nothing is renewed.
    clock = new Date(clock.getTime() + 30 * 60 * 1000);
    let response = await getAccounts(cookie);
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();

    // Later uses push the expiry forward and refresh the cookie.
    clock = new Date(clock.getTime() + 29 * DAY_MS);
    response = await getAccounts(cookie);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('Max-Age=2592000');
    clock = new Date(clock.getTime() + 29 * DAY_MS);
    expect((await getAccounts(cookie)).statusCode).toBe(200);

    // Unused for more than 30 days, it expires.
    clock = new Date(clock.getTime() + 31 * DAY_MS);
    expect((await getAccounts(cookie)).statusCode).toBe(401);
  });

  it('end when signing out', async () => {
    const cookie = await signIn();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['set-cookie'])).toContain(
      'pp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
    expect((await getAccounts(cookie)).statusCode).toBe(401);
    // Signing out without a session is harmless.
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout' })).statusCode).toBe(204);
  });

  it('all end when the password changes', async () => {
    const first = await signIn();
    const second = String((await login(PASSWORD)).headers['set-cookie']).split(';')[0]!;

    await setPassword(db, 'a different long password');
    expect((await getAccounts(first)).statusCode).toBe(401);
    expect((await getAccounts(second)).statusCode).toBe(401);
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login('a different long password')).statusCode).toBe(200);
  });

  it('can’t be set to a short password', async () => {
    await expect(setPassword(db, 'too short')).rejects.toThrow('Use at least 12 characters.');
  });

  it('clear out expired sessions when someone signs in', async () => {
    await signIn();
    clock = new Date(clock.getTime() + 40 * DAY_MS);
    await login(PASSWORD);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});

describe('behind a proxy', () => {
  it('trusts forwarded headers only from this machine', async () => {
    await setPassword(db, PASSWORD);
    const viaProxy = await login(PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(String(viaProxy.headers['set-cookie'])).toMatch(/; Secure$/);

    // From anywhere else, a request can't claim it came over HTTPS.
    const direct = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: PASSWORD },
      headers: { 'x-forwarded-proto': 'https' },
      remoteAddress: '10.0.0.5',
    });
    expect(String(direct.headers['set-cookie'])).not.toContain('Secure');
  });

  it('can always mark the cookie Secure, and trusts the app’s public address', async () => {
    const proxied = buildApp(db, {
      wrongPasswordDelayMs: 0,
      secureCookies: true,
      publicUrl: 'https://mini.example.ts.net/',
    });
    await setPassword(db, PASSWORD);
    const response = await proxied.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: PASSWORD },
      headers: { origin: 'https://mini.example.ts.net', host: '127.0.0.1:3001' },
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toMatch(/; Secure$/);
    await proxied.close();
  });
});

describe('changes from other sites', () => {
  it('are refused, even with a valid session', async () => {
    const cookie = await signIn();
    const create = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: { cookie, ...headers },
        payload: { name: 'Checking', startingBalanceCents: 0, date: '2026-11-20' },
      });

    const foreign = await create({ origin: 'https://evil.example', host: 'mini.tail.ts.net' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().message).toBe('Changes must come from Pretty Penny itself.');
    expect((await create({ origin: 'not a url', host: 'mini.tail.ts.net' })).statusCode).toBe(403);

    expect(
      (await create({ origin: 'https://mini.tail.ts.net', host: 'mini.tail.ts.net' })).statusCode,
    ).toBe(201);
    expect(
      (
        await create({
          origin: 'https://mini.tail.ts.net',
          host: '127.0.0.1:3001',
          'x-forwarded-host': 'mini.tail.ts.net',
        })
      ).statusCode,
    ).toBe(201);
    // A forwarded host counts only from this machine's proxy.
    const spoofed = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: {
        cookie,
        origin: 'https://evil.example',
        host: 'mini.tail.ts.net',
        'x-forwarded-host': 'evil.example',
      },
      payload: { name: 'Checking', startingBalanceCents: 0, date: '2026-11-20' },
      remoteAddress: '10.0.0.5',
    });
    expect(spoofed.statusCode).toBe(403);
    // Reading isn't a change, so other sites' requests just need a session.
    expect((await getAccounts(cookie)).statusCode).toBe(200);
  });
});
