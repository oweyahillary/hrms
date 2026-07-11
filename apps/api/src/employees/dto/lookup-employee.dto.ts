import { Matches } from 'class-validator';
import { NATIONAL_ID_REGEX } from '../../common/validation/kenya';

export class LookupEmployeeDto {
  @Matches(NATIONAL_ID_REGEX, { message: 'nationalId must be 7–8 digits' })
  nationalId!: string;
}
