import { IsString, MinLength, MaxLength } from 'class-validator';

export class MfaEnableDto {
  @IsString()
  @MinLength(6)
  @MaxLength(10)
  token!: string;
}

export class MfaVerifyDto {
  @IsString()
  mfaToken!: string;

  /** A 6-digit TOTP code or a backup code. */
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class MfaDisableDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}
