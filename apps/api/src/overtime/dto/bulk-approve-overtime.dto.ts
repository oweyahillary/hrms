import { IsOptional, IsUUID, Matches } from 'class-validator';

export class BulkApproveOvertimeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @IsOptional() @IsUUID()
  departmentId?: string;
}
