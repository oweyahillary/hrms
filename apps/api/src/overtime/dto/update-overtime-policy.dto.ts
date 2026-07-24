import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, Max, Min,
} from 'class-validator';

/** Only meaningful while the version is not yet in force — see mustBeEditable in the service. */
export class UpdateOvertimePolicyDto {
  @IsOptional() @IsISO8601()
  effectiveFrom?: string;

  @IsOptional() @IsNumber() @Min(1) @Max(10)
  normalDayMultiplier?: number;

  @IsOptional() @IsNumber() @Min(1) @Max(10)
  restDayMultiplier?: number;

  @IsOptional() @IsNumber() @Min(1) @Max(10)
  holidayMultiplier?: number;

  @IsOptional() @IsIn(['MONTHLY_X12_DIV_52_WEEKLY_HOURS', 'MONTHLY_DIV_26_DIV_8'])
  hourlyRateBasis?: string;

  @IsOptional() @IsInt() @Min(1) @Max(84)
  normalWeeklyHours?: number;

  @IsOptional() @IsInt() @Min(0) @Max(180)
  minimumMinutesToCount?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(24)
  maxHoursPerDay?: number;

  @IsOptional() @IsBoolean()
  requiresApproval?: boolean;
}
