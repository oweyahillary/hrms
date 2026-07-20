import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @IsOptional() @IsString()
  reason?: string;
}
