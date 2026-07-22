import { IsEmail, IsOptional, IsUUID } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  /** The role to grant. Must be a role in the caller's organisation. */
  @IsUUID()
  roleId!: string;

  /** Optional link to the employee this login belongs to (drives the display name). */
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
