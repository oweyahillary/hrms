import { generateSecret, generateURI, verifySync } from 'otplib';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Thin wrappers over otplib (pure-JS, RFC 6238, Google-Authenticator compatible)
 * plus one-time backup codes. No native deps, so it runs identically on VPS,
 * Docker, and cPanel — same constraint that drove the scrypt password choice.
 */
export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, accountLabel: string, issuer: string): string {
  return generateURI({ secret, label: accountLabel, issuer });
}

export function totpValid(secret: string, token: string): boolean {
  try {
    return verifySync({ secret, token: token.trim() }).valid === true;
  } catch {
    return false;
  }
}

/** Deterministic hash for backup codes (high-entropy, so a fast hash is fine). */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}

/** Generate n one-time backup codes; return the plaintext (shown once) + hashes (stored). */
export function newBackupCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const code = randomBytes(5).toString('hex'); // 10 hex chars, ~40 bits each
    plain.push(code);
    hashes.push(hashBackupCode(code));
  }
  return { plain, hashes };
}
