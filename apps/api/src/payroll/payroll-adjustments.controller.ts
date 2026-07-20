import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollAdjustmentsService } from './payroll-adjustments.service';
import { CreatePayrollAdjustmentDto } from './dto/create-payroll-adjustment.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('payroll-adjustments')
@ApiBearerAuth()
@Controller('employees/:employeeId/payroll-adjustments')
export class EmployeePayrollAdjustmentsController {
  constructor(private readonly svc: PayrollAdjustmentsService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Param('employeeId') employeeId: string, @Body() dto: CreatePayrollAdjustmentDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }
}

@ApiTags('payroll-adjustments')
@ApiBearerAuth()
@Controller('payroll-adjustments')
export class PayrollAdjustmentsController {
  constructor(private readonly svc: PayrollAdjustmentsService) {}

  @Patch(':id/cancel') @Roles(...HR_MANAGEMENT_ROLES)
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
