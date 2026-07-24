import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSION_KEYS } from '../../auth/permissions';

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60)
  name?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: string[];
}
