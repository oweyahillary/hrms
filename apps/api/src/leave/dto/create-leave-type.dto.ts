import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export const LEAVE_ACCRUAL_METHODS = ['NONE', 'UPFRONT', 'MONTHLY', 'DAILY'] as const;
export type LeaveAccrualMethod = (typeof LEAVE_ACCRUAL_METHODS)[number];

export class CreateLeaveTypeDto {
  @IsString() @MinLength(1)
  name!: string;

  @IsOptional() @IsBoolean()
  isPaid?: boolean;

  @IsOptional() @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional() @IsInt() @Min(0)
  maxDaysPerYear?: number;

  @IsOptional() @IsIn(LEAVE_ACCRUAL_METHODS)
  accrualMethod?: LeaveAccrualMethod;

  @IsOptional() @IsInt() @Min(0)
  annualDays?: number;

  @IsOptional() @IsInt() @Min(0)
  carryOverMax?: number;

  @IsOptional() @IsInt() @Min(0)
  carryOverExpiryMonths?: number;
}
