import { Module } from '@nestjs/common';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';

@Module({
  controllers: [LeaveTypesController, LeaveBalancesController, LeaveRequestsController],
  providers: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService],
  exports: [LeaveTypesService, LeaveBalancesService, LeaveRequestsService],
})
export class LeaveModule {}
