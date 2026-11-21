import { describe, expect, it } from 'vitest';
import {
  describeDevice,
  hashPassword,
  hashSessionId,
  newSessionId,
  passwordProblem,
  readCookie,
  verifyPassword,
} from './auth.js';

describe('passwords', () => {
  it('accepts the right password and refuses others', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(stored).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterz', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts each hash, so the same password hashes differently', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('refuses stored values it doesn’t recognize', async () => {
    expect(await verifyPassword('anything at all', 'plain text')).toBe(false);
    expect(await verifyPassword('anything at all', 'bcrypt$1$2$3$a$b')).toBe(false);
  });

  it('requires at least 12 characters', () => {
    expect(passwordProblem('short')).toBe('Use at least 12 characters.');
    expect(passwordProblem('twelve chars')).toBeNull();
  });
});

describe('sessions', () => {
  it('makes long random IDs and stores only their hash', () => {
    const id = newSessionId();
    expect(id).toMatch(/^[\w-]{43}$/);
    expect(newSessionId()).not.toBe(id);
    expect(hashSessionId(id)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionId(id)).toBe(hashSessionId(id));
  });

  it('reads one cookie from a header', () => {
    expect(readCookie('a=1; pp_session=abc%3D; b=2', 'pp_session')).toBe('abc=');
    expect(readCookie('a=1', 'pp_session')).toBeUndefined();
    expect(readCookie(undefined, 'pp_session')).toBeUndefined();
  });

  it('describes devices from their browser’s user agent', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(describeDevice(iphone)).toBe('Safari on iPhone');
    expect(describeDevice(mac)).toBe('Chrome on Mac');
    expect(describeDevice('Mozilla/5.0 (iPad) Firefox/130.0')).toBe('Firefox on iPad');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Edg/130.0')).toBe('Edge on Windows');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 15) Chrome/130.0')).toBe(
      'Chrome on Android',
    );
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0')).toBe(
      'Firefox on Linux',
    );
    expect(describeDevice('curl/8.0')).toBe('A browser');
    expect(describeDevice(undefined)).toBe('A browser');
  });
});
