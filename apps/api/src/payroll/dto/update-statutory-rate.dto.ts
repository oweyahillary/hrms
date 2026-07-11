import { IsISO8601, IsObject, IsOptional } from 'class-validator';

export class UpdateStatutoryRateDto {
  @IsOptional() @IsISO8601()
  effectiveDate?: string;

  @IsOptional() @IsObject()
  parameters?: Record<string, unknown>;
}
