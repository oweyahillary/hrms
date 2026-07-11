import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf, validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum KeyProvider {
  Env = 'env',
  AwsKms = 'aws_kms',
}

/**
 * Validated shape of process.env. Boot fails fast (before the app serves) if
 * anything required is missing or malformed — no silent misconfiguration.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  // ---- App-layer crypto ----
  // Selects the ACTIVE provider for new writes. The env master key is always
  // required regardless, because reads must decrypt legacy env-encrypted values
  // even after a switch to KMS.
  @IsEnum(KeyProvider)
  KEY_PROVIDER: KeyProvider = KeyProvider.Env;

  // 32-byte keys, base64-encoded (~44 chars). Exact byte length is re-checked
  // when the providers initialise.
  @IsString()
  @MinLength(43)
  ENCRYPTION_KEY!: string;

  @IsString()
  @MinLength(43)
  HMAC_KEY!: string;

  // Required only when KEY_PROVIDER=aws_kms.
  @ValidateIf((o: EnvironmentVariables) => o.KEY_PROVIDER === KeyProvider.AwsKms)
  @IsString()
  @MinLength(1)
  AWS_REGION?: string;

  @ValidateIf((o: EnvironmentVariables) => o.KEY_PROVIDER === KeyProvider.AwsKms)
  @IsString()
  @MinLength(1)
  AWS_KMS_KEY_ID?: string;

  // ---- Auth (JWT + refresh) ----
  // Distinct secrets so a leaked access secret can't mint refresh tokens.
  @IsString()
  @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(16)
  JWT_REFRESH_SECRET!: string;

  // Short-lived access token (e.g. '15m', '1h'); opaque refresh token lives in
  // the sessions table and rotates on use.
  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL_DAYS: number = 7;

  // ---- File storage ----
  @IsOptional()
  @IsString()
  STORAGE_DIR: string = './storage';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return validated;
}
