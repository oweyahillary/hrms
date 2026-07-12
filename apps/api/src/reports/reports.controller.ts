import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

function parsePeriod(year?: string, month?: string): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new BadRequestException('year must be a valid four-digit year');
  }
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new BadRequestException('month must be an integer 1–12');
  }
  return { year: y, month: m };
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('payroll-summary') @Roles(...HR_MANAGEMENT_ROLES)
  payrollSummary(@Query('year') year?: string, @Query('month') month?: string) {
    const { year: y, month: m } = parsePeriod(year, month);
    return this.reports.payrollSummary(y, m);
  }

  @Get('statutory-remittance') @Roles(...HR_MANAGEMENT_ROLES)
  statutoryRemittance(@Query('year') year?: string, @Query('month') month?: string) {
    const { year: y, month: m } = parsePeriod(year, month);
    return this.reports.statutoryRemittance(y, m);
  }
}
