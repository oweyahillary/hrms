import { Module } from '@nestjs/common';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';
import { PayrollModule } from '../payroll/payroll.module';
import { LeaveModule } from '../leave/leave.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { EmployeesModule } from '../employees/employees.module';
import { AttendanceModule } from '../attendance/attendance.module';

// PrismaModule and CryptoModule are @Global. PayrollModule (for
// PayslipPdfService), LeaveModule (for LeaveRequestsService /
// LeaveBalancesService), ShiftsModule (for ShiftRosterService),
// EmployeesModule (for EmployeeDocumentsService) and AttendanceModule (for
// AttendanceService) are imported explicitly so their exported providers
// are available for injection here.
@Module({
  imports: [PayrollModule, LeaveModule, ShiftsModule, EmployeesModule, AttendanceModule],
  controllers: [SelfServiceController],
  providers: [SelfServiceService],
})
export class SelfServiceModule {}
