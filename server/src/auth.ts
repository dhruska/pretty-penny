import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 12;
/** A session lasts this long after it was last used. */
export const SESSION_DAYS = 30;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// scrypt's recommended interactive settings: about 16MB of memory and a fraction of a second.
const SCRYPT = { N: 2 ** 14, r: 8, p: 1, keyLength: 64 };

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** Why a new password isn't acceptable, or null if it is. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** A salted scrypt hash, stored with its settings so they can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const key = await scryptAsync(password, salt, keyLength, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Whether a password matches a stored hash, compared in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltText, keyText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltText, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

/** A new random session ID, sent only in the cookie. */
export const newSessionId = () => randomBytes(32).toString('base64url');

/** The database stores only a hash of each session ID, so a leaked table can't sign anyone in. */
export const hashSessionId = (id: string) => createHash('sha256').update(id).digest('hex');

/** A short description of the device, such as "Safari on iPhone", for your reference. */
export function describeDevice(userAgent: string | undefined): string {
  const agent = userAgent ?? '';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser';
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Linux/.test(agent)
              ? 'Linux'
              : null;
  return system ? `${browser} on ${system}` : browser;
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
