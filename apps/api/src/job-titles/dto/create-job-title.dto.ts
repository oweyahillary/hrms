import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateJobTitleDto {
  @IsString() @MinLength(1)
  title!: string;

  @IsOptional() @IsString()
  grade?: string;
}
