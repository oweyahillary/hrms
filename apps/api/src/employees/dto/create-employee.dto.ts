import {
  IsDateString, IsEmail, IsIn, IsObject, IsOptional, IsString, Matches, MinLength,
} from 'class-validator';
import { KENYA_PHONE_REGEX, KRA_PIN_REGEX, NATIONAL_ID_REGEX } from '../../common/validation/kenya';

export class CreateEmployeeDto {
  @IsString() @MinLength(1)
  employeeNumber!: string;

  @IsString() @MinLength(1)
  firstName!: string;

  @IsString() @MinLength(1)
  lastName!: string;

  @Matches(NATIONAL_ID_REGEX, { message: 'nationalId must be 7–8 digits' })
  nationalId!: string;

  @IsOptional() @Matches(KRA_PIN_REGEX, { message: 'kraPin must look like A012345678Z' })
  kraPin?: string;

  @IsOptional() @Matches(KENYA_PHONE_REGEX, { message: 'phone must be a valid Kenyan number' })
  phone?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsDateString()
  dateOfBirth?: string;

  @IsOptional() @IsString()
  gender?: string;

  @IsOptional() @IsString()
  departmentId?: string;

  @IsOptional() @IsString()
  jobTitleId?: string;

  @IsIn(['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN'])
  employmentType!: string;

  @IsDateString()
  hireDate!: string;

  @IsOptional() @IsString()
  bankName?: string;

  @IsOptional() @IsString() @MinLength(1)
  bankAccountNumber?: string;

  @IsOptional() @IsString()
  bankCode?: string;

  @IsOptional() @IsString()
  bankBranchCode?: string;

  @IsOptional() @IsObject()
  nextOfKin?: Record<string, unknown>;
}
