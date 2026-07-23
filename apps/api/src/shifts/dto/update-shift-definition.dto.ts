import {
  IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateShiftDefinitionDto {
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @IsOptional() @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24-hour)' })
  startTime?: string;

  @IsOptional() @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24-hour)' })
  endTime?: string;

  @IsOptional() @IsBoolean()
  crossesMidnight?: boolean;

  @IsOptional() @IsBoolean()
  isNightShift?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(480)
  breakMinutes?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
