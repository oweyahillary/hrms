import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  /** Ordered list of approver user IDs; each approves in turn. */
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true })
  approverUserIds!: string[];
}
