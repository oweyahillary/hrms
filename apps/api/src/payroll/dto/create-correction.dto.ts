import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateCorrectionDto {
  // Corrections target specific employees whose original payslips need fixing.
  @IsArray() @ArrayNotEmpty() @IsUUID('all', { each: true })
  employeeIds!: string[];

  @IsOptional() @IsBoolean()
  roundNetToShilling?: boolean;
}
