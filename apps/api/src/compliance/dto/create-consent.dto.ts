import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConsentDto {
  @IsString() @MaxLength(200)
  purpose!: string;

  @IsIn(['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST'])
  lawfulBasis!: string;

  @IsOptional() @IsISO8601()
  grantedAt?: string;
}
