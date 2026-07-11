import { IsIn, IsISO8601, IsObject } from 'class-validator';

export class CreateStatutoryRateDto {
  @IsIn(['PAYE_BAND', 'NSSF', 'SHIF', 'AHL'])
  rateType!: string;

  @IsISO8601()
  effectiveDate!: string;

  @IsObject()
  parameters!: Record<string, unknown>;
}
