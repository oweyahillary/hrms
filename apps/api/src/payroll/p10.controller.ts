import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { P10Service } from './p10.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

function parsePeriod(year?: string, month?: string): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('year must be a valid four-digit year');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new BadRequestException('month must be an integer 1–12');
  return { year: y, month: m };
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/p10')
export class P10Controller {
  constructor(private readonly p10: P10Service) {}

  /**
   * KRA P10 Section B (employee details) import CSV for a period, ready to load
   * into P10_Return.xlsm via its "IMPORT CSV" button.
   */
  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  async sheetB(
    @Res({ passthrough: true }) res: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<StreamableFile> {
    const { year: y, month: m } = parsePeriod(year, month);
    const { csv, filename } = await this.p10.sheetBForPeriod(y, m);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }
}
