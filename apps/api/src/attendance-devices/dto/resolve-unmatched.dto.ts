import { IsString, IsUUID, MinLength } from 'class-validator';

export class ResolveUnmatchedDto {
  @IsString() @MinLength(1)
  devicePin!: string;

  @IsUUID()
  employeeId!: string;
}
