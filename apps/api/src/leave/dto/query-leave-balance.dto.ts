import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class QueryLeaveBalanceDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(2000)
  year?: number;
}
