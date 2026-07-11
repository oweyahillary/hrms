import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class QueryPublicHolidayDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000)
  year?: number;
}
