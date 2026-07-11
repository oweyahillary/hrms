import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertRetentionPolicyDto {
  @IsString() @MaxLength(100)
  recordType!: string;

  @IsInt() @Min(1) @Max(1200) // up to 100 years
  retentionPeriodMonths!: number;

  @IsOptional() @IsString() @MaxLength(500)
  legalBasisNote?: string;
}
