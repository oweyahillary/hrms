import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** All fields optional — a PATCH updates only what is provided. */
export class UpdateAttendanceSettingsDto {
  @IsOptional()
  @IsInt() @Min(0) @Max(180)
  lateGraceMinutes?: number;
}
