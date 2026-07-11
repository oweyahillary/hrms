import { IsInt, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class UpsertLeaveBalanceDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsInt() @Min(2000)
  year!: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  accruedDays!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  carriedOverDays?: number;
}
