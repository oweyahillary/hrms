import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { CreatePayrollAdjustmentDto } from './dto/create-payroll-adjustment.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('payroll-adjustments')
@ApiBearerAuth()
@Controller('employees/:employeeId/payroll-adjustments')
export class EmployeePayrollAdjustmentsController {
  constructor(private readonly svc: PayrollAdjustmentsService) {}

  @Post() @Permissions('payroll.manage')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreatePayrollAdjustmentDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Permissions('payroll.manage')
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }
}

@ApiTags('payroll-adjustments')
@ApiBearerAuth()
@Controller('payroll-adjustments')
export class PayrollAdjustmentsController {
  constructor(private readonly svc: PayrollAdjustmentsService) {}

  @Patch(':id/cancel') @Permissions('payroll.manage')
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
