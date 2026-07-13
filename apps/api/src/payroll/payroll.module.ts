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
import { P10Controller } from './p10.controller';
import { P10Service } from './p10.service';

@Module({
  controllers: [StatutoryRatesController, PayrollController, PayrollRunsController, BankExportController, P9Controller, P10Controller],
  providers: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService, P9Service, P10Service],
  exports: [StatutoryRatesService, PayrollService, PayrollRunsService, PayslipPdfService, BankExportService, P9Service, P10Service],
})
export class PayrollModule {}
