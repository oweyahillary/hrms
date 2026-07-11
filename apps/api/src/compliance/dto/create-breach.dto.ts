import { IsInt, IsISO8601, IsString, MaxLength, Min } from 'class-validator';

export class CreateBreachDto {
  @IsISO8601()
  detectedAt!: string;

  @IsString() @MaxLength(2000)
  description!: string;

  @IsInt() @Min(0)
  affectedEmployeeCount!: number;
}
