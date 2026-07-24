import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceDevicesService } from './attendance-devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { ResolveUnmatchedDto } from './dto/resolve-unmatched.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('attendance-devices')
@ApiBearerAuth()
@Controller('attendance-devices')
export class AttendanceDevicesController {
  constructor(private readonly devices: AttendanceDevicesService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateDeviceDto) {
    return this.devices.create(dto);
  }

  @Get() @Roles(...MANAGE)
  list() {
    return this.devices.list();
  }

  @Get('unmatched-punches') @Roles(...MANAGE)
  listUnmatched() {
    return this.devices.listUnmatched();
  }

  @Post('unmatched-punches/resolve') @Roles(...MANAGE)
  resolveUnmatched(@Body() dto: ResolveUnmatchedDto) {
    return this.devices.resolveUnmatched(dto);
  }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(id, dto);
  }

  /** 409 if any punch still references this device — deactivate (PATCH active:false) instead. */
  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) {
    return this.devices.remove(id);
  }
}
