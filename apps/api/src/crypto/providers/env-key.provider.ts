import { randomBytes } from 'node:crypto';
import { aesGcmDecrypt, aesGcmEncrypt } from '../envelope';
import type { DataKey, KeyProvider } from '../key-provider.interface';

/**
 * Master key lives in an environment secret (ENCRYPTION_KEY). Wraps DEKs with
 * AES-256-GCM locally. Zero external dependency — the portable default that
 * behaves identically on a client's own box, your cloud, or a Kenyan provider.
 *
 * wrappedDek layout: nonce(12) || tag(16) || ciphertext.
 */
export class EnvKeyProvider implements KeyProvider {
  readonly id = 'env';

  constructor(
    private readonly masterKey: Buffer,
    private readonly keyId: string,
  ) {
    if (masterKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }

  async generateDataKey(): Promise<DataKey> {
    const plaintextDek = randomBytes(32);
    const w = aesGcmEncrypt(this.masterKey, plaintextDek.toString('base64'));
    const wrappedDek = Buffer.concat([w.nonce, w.tag, w.ciphertext]);
    return { plaintextDek, wrappedDek, keyId: this.keyId };
  }

  async unwrapDataKey(wrappedDek: Buffer, _keyId: string): Promise<Buffer> {
    const nonce = wrappedDek.subarray(0, 12);
    const tag = wrappedDek.subarray(12, 28);
    const ciphertext = wrappedDek.subarray(28);
    return Buffer.from(aesGcmDecrypt(this.masterKey, nonce, ciphertext, tag), 'base64');
  }
}
