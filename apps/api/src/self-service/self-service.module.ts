import { Module } from '@nestjs/common';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';
import { PayrollModule } from '../payroll/payroll.module';
import { LeaveModule } from '../leave/leave.module';

// PrismaModule and CryptoModule are @Global. PayrollModule (for
// PayslipPdfService) and LeaveModule (for LeaveRequestsService /
// LeaveBalancesService) are imported explicitly so their exported providers
// are available for injection here.
@Module({
  imports: [PayrollModule, LeaveModule],
  controllers: [SelfServiceController],
  providers: [SelfServiceService],
})
export class SelfServiceModule {}
