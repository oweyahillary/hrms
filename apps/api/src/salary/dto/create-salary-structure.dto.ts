import { Type } from 'class-transformer';
import {
  IsArray, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';
import { SalaryComponentDto } from './salary-component.dto';

export class CreateSalaryStructureDto {
  @IsNumber() @Min(0)
  basicSalary!: number;

  @IsISO8601()
  effectiveDate!: string;

  @IsOptional() @IsISO8601()
  endDate?: string;

  // Required — the audit trail for a pay revision (matches Loan/PayrollAdjustment.reason).
  @IsString() @IsNotEmpty()
  reason!: string;

  // Optional — the approver, when distinct from whoever entered the revision.
  @IsOptional() @IsUUID()
  approvedById?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];
}
