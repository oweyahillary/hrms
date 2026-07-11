import { Type } from 'class-transformer';
import {
  IsArray, IsISO8601, IsNumber, IsOptional, Min, ValidateNested,
} from 'class-validator';
import { SalaryComponentDto } from './salary-component.dto';

export class CreateSalaryStructureDto {
  @IsNumber() @Min(0)
  basicSalary!: number;

  @IsISO8601()
  effectiveDate!: string;

  @IsOptional() @IsISO8601()
  endDate?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
