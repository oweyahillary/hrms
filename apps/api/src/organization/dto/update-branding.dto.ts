import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** All fields optional — a PATCH updates only what is provided. */
export class UpdateBrandingDto {
  @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(60)
  kraPin?: string;

  @IsOptional() @IsString() @MaxLength(300)
  physicalAddress?: string;

  @IsOptional() @IsString() @MaxLength(100)
  registrationNumber?: string;

  @IsOptional() @IsString() @MaxLength(300)
  payslipNotice?: string;

  @IsOptional() @IsIn(['LEFT', 'CENTER', 'RIGHT'])
  logoAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be a 6-digit hex colour, e.g. #0c6355' })
  brandColor?: string;

  @IsOptional() @IsString() @MaxLength(40)
  bankAccountNumber?: string;

  @IsOptional() @IsString() @MaxLength(20)
  bankPurposeCode?: string;
}
