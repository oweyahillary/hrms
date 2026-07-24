import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveAccrualService } from './leave-accrual.service';
import { RunAccrualDto } from './dto/run-accrual.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('leave-accrual')
@ApiBearerAuth()
@Controller('leave/accrual')
export class LeaveAccrualController {
  constructor(private readonly accrual: LeaveAccrualService) {}

  /** Idempotently accrue leave for a period (defaults to the current month). */
  @Post('run') @Permissions('leave.manage')
  run(@Body() dto: RunAccrualDto) {
    const now = new Date();
    const year = dto.year ?? now.getUTCFullYear();
    const month = dto.month ?? now.getUTCMonth() + 1;
    return this.accrual.runAccrual(year, month);
  }
}
