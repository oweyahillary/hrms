import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString() @MinLength(1)
  name!: string;

  @IsOptional() @IsBoolean()
  isPaid?: boolean;

  @IsOptional() @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional() @IsInt() @Min(0)
  maxDaysPerYear?: number;
}
