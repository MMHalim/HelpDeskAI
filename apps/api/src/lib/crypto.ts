/**
 * Cryptographic helpers.
 *
 * - AES-256-GCM for encrypting provider API keys and Slack tokens at rest (§21).
 * - scrypt (Node built-in) for admin password hashes — no native dependency.
 * - HMAC-SHA256 for opaque session token hashing.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env.js';

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT_PARAMS: crypto.ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 };
const KEY_LENGTH = 64;

/* -------------------------------------------------------------------------- */
/* Symmetric encryption (AES-256-GCM)                                          */
/* -------------------------------------------------------------------------- */

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export function encryptSecret(plaintext: string, keyVersion = 1): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', env.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as EncryptedValue;
    const decipher = crypto.createDecipheriv('aes-256-gcm', env.encryptionKey, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (error) {
    throw new Error(
      'Unable to decrypt a stored credential. CREDENTIAL_ENCRYPTION_KEY does not match the value used when it was saved.',
      { cause: error },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt)                                                   */
/* -------------------------------------------------------------------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString(
    'base64',
  )}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64 ?? '', 'base64');
    const expected = Buffer.from(hashB64 ?? '', 'base64');
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Opaque tokens                                                               */
/* -------------------------------------------------------------------------- */

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.SESSION_PEPPER).update(token).digest('hex');
}

export function sha256(buffer: Buffer | string): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Constant-time string comparison. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
