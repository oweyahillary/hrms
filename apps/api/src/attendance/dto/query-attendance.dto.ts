import { IsOptional, IsUUID, Matches } from 'class-validator';

export class QueryAttendanceDto {
  /** Omit for an org-wide register (optionally narrowed by departmentId). */
  @IsOptional() @IsUUID()
  employeeId?: string;

  /** Only meaningful when employeeId is omitted — narrows the org-wide register to one department. */
  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
