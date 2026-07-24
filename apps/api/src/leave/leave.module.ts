import { Module } from '@nestjs/common';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveAccrualController } from './leave-accrual.controller';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveRolloverController } from './leave-rollover.controller';
import { LeaveRolloverService } from './leave-rollover.service';
import { AuthModule } from '../auth/auth.module';

// AuthModule is imported explicitly for DepartmentScopeService (OWN_DEPARTMENT scoping).
@Module({
  imports: [AuthModule],
  controllers: [
    LeaveTypesController, LeaveBalancesController, LeaveRequestsController,
    LeaveAccrualController, LeaveRolloverController,
  ],
  providers: [
    LeaveTypesService, LeaveBalancesService, LeaveRequestsService,
    LeaveAccrualService, LeaveRolloverService,
  ],
  exports: [
    LeaveTypesService, LeaveBalancesService, LeaveRequestsService,
    LeaveAccrualService, LeaveRolloverService,
  ],
})
export class LeaveModule {}
