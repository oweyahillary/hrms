import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateUserDto {
  /** Deactivate (false) or reactivate (true) the login. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Change the user's role. */
  @IsOptional()
  @IsUUID()
  roleId?: string;
}
