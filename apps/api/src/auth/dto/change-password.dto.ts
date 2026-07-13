import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  /**
   * Policy: 12–128 chars with at least one letter and one digit. Kept
   * deliberately simple (length is the dominant factor); the equality-with-old
   * and not-a-known-default checks live in the service.
   */
  @IsString()
  @MinLength(12, { message: 'New password must be at least 12 characters' })
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: 'New password must contain a letter' })
  @Matches(/\d/, { message: 'New password must contain a digit' })
  newPassword!: string;
}
