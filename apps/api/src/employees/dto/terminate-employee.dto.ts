import { IsDateString, IsOptional } from 'class-validator';

export class TerminateEmployeeDto {
  /** Defaults to today if omitted. */
  @IsOptional() @IsDateString()
  exitDate?: string;
}
