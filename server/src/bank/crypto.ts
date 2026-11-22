import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpError } from '../routes/schemas.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
export const BANK_KEY_CODE = 'BANK_KEY';

/**
 * Reads BANK_TOKEN_KEY: 32 random bytes in base64, as `openssl rand -base64 32` makes. Returns
 * the key, or a problem to show on the Bank connections page.
 */
export function parseBankKey(value: string | undefined): { key: Buffer } | { problem: string } {
  if (!value) return { problem: 'BANK_TOKEN_KEY isn’t set.' };
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.trim()) {
    return {
      problem:
        'BANK_TOKEN_KEY must be 32 random bytes in base64, made with openssl rand -base64 32.',
    };
  }
  return { key };
}

/** Encrypts a bank access token with AES-256-GCM, so the database and its backups never hold it. */
export function encryptToken(key: Buffer, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), encrypted]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join('.');
}

/** Reads a token saved by `encryptToken`, failing clearly if BANK_TOKEN_KEY has changed. */
export function decryptToken(key: Buffer, saved: string): string {
  const [version, iv, tag, encrypted] = saved.split('.');
  try {
    if (version !== VERSION || !iv || !tag || encrypted === undefined) throw new Error('format');
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new HttpError(
      500,
      'This bank connection can’t be read with the current BANK_TOKEN_KEY. Put back the key it was saved with, or remove the connection and connect the bank again.',
      BANK_KEY_CODE,
    );
  }
}
