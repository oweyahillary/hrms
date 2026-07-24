import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { GrantedPermissionDto } from './granted-permission.dto';

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60)
  name?: string;

  @IsOptional() @IsArray() @ArrayUnique((p: GrantedPermissionDto) => p.key) @ValidateNested({ each: true }) @Type(() => GrantedPermissionDto)
  permissions?: GrantedPermissionDto[];
}
