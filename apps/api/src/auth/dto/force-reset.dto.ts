import { IsEmail } from 'class-validator';

export class ForceResetDto {
  @IsEmail()
  email!: string;
}
