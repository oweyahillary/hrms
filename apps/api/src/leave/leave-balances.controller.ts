import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveBalancesService } from './leave-balances.service';
import { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto';
import { QueryLeaveBalanceDto } from './dto/query-leave-balance.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('leave-balances')
@ApiBearerAuth()
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly balances: LeaveBalancesService) {}

  @Post() @Permissions('leave.manage')
  upsert(@Body() dto: UpsertLeaveBalanceDto) { return this.balances.upsert(dto); }

  @Get() @Permissions('leave.manage')
  list(@Query() query: QueryLeaveBalanceDto) {
    return this.balances.listForEmployee(query.employeeId, query.year);
  }
}
