import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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

  @Get('year-trend') @Roles(...HR_MANAGEMENT_ROLES)
  yearTrend(@Query('year') year?: string) {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      throw new BadRequestException('year must be a valid four-digit year');
    }
    return this.reports.yearTrend(y);
  }

  @Get('headcount') @Roles(...HR_MANAGEMENT_ROLES)
  headcount() {
    return this.reports.headcount();
  }

  @Get('statutory-remittance/pdf') @Roles(...HR_MANAGEMENT_ROLES)
  async remittancePdf(
    @Res({ passthrough: true }) res: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    const { year: y, month: m } = parsePeriod(year, month);
    const { buffer, filename } = await this.reports.remittancePdf(y, m);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get('payroll-summary/pdf') @Roles(...HR_MANAGEMENT_ROLES)
  async payrollSummaryPdf(
    @Res({ passthrough: true }) res: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    const { year: y, month: m } = parsePeriod(year, month);
    const { buffer, filename } = await this.reports.payrollSummaryPdf(y, m);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get('loan-book') @Roles(...HR_MANAGEMENT_ROLES)
  loanBook(@Query('employeeId') employeeId?: string, @Query('status') status?: string) {
    return this.reports.loanBook({ employeeId, status });
  }

  @Get('loan-book/pdf') @Roles(...HR_MANAGEMENT_ROLES)
  async loanBookPdf(
    @Res({ passthrough: true }) res: Response,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reports.loanBookPdf({ employeeId, status });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get('severance-register') @Roles(...HR_MANAGEMENT_ROLES)
  severanceRegister() {
    return this.reports.severanceRegister();
  }

  @Get('severance-register/pdf') @Roles(...HR_MANAGEMENT_ROLES)
  async severanceRegisterPdf(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { buffer, filename } = await this.reports.severanceRegisterPdf();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Get('adjustments-register') @Roles(...HR_MANAGEMENT_ROLES)
  adjustmentsRegister(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.reports.adjustmentsRegister({
      employeeId, status,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
  }

  @Get('adjustments-register/pdf') @Roles(...HR_MANAGEMENT_ROLES)
  async adjustmentsRegisterPdf(
    @Res({ passthrough: true }) res: Response,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reports.adjustmentsRegisterPdf({
      employeeId, status,
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }
}
