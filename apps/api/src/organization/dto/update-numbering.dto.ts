import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import {
  EMPLOYEE_NUMBER_PREFIX_REGEX, MAX_PADDING, MIN_PADDING,
} from '../../employees/employee-number';

/** All fields optional — a PATCH updates only what is provided. */
export class UpdateNumberingDto {
  /**
   * Prefix for auto-allocated employee numbers, e.g. "VIVO" -> VIVO0001.
   * Send null to turn auto-numbering off (numbers must then be typed in).
   */
  @IsOptional()
  @Matches(EMPLOYEE_NUMBER_PREFIX_REGEX, {
    message: 'employeeNumberPrefix must be 1-12 characters: letters, digits, hyphen or underscore',
  })
  employeeNumberPrefix?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(MIN_PADDING) @Max(MAX_PADDING)
  employeeNumberPadding?: number;

  /**
   * The next counter value to hand out. Settable so a client migrating from an
   * existing scheme can start at, say, 57 rather than renumbering everyone.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  employeeNumberNextSeq?: number;
}
