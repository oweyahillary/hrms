import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreatePayrollAdjustmentDto {
  @IsIn(['BONUS', 'DEDUCTION'])
  type!: string;

  @IsNumber() @Min(0.01)
  amount!: number;

  @IsOptional() @IsBoolean()
  isTaxable?: boolean;

  @IsString() @MinLength(1)
  reason!: string;

  @IsInt() @Min(1) @Max(12)
  targetPeriodMonth!: number;

  @IsInt() @Min(2000) @Max(2100)
  targetPeriodYear!: number;
}
