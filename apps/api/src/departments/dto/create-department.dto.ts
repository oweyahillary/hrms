import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @IsString() @MinLength(1)
  name!: string;

  @IsOptional() @IsUUID()
  parentDepartmentId?: string;

  /**
   * The employee who heads this department. They approve their team's leave.
   * Send null to clear.
   */
  @IsOptional() @IsUUID()
  headEmployeeId?: string | null;
}
