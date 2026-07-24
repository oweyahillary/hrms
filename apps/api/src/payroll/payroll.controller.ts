import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollService } from './payroll.service';
import { PreviewPayrollDto } from './dto/preview-payroll.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Post('preview') @Permissions('payroll.run')
  preview(@Body() dto: PreviewPayrollDto) { return this.payroll.preview(dto); }
}
