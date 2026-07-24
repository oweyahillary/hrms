import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

export class QueryOvertimeDto {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: string;

  @IsOptional() @IsUUID()
  employeeId?: string;

  /** Only meaningful when employeeId is omitted — narrows the org-wide queue to one department. */
  @IsOptional() @IsUUID()
  departmentId?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
