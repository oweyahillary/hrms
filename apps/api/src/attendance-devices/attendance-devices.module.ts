import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AttendanceDevicesController } from './attendance-devices.controller';
import { IclockController } from './iclock.controller';
import { AttendanceDevicesService } from './attendance-devices.service';

@Module({
  imports: [AttendanceModule],
  controllers: [AttendanceDevicesController, IclockController],
  providers: [AttendanceDevicesService],
})
export class AttendanceDevicesModule {}
