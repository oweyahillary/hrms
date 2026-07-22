import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles('Admin')
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
@Roles('Admin')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listRoles();
  }
}
