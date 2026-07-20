import { IsIn, IsOptional } from 'class-validator';

/** The two documented legal conventions — mirrors the SeveranceDayRateBasis enum. */
export const SEVERANCE_DAY_RATE_BASES = ['CALENDAR_30', 'WORKING_26'] as const;

/** All fields optional — a PATCH updates only what is provided. */
export class UpdatePayrollSettingsDto {
  @IsOptional()
  @IsIn(SEVERANCE_DAY_RATE_BASES)
  severanceDayRateBasis?: string;
}
