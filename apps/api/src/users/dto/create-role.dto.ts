import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { GrantedPermissionDto } from './granted-permission.dto';

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(60)
  name!: string;

  @IsArray() @ArrayUnique((p: GrantedPermissionDto) => p.key) @ValidateNested({ each: true }) @Type(() => GrantedPermissionDto)
  permissions!: GrantedPermissionDto[];
}
