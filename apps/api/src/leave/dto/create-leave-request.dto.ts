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

  /**
   * IGNORED unless the organisation has allowEmployeeChosenApprovers switched on.
   * Approvers are normally derived from the org's approval policy — an applicant
   * choosing who signs off their own leave is a control weakness.
   */
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true })
  approverUserIds?: string[];
}
