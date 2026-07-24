import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateDepartmentDto {
  @IsOptional() @IsString() @MinLength(1)
  name?: string;

  /** Re-parent (or send null to move to the top level). Rejected if it would create a cycle. */
  @IsOptional() @IsUUID()
  parentDepartmentId?: string | null;

  /** The employee who heads this department. Send null to clear. */
  @IsOptional() @IsUUID()
  headEmployeeId?: string | null;

  /** Deactivate (false) or reactivate (true) — hides it from pickers without deleting it. */
  @IsOptional() @IsBoolean()
  active?: boolean;
}
