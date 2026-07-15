import { Module } from '@nestjs/common';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveAccrualController } from './leave-accrual.controller';
import { LeaveAccrualService } from './leave-accrual.service';

@Module({
  controllers: [LeaveTypesController, LeaveBalancesController, LeaveRequestsController, LeaveAccrualController],
  providers: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService, LeaveAccrualService],
  exports: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService, LeaveAccrualService],
})
export class LeaveModule {}
