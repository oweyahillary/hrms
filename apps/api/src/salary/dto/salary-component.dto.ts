import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SalaryComponentDto {
  @IsIn(['ALLOWANCE', 'DEDUCTION_VOLUNTARY'])
  componentType!: string;

  @IsString() @MaxLength(100)
  name!: string;

  @IsNumber() @Min(0)
  amount!: number;

  @IsOptional() @IsBoolean()
  isTaxable?: boolean;
}
