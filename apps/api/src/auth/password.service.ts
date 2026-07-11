import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, type ScryptOptions, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing on Node's built-in scrypt — a memory-hard KDF (OWASP-
 * acceptable) with ZERO native dependencies, so it runs identically on a VPS,
 * Docker, and cPanel shared hosting (no node-gyp, no prebuilt binaries).
 *
 * Stored format (self-describing, upgradeable):
 *   scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
 */
@Injectable()
export class PasswordService {
  private readonly N = 16384; // CPU/memory cost (2^14)
  private readonly r = 8;
  private readonly p = 1;
  private readonly keyLen = 64;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = (await scrypt(password.normalize('NFKC'), salt, this.keyLen, {
      N: this.N, r: this.r, p: this.p,
    })) as Buffer;
    return `scrypt$${this.N}$${this.r}$${this.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = (await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    })) as Buffer;
    // Constant-time compare; lengths already match by construction.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}
