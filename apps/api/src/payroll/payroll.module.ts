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
import { P9Controller } from './p9.controller';
import { P9Service } from './p9.service';

@Module({
  controllers: [StatutoryRatesController, PayrollController, PayrollRunsController, BankExportController, P9Controller],
  providers: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService, P9Service],
  exports: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService, P9Service],
})
export class PayrollModule {}
