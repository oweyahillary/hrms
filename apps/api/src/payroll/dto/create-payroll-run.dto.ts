import { IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreatePayrollRunDto {
  @IsInt() @Min(1) @Max(12)
  periodMonth!: number;

  @IsInt() @Min(2000) @Max(2100)
  periodYear!: number;

  // When omitted, runs for all ACTIVE/ON_LEAVE employees with an effective structure.
  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  employeeIds?: string[];

  @IsOptional() @IsBoolean()
  roundNetToShilling?: boolean;
}
