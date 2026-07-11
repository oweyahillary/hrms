import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  aesGcmDecrypt, aesGcmEncrypt, computeBlindIndex,
  decodeEnvelope, encodeEnvelope, isEnvelope,
} from './envelope';
import {
  ACTIVE_KEY_PROVIDER, KEY_PROVIDERS,
  type DataKey, type KeyProvider,
} from './key-provider.interface';

/**
 * App-layer field encryption + blind indexing.
 *
 *  - encrypt(): uses the ACTIVE provider to mint/reuse a DEK, AES-GCM the
 *    field, and emit a self-describing envelope.
 *  - decrypt(): dispatches on the envelope header to whichever provider made
 *    the value — so reads survive a provider switch or key rotation.
 *  - blindIndex(): deterministic HMAC for the searchable *Hmac columns.
 *
 * The HMAC key is always local (never KMS) — a KMS round-trip per search query
 * would be unacceptable, so blind indexing is symmetric across providers.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private activeDek?: DataKey;
  private readonly unwrapCache = new Map<string, Buffer>();

  constructor(
    @Inject(KEY_PROVIDERS) private readonly providers: Map<string, KeyProvider>,
    @Inject(ACTIVE_KEY_PROVIDER) private readonly active: KeyProvider,
    private readonly hmacKey: Buffer,
  ) {}

  /** Encrypt a value into a portable ciphertext envelope. */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.activeDek) {
      // One DEK per process lifetime; rotation mints a new one (new keyId in header).
      this.activeDek = await this.active.generateDataKey();
    }
    const { plaintextDek, wrappedDek, keyId } = this.activeDek;
    const f = aesGcmEncrypt(plaintextDek, plaintext);
    return encodeEnvelope({
      providerId: this.active.id,
      keyId,
      nonce: f.nonce,
      wrappedDek,
      ciphertext: f.ciphertext,
      tag: f.tag,
    });
  }

  /** Decrypt an envelope, dispatching to the provider named in its header. */
  async decrypt(value: string): Promise<string> {
    if (!isEnvelope(value)) return value; // tolerate legacy/plaintext during migration
    const env = decodeEnvelope(value);
    const provider = this.providers.get(env.providerId);
    if (!provider) {
      throw new Error(`No key provider loaded for ciphertext produced by '${env.providerId}'`);
    }
    const cacheKey = `${env.providerId}:${env.wrappedDek.toString('base64url')}`;
    let dek = this.unwrapCache.get(cacheKey);
    if (!dek) {
      dek = await provider.unwrapDataKey(env.wrappedDek, env.keyId);
      this.unwrapCache.set(cacheKey, dek);
    }
    return aesGcmDecrypt(dek, env.nonce, env.ciphertext, env.tag);
  }

  /** Deterministic keyed hash for a searchable (blind-indexed) column. */
  blindIndex(value: string): string {
    return computeBlindIndex(this.hmacKey, value);
  }

  isEncrypted(value: string): boolean {
    return isEnvelope(value);
  }
}
