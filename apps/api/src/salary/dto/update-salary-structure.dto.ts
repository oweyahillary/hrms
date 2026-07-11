import { Type } from 'class-transformer';
import {
  IsArray, IsISO8601, IsNumber, IsOptional, Min, ValidateNested,
} from 'class-validator';
import { SalaryComponentDto } from './salary-component.dto';

export class UpdateSalaryStructureDto {
  @IsOptional() @IsNumber() @Min(0)
  basicSalary?: number;

  @IsOptional() @IsISO8601()
  endDate?: string;

  // If provided, replaces the full component set.
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
