import { Injectable } from '@nestjs/common';
import { StatutoryRatesService } from './statutory-rates.service';
import { assembleRateSet } from './rate-set';
import { computePayroll } from './payroll-engine';
import type { PreviewPayrollDto } from './dto/preview-payroll.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly rates: StatutoryRatesService) {}

  /** Non-persisting: compute a full statutory breakdown for one gross figure. */
  async preview(dto: PreviewPayrollDto) {
    const eff = await this.rates.effective(dto.asOf);
    const rateSet = assembleRateSet(eff.rates);
    const breakdown = computePayroll(
      { grossPay: dto.grossPay, pensionablePay: dto.pensionablePay }, rateSet,
    );
    return { asOf: eff.asOf, breakdown };
  }
}
