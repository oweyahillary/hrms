import { IsOptional, IsUUID, Matches } from 'class-validator';

export class QueryAttendanceDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
