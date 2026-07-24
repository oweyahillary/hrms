import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Permissions('users.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query('isActive') isActive?: string, @Query('roleId') roleId?: string) {
    return this.users.list({
      isActive: isActive === undefined ? undefined : isActive === 'true',
      roleId,
    });
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.update(id, dto, actor.userId);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('roles')
@Permissions('users.manage')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  /** The full permission catalogue, for the Settings > Roles checkbox editor. Declared before ':id' for the same reason as elsewhere. */
  @Get('catalogue')
  catalogue() {
    return PERMISSIONS;
  }

  /** Ready-made permission sets for the "New role" picker. Also before ':id'. */
  @Get('templates')
  templates() {
    return this.users.templates();
  }

  @Get()
  list() {
    return this.users.listRoles();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.getRole(id);
  }

  @Post()
  create(@Body() dto: CreateRoleDto) {
    return this.users.createRole(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.users.updateRole(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.removeRole(id);
  }
}
