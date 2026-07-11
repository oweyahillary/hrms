import { Module } from '@nestjs/common';
import { StatutoryRatesController } from './statutory-rates.controller';
import { StatutoryRatesService } from './statutory-rates.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';

@Module({
  controllers: [StatutoryRatesController, PayrollController, PayrollRunsController],
  providers: [StatutoryRatesService, PayrollService, PayrollRunsService],
  exports: [StatutoryRatesService, PayrollService, PayrollRunsService],
})
export class PayrollModule {}
