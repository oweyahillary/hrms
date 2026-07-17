import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { LEAVE_APPROVAL_MODES } from '../../leave/leave-approver-policy';

/** All fields optional — a PATCH updates only what is provided. */
export class UpdateLeaveApprovalDto {
  @IsOptional() @IsIn(LEAVE_APPROVAL_MODES)
  leaveApprovalMode?: string;

  /**
   * The HR user who signs off leave. Send null to clear (which will leave
   * requests unapprovable, so the API warns about it).
   */
  @IsOptional() @IsUUID()
  leaveHrApproverUserId?: string | null;

  /**
   * Let employees pick their own approvers. Off by default: choosing who signs
   * off your own leave is a control weakness, so turning it on is a decision.
   */
  @IsOptional() @IsBoolean()
  allowEmployeeChosenApprovers?: boolean;
}
