/**
 * A KeyProvider wraps/unwraps per-value Data Encryption Keys (DEKs). It never
 * exposes the master key. The CryptoService owns the actual field encryption;
 * the provider only manages the DEK lifecycle, which is the one thing that
 * differs between "master key in env" and "master key in a KMS".
 */
export interface DataKey {
  /** 32-byte plaintext DEK — used to AES-GCM the field, kept only in memory. */
  plaintextDek: Buffer;
  /** The DEK encrypted under the master key — safe to store in the envelope. */
  wrappedDek: Buffer;
  /** Identifies which master key wrapped it (for rotation / provider dispatch). */
  keyId: string;
}

export interface KeyProvider {
  /** Stable id written into the ciphertext header: 'env', 'awskms', ... */
  readonly id: string;
  /** Produce a fresh DEK (plaintext + wrapped). Used on writes. */
  generateDataKey(): Promise<DataKey>;
  /** Recover a plaintext DEK from its wrapped form. Used on reads. */
  unwrapDataKey(wrappedDek: Buffer, keyId: string): Promise<Buffer>;
}

export const KEY_PROVIDERS = 'KEY_PROVIDERS';
export const ACTIVE_KEY_PROVIDER = 'ACTIVE_KEY_PROVIDER';
