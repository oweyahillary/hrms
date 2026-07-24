import { ArrayUnique, IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSION_KEYS } from '../../auth/permissions';

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(60)
  name!: string;

  @IsArray() @ArrayUnique() @IsIn(PERMISSION_KEYS, { each: true })
  permissions!: string[];
}
