import { BadRequestException, Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { P9Service } from './p9.service';
import { Permissions } from '../auth/decorators/permissions.decorator';

function parseYear(year: string | undefined): number {
  const y = year ? Number(year) : new Date().getUTCFullYear();
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new BadRequestException('year must be a valid four-digit year');
  }
  return y;
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('employees')
export class P9Controller {
  constructor(private readonly p9: P9Service) {}

  @Get(':id/p9') @Permissions('payroll.manage')
  card(@Param('id') id: string, @Query('year') year?: string) {
    return this.p9.cardForEmployee(id, parseYear(year));
  }

  @Get(':id/p9/pdf') @Permissions('payroll.manage')
  async pdf(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('year') year?: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.p9.pdfForEmployee(id, parseYear(year));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }
}
