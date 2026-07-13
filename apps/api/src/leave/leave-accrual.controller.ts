import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveAccrualService } from './leave-accrual.service';
import { RunAccrualDto } from './dto/run-accrual.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('leave-accrual')
@ApiBearerAuth()
@Controller('leave/accrual')
export class LeaveAccrualController {
  constructor(private readonly accrual: LeaveAccrualService) {}

  /** Idempotently accrue leave for a period (defaults to the current month). */
  @Post('run') @Roles(...MANAGE)
  run(@Body() dto: RunAccrualDto) {
    const now = new Date();
    const year = dto.year ?? now.getUTCFullYear();
    const month = dto.month ?? now.getUTCMonth() + 1;
    return this.accrual.runAccrual(year, month);
  }
}
