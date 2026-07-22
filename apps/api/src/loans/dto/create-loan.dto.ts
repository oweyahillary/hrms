import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateLoanDto {
  @IsIn(['LOAN', 'ADVANCE'])
  type!: string;

  @IsNumber() @Min(1)
  principal!: number;

  @IsOptional() @IsNumber() @Min(0)
  interestRate?: number;

  @IsInt() @Min(1)
  numberOfInstallments!: number;

  @IsDateString()
  disbursedDate!: string;

  // Required, matching PayrollAdjustment.reason — loans are the most exposed
  // legally, so the "why" must always be on record.
  @IsString() @IsNotEmpty()
  reason!: string;
}
