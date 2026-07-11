import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateBreachDto {
  @IsOptional() @IsIn(['OPEN', 'CONTAINED', 'CLOSED'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  affectedEmployeeCount?: number;
}
