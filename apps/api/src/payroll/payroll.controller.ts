import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { PreviewPayrollDto } from './dto/preview-payroll.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Post('preview') @Roles(...HR_MANAGEMENT_ROLES)
  preview(@Body() dto: PreviewPayrollDto) { return this.payroll.preview(dto); }
}
