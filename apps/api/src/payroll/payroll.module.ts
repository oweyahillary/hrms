import { Module } from '@nestjs/common';
import { StatutoryRatesController } from './statutory-rates.controller';
import { StatutoryRatesService } from './statutory-rates.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { BankExportController } from './bank-export.controller';
import { BankExportService } from './bank-export.service';

@Module({
  controllers: [StatutoryRatesController, PayrollController, PayrollRunsController, BankExportController],
  providers: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService],
  exports: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService],
})
export class PayrollModule {}
