import { and, eq, gt, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  describeDevice,
  hashPassword,
  hashSessionId,
  newSessionId,
  passwordProblem,
  readCookie,
  SESSION_MS,
  verifyPassword,
} from '../auth.js';
import type { Db, Executor } from '../db/client.js';
import { sessions, settings } from '../db/schema.js';
import { HttpError } from './schemas.js';

export const SESSION_COOKIE = 'pp_session';
export const SIGNED_OUT_CODE = 'SIGNED_OUT';
export const NO_PASSWORD_CODE = 'NO_PASSWORD';
const PASSWORD_KEY = 'password_hash';
/** A session's expiry moves forward at most once an hour, so every request isn't a write. */
const RENEW_AFTER_MS = 60 * 60 * 1000;

/** Routes anyone can reach: signing in and out, and a health check that returns no data. */
const OPEN_ROUTES = new Set([
  'GET /api/hello',
  'GET /api/auth/session',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

export interface AuthOptions {
  /** Tests of other features turn this off; the app itself always requires signing in. */
  requireLogin?: boolean;
  /** The pause after a wrong password, which slows down guessing. */
  wrongPasswordDelayMs?: number;
  /** Marks the session cookie HTTPS-only, as when served through `tailscale serve`. */
  secureCookies?: boolean;
  /** The app's public address, such as https://mac-mini.example.ts.net, trusted for changes. */
  publicUrl?: string;
  now?: () => Date;
}

async function passwordHash(db: Executor) {
  const [row] = await db.select().from(settings).where(eq(settings.key, PASSWORD_KEY));
  return row?.value ?? null;
}

/** Sets the app's password and signs out every device. Used by `npm run set-password`. */
export async function setPassword(db: Db, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const value = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: PASSWORD_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
    await tx.delete(sessions);
  });
}

function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  id: string,
  maxAgeMs: number,
  secure: boolean,
) {
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Over HTTPS, directly or through a trusted proxy such as Tailscale's, the cookie is HTTPS-only.
  if (secure || request.protocol === 'https') parts.push('Secure');
  reply.header('set-cookie', parts.join('; '));
}

/**
 * Whether a request that changes data came from the app's own pages. Browsers send an Origin
 * header with these requests; another site's would name that site instead. The host comes from
 * a forwarded header only when a trusted proxy on this machine sent it.
 */
function fromSameSite(request: FastifyRequest, publicOrigin: string | null) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === publicOrigin) return true;
  try {
    return new URL(origin).host === request.host;
  } catch {
    return false;
  }
}

export function registerAuthRoutes(app: FastifyInstance, db: Db, options: AuthOptions = {}) {
  const requireLogin = options.requireLogin ?? true;
  const wrongPasswordDelayMs = options.wrongPasswordDelayMs ?? 1000;
  const now = options.now ?? (() => new Date());
  const secure = options.secureCookies ?? false;
  const publicOrigin = options.publicUrl ? new URL(options.publicUrl).origin : null;

  async function currentSession(request: FastifyRequest) {
    const id = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!id) return null;
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.idHash, hashSessionId(id)), gt(sessions.expiresAt, now())));
    return session ? { id, ...session } : null;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;

    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !fromSameSite(request, publicOrigin)
    ) {
      return reply.code(403).send({ message: 'Changes must come from Pretty Penny itself.' });
    }
    if (!requireLogin || OPEN_ROUTES.has(`${request.method} ${request.routeOptions.url}`)) return;

    const session = await currentSession(request);
    if (!session) {
      return reply.code(401).send({ message: 'Sign in to continue.', code: SIGNED_OUT_CODE });
    }

    // Each use keeps the session going for another 30 days.
    const time = now();
    if (time.getTime() - session.lastUsedAt.getTime() > RENEW_AFTER_MS) {
      await db
        .update(sessions)
        .set({ lastUsedAt: time, expiresAt: new Date(time.getTime() + SESSION_MS) })
        .where(eq(sessions.idHash, session.idHash));
      setSessionCookie(request, reply, session.id, SESSION_MS, secure);
    }
  });

  app.get('/api/auth/session', async (request) => ({
    signedIn: (await currentSession(request)) !== null,
    passwordSet: (await passwordHash(db)) !== null,
  }));

  app.post<{ Body: { password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['password'],
          properties: { password: { type: 'string', maxLength: 1000 } },
        },
      },
    },
    async (request, reply) => {
      const stored = await passwordHash(db);
      if (!stored) {
        throw new HttpError(
          409,
          'No password is set yet. On the Mac running Pretty Penny, run npm run set-password, then sign in.',
          NO_PASSWORD_CODE,
        );
      }
      if (!(await verifyPassword(request.body.password, stored))) {
        await new Promise((resolve) => setTimeout(resolve, wrongPasswordDelayMs));
        throw new HttpError(401, 'That password isn’t right.');
      }

      const time = now();
      const id = newSessionId();
      await db.delete(sessions).where(lte(sessions.expiresAt, time));
      await db.insert(sessions).values({
        idHash: hashSessionId(id),
        device: describeDevice(request.headers['user-agent']),
        createdAt: time,
        lastUsedAt: time,
        expiresAt: new Date(time.getTime() + SESSION_MS),
      });
      setSessionCookie(request, reply, id, SESSION_MS, secure);
      return { signedIn: true };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const id = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (id) await db.delete(sessions).where(eq(sessions.idHash, hashSessionId(id)));
    setSessionCookie(request, reply, '', 0, secure);
    return reply.code(204).send();
  });
}
