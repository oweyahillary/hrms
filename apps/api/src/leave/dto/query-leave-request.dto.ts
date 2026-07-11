import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryLeaveRequestDto {
  @IsOptional() @IsUUID()
  employeeId?: string;

  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: string;
}
