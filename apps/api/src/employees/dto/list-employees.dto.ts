import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListEmployeesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 25;

  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED'])
  status?: string;

  @IsOptional() @IsString()
  departmentId?: string;
}
