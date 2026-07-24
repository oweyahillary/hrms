import { Body, Controller, Delete, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { CreateCorrectionDto } from './dto/create-correction.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

// A payroll.finalize-only holder (a maker-checker "second approver") still
// needs to see the run before locking it, so view access is any of the three.
const VIEW = ['payroll.view', 'payroll.run', 'payroll.finalize'];

@ApiTags('payroll-runs')
@ApiBearerAuth()
@Controller('payroll/runs')
export class PayrollRunsController {
  constructor(
    private readonly runs: PayrollRunsService,
    private readonly pdf: PayslipPdfService,
  ) {}

  @Post() @Permissions('payroll.run')
  create(@Body() dto: CreatePayrollRunDto, @Query('__faultInject') faultInject?: string) {
    return this.runs.create(dto, faultInject);
  }

  @Get() @AnyPermission(...VIEW)
  list() { return this.runs.list(); }

  @Get(':id') @AnyPermission(...VIEW)
  findOne(@Param('id') id: string) { return this.runs.findOne(id); }

  @Post(':id/finalize') @Permissions('payroll.finalize')
  finalize(
    @Param('id') id: string,
    @Query('override') override?: string,
    // Test-only hook: skip the eager post-finalize PDF render so a NULL-pdfPath
    // finalized payslip exists for the immutability proof. Ignored in production.
    @Query('__skipPdf') skipPdf?: string,
  ) {
    return this.runs.finalize(id, override === 'true', skipPdf === 'true');
  }

  @Post(':id/correction') @Permissions('payroll.run')
  correction(@Param('id') id: string, @Body() dto: CreateCorrectionDto) {
    return this.runs.createCorrection(id, dto);
  }

  @Delete(':id') @Permissions('payroll.run')
  remove(@Param('id') id: string) { return this.runs.remove(id); }

  // Idempotent retry: (re)render any payslip PDFs not yet READY for this run.
  @Post(':id/payslips/pdf') @Permissions('payroll.run')
  generatePdfs(@Param('id') id: string) {
    return this.pdf.generateMissingForRun(id);
  }

  // Download a single payslip's PDF.
  @Get(':id/payslips/:pid/pdf') @AnyPermission(...VIEW)
  async downloadPayslipPdf(
    @Param('id') id: string,
    @Param('pid') pid: string,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.pdf.getPayslipPdf(id, pid);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
