import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Portable, self-describing ciphertext envelope for app-layer field encryption.
 *
 * Format (colon-delimited, base64url segments):
 *   HRMS1:<providerId>:<keyIdB64>:<nonceB64>:<wrappedDekB64>:<ctB64>:<tagB64>
 *
 * The header names the provider + key that produced the value, so decryption
 * dispatches on the ciphertext itself — NOT on the current KEY_PROVIDER setting.
 * That is what lets a deployment switch providers (or rotate keys) without a
 * flag-day re-encryption: new writes use the active provider, old values still
 * decrypt with whatever made them.
 */

export const ENVELOPE_MAGIC = 'HRMS1';
const AES_ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const DEK_BYTES = 32;

const b64u = (b: Buffer): string => b.toString('base64url');
const unb64u = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface AesGcmResult {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

/** AES-256-GCM encrypt with a fresh random nonce. `key` must be 32 bytes. */
export function aesGcmEncrypt(key: Buffer, plaintext: string): AesGcmResult {
  if (key.length !== DEK_BYTES) throw new Error('AES key must be 32 bytes');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce, ciphertext, tag };
}

/** AES-256-GCM decrypt. Throws if the auth tag fails (tamper / wrong key). */
export function aesGcmDecrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer): string {
  const decipher = createDecipheriv(AES_ALGO, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export interface Envelope {
  providerId: string;
  keyId: string;
  nonce: Buffer;
  wrappedDek: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export function encodeEnvelope(e: Envelope): string {
  return [
    ENVELOPE_MAGIC,
    e.providerId,
    b64u(Buffer.from(e.keyId, 'utf8')),
    b64u(e.nonce),
    b64u(e.wrappedDek),
    b64u(e.ciphertext),
    b64u(e.tag),
  ].join(':');
}

export function decodeEnvelope(value: string): Envelope {
  const parts = value.split(':');
  if (parts.length !== 7 || parts[0] !== ENVELOPE_MAGIC) {
    throw new Error('Malformed ciphertext envelope');
  }
  return {
    providerId: parts[1],
    keyId: unb64u(parts[2]).toString('utf8'),
    nonce: unb64u(parts[3]),
    wrappedDek: unb64u(parts[4]),
    ciphertext: unb64u(parts[5]),
    tag: unb64u(parts[6]),
  };
}

/** Cheap check: is this string one of our envelopes (vs. legacy plaintext)? */
export function isEnvelope(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${ENVELOPE_MAGIC}:`);
}

/**
 * Deterministic keyed HMAC-SHA256 for blind indexing (searchable ciphertext).
 * Deterministic => equal inputs yield equal output => you can index & query it.
 * Trade-off: it leaks equality, so only ever blind-index high-entropy fields.
 */
export function computeBlindIndex(hmacKey: Buffer, value: string): string {
  return createHmac('sha256', hmacKey).update(value.trim(), 'utf8').digest('base64url');
}
