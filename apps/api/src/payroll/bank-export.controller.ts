import {
  BadRequestException, Controller, Get, Param, Post, Query, Res, StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BankExportService } from './bank-export.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

type Format = 'CSV' | 'XLSX';
type Template = 'GENERIC' | 'EFT';

function parseFormats(q: string | undefined): Format[] {
  switch ((q ?? 'csv').toLowerCase()) {
    case 'csv': return ['CSV'];
    case 'xlsx': return ['XLSX'];
    case 'both': return ['CSV', 'XLSX'];
    default: throw new BadRequestException("format must be one of: csv, xlsx, both");
  }
}

function parseTemplate(q: string | undefined): Template {
  switch ((q ?? 'generic').toLowerCase()) {
    case 'generic': return 'GENERIC';
    case 'eft': return 'EFT';
    default: throw new BadRequestException("template must be one of: generic, eft");
  }
}

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/runs')
export class BankExportController {
  constructor(private readonly bank: BankExportService) {}

  @Post(':id/bank-export') @Permissions('payroll.manage')
  generate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('format') format?: string,
    @Query('template') template?: string,
  ) {
    return this.bank.generate(id, parseTemplate(template), parseFormats(format), user.userId);
  }

  @Get(':id/bank-exports') @Permissions('payroll.manage')
  list(@Param('id') id: string) {
    return this.bank.list(id);
  }

  @Get(':id/bank-exports/:batchId/download') @Permissions('payroll.manage')
  async download(
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.bank.download(id, batchId);
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `attachment; filename="${f.filename}"`,
    });
    return new StreamableFile(f.buffer);
  }
}
