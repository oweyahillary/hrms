import { IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';

export class PreviewPayrollDto {
  @IsNumber() @Min(0)
  grossPay!: number;

  /** Act-faithful NSSF base; defaults to grossPay when omitted. */
  @IsOptional() @IsNumber() @Min(0)
  pensionablePay?: number;

  /** Which effective rate set to use; defaults to today. */
  @IsOptional() @IsISO8601()
  asOf?: string;
}
