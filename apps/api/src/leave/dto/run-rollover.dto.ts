import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RunRolloverDto {
  /** The leave year being closed. Defaults to last year. */
  @IsOptional() @IsInt() @Min(2000) @Max(2100)
  fromYear?: number;
}
