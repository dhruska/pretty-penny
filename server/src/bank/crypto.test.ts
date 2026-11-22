import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, parseBankKey } from './crypto.js';

const keyText = randomBytes(32).toString('base64');
const key = Buffer.from(keyText, 'base64');

describe('bank token key', () => {
  it('accepts 32 bytes in base64', () => {
    expect(parseBankKey(keyText)).toEqual({ key });
  });

  it('explains a missing or malformed key', () => {
    expect(parseBankKey(undefined)).toEqual({ problem: 'BANK_TOKEN_KEY isn’t set.' });
    for (const value of ['too-short', randomBytes(16).toString('base64'), `${keyText}!!`]) {
      expect(parseBankKey(value)).toMatchObject({ problem: expect.stringContaining('32 random') });
    }
  });
});

describe('token encryption', () => {
  it('reads back what it saved, without the token appearing in the saved text', () => {
    const saved = encryptToken(key, 'access-sandbox-abc123');
    expect(saved).not.toContain('access-sandbox');
    expect(saved.startsWith('v1.')).toBe(true);
    expect(decryptToken(key, saved)).toBe('access-sandbox-abc123');
  });

  it('saves the same token differently each time', () => {
    expect(encryptToken(key, 'same')).not.toBe(encryptToken(key, 'same'));
  });

  it('fails clearly with a different key or a damaged value', () => {
    const saved = encryptToken(key, 'access-sandbox-abc123');
    const otherKey = randomBytes(32);
    const message = /can’t be read with the current BANK_TOKEN_KEY/;
    expect(() => decryptToken(otherKey, saved)).toThrow(message);
    expect(() => decryptToken(key, saved.slice(0, -4) + 'AAAA')).toThrow(message);
    expect(() => decryptToken(key, 'not a saved token')).toThrow(message);
  });
});
