import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveTypesService } from './leave-types.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('leave-types')
@ApiBearerAuth()
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypes: LeaveTypesService) {}

  @Post() @Permissions('leave.manage')
  create(@Body() dto: CreateLeaveTypeDto) { return this.leaveTypes.create(dto); }

  @Get()
  list() { return this.leaveTypes.list(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.leaveTypes.get(id); }

  @Patch(':id') @Permissions('leave.manage')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) { return this.leaveTypes.update(id, dto); }

  @Delete(':id') @Permissions('leave.manage')
  remove(@Param('id') id: string) { return this.leaveTypes.remove(id); }
}
