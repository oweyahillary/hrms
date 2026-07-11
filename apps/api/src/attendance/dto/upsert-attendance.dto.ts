import { IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class UpsertAttendanceDto {
  @IsUUID()
  employeeId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsOptional() @IsISO8601()
  clockIn?: string;

  @IsOptional() @IsISO8601()
  clockOut?: string;

  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'])
  status?: string;
}
