import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

/** A manual overtime entry — HR recording hours the derive pass didn't (or couldn't) pick up. */
export class CreateOvertimeEntryDto {
  @IsUUID()
  employeeId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsNumber() @Min(0.25) @Max(24)
  hours!: number;

  @IsIn(['NORMAL_DAY', 'REST_DAY', 'HOLIDAY'])
  category!: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
