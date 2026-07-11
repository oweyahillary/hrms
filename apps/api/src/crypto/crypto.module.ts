import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';
import {
  ACTIVE_KEY_PROVIDER, KEY_PROVIDERS, type KeyProvider,
} from './key-provider.interface';
import { EnvKeyProvider } from './providers/env-key.provider';
import { KmsKeyProvider } from './providers/kms-key.provider';

/**
 * Wires the key providers from config. The env provider is ALWAYS loaded (it
 * must be able to decrypt legacy env-encrypted values even after a switch to
 * KMS); KMS is added only when KEY_PROVIDER=aws_kms. The active provider is the
 * one used for new writes.
 */
const cryptoProviders = [
  {
    provide: KEY_PROVIDERS,
    inject: [ConfigService],
    useFactory: (config: ConfigService): Map<string, KeyProvider> => {
      const map = new Map<string, KeyProvider>();
      const encKey = Buffer.from(config.get<string>('ENCRYPTION_KEY') as string, 'base64');
      map.set('env', new EnvKeyProvider(encKey, 'env-1'));

      if (config.get<string>('KEY_PROVIDER') === 'aws_kms') {
        map.set(
          'awskms',
          new KmsKeyProvider(
            config.get<string>('AWS_KMS_KEY_ID') as string,
            config.get<string>('AWS_REGION') as string,
          ),
        );
      }
      return map;
    },
  },
  {
    provide: ACTIVE_KEY_PROVIDER,
    inject: [ConfigService, KEY_PROVIDERS],
    useFactory: (config: ConfigService, map: Map<string, KeyProvider>): KeyProvider => {
      const id = config.get<string>('KEY_PROVIDER') === 'aws_kms' ? 'awskms' : 'env';
      return map.get(id) as KeyProvider;
    },
  },
  {
    provide: CryptoService,
    inject: [KEY_PROVIDERS, ACTIVE_KEY_PROVIDER, ConfigService],
    useFactory: (map: Map<string, KeyProvider>, active: KeyProvider, config: ConfigService) =>
      new CryptoService(map, active, Buffer.from(config.get<string>('HMAC_KEY') as string, 'base64')),
  },
];

@Global()
@Module({
  providers: cryptoProviders,
  exports: [CryptoService],
})
export class CryptoModule {}
