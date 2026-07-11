import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class QueryStatutoryRateDto {
  @IsOptional() @IsIn(['PAYE_BAND', 'NSSF', 'SHIF', 'AHL'])
  rateType?: string;
}

export class EffectiveQueryDto {
  @IsOptional() @IsISO8601()
  asOf?: string;
}
