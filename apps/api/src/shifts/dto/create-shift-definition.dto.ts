import {
  IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftDefinitionDto {
  @IsString() @MaxLength(10)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'code may only contain letters, digits and hyphens' })
  code!: string;

  @IsString() @MaxLength(100)
  name!: string;

  @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24-hour)' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24-hour)' })
  endTime!: string;

  @IsOptional() @IsBoolean()
  crossesMidnight?: boolean;

  @IsOptional() @IsBoolean()
  isNightShift?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(480)
  breakMinutes?: number;
}
