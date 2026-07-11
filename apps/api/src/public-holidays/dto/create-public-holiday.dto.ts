import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreatePublicHolidayDto {
  @IsDateString()
  date!: string;

  @IsString() @MinLength(1)
  name!: string;
}
