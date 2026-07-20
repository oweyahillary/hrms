import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { SeveranceService } from './severance.service';
import { EmployeeSeveranceController, SeveranceController } from './severance.controller';

@Module({
  // PayrollModule exports StatutoryRatesService, used for the provisional PAYE pass.
  imports: [PayrollModule],
  controllers: [EmployeeSeveranceController, SeveranceController],
  providers: [SeveranceService],
  exports: [SeveranceService],
})
export class SeveranceModule {}
