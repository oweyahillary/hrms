import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveBalancesService } from './leave-balances.service';
import { UpsertLeaveBalanceDto } from './dto/upsert-leave-balance.dto';
import { QueryLeaveBalanceDto } from './dto/query-leave-balance.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('leave-balances')
@ApiBearerAuth()
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly balances: LeaveBalancesService) {}

  @Post() @Roles(...MANAGE)
  upsert(@Body() dto: UpsertLeaveBalanceDto) { return this.balances.upsert(dto); }

  @Get() @Roles(...MANAGE)
  list(@Query() query: QueryLeaveBalanceDto) {
    return this.balances.listForEmployee(query.employeeId, query.year);
  }
}
