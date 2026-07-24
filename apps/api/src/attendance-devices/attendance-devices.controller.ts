import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceDevicesService } from './attendance-devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { ResolveUnmatchedDto } from './dto/resolve-unmatched.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('attendance-devices')
@ApiBearerAuth()
@Controller('attendance-devices')
export class AttendanceDevicesController {
  constructor(private readonly devices: AttendanceDevicesService) {}

  @Post() @Permissions('attendance.manage')
  create(@Body() dto: CreateDeviceDto) {
    return this.devices.create(dto);
  }

  @Get() @Permissions('attendance.manage')
  list() {
    return this.devices.list();
  }

  @Get('unmatched-punches') @Permissions('attendance.manage')
  listUnmatched() {
    return this.devices.listUnmatched();
  }

  @Post('unmatched-punches/resolve') @Permissions('attendance.manage')
  resolveUnmatched(@Body() dto: ResolveUnmatchedDto) {
    return this.devices.resolveUnmatched(dto);
  }

  @Patch(':id') @Permissions('attendance.manage')
  update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(id, dto);
  }

  /** 409 if any punch still references this device — deactivate (PATCH active:false) instead. */
  @Delete(':id') @Permissions('attendance.manage')
  remove(@Param('id') id: string) {
    return this.devices.remove(id);
  }
}
