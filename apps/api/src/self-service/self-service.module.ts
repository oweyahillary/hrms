import { Module } from '@nestjs/common';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';
import { PayrollModule } from '../payroll/payroll.module';
import { LeaveModule } from '../leave/leave.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { AttendanceModule } from '../attendance/attendance.module';

// PrismaModule and CryptoModule are @Global. PayrollModule (for
// PayslipPdfService), LeaveModule (for LeaveRequestsService /
// LeaveBalancesService), ShiftsModule (for ShiftRosterService) and
// AttendanceModule (for AttendanceService) are imported explicitly so their
// exported providers are available for injection here.
@Module({
  imports: [PayrollModule, LeaveModule, ShiftsModule, AttendanceModule],
  controllers: [SelfServiceController],
  providers: [SelfServiceService],
})
export class SelfServiceModule {}
