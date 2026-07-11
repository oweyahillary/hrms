import type { DataKey, KeyProvider } from '../key-provider.interface';

/**
 * Master key (CMK) lives inside AWS KMS and never leaves it. Envelope
 * encryption via GenerateDataKey / Decrypt. The AWS SDK is imported lazily so
 * an env-only, self-hosted deployment never loads cloud code at all.
 *
 * NOTE: built to spec but not exercised against a live KMS in this environment
 * — verify with real credentials before a KMS-backed client goes to production.
 */
export class KmsKeyProvider implements KeyProvider {
  readonly id = 'awskms';
  // Loaded lazily in init(); typed loosely to avoid a hard SDK type dependency.
  private client: any;
  private KmsCommands: any;

  constructor(
    private readonly cmkId: string,
    private readonly region: string,
  ) {}

  /** Lazy-load the SDK so `KEY_PROVIDER=env` deployments don't pull AWS in. */
  private async init(): Promise<void> {
    if (this.client) return;
    const kms = await import('@aws-sdk/client-kms');
    this.KmsCommands = kms;
    this.client = new kms.KMSClient({ region: this.region });
  }

  async generateDataKey(): Promise<DataKey> {
    await this.init();
    const res = await this.client.send(
      new this.KmsCommands.GenerateDataKeyCommand({ KeyId: this.cmkId, KeySpec: 'AES_256' }),
    );
    return {
      plaintextDek: Buffer.from(res.Plaintext as Uint8Array),
      wrappedDek: Buffer.from(res.CiphertextBlob as Uint8Array),
      keyId: this.cmkId,
    };
  }

  async unwrapDataKey(wrappedDek: Buffer, _keyId: string): Promise<Buffer> {
    await this.init();
    const res = await this.client.send(
      new this.KmsCommands.DecryptCommand({ CiphertextBlob: wrappedDek }),
    );
    return Buffer.from(res.Plaintext as Uint8Array);
  }
}
