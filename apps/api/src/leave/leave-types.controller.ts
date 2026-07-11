import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveTypesService } from './leave-types.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('leave-types')
@ApiBearerAuth()
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateLeaveTypeDto) { return this.leaveTypes.create(dto); }

  @Get()
  list() { return this.leaveTypes.list(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.leaveTypes.get(id); }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) { return this.leaveTypes.update(id, dto); }

  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) { return this.leaveTypes.remove(id); }
}
