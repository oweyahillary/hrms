import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDeviceDto {
  @IsString() @MinLength(1) @MaxLength(50)
  serialNumber!: string;

  @IsString() @MinLength(1) @MaxLength(100)
  name!: string;
}
