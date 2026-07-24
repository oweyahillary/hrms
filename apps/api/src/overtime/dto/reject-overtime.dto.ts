import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectOvertimeDto {
  @IsString() @MinLength(1) @MaxLength(500)
  note!: string;
}
