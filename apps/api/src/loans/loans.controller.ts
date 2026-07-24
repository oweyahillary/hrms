import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('loans')
@ApiBearerAuth()
@Controller('employees/:employeeId/loans')
export class EmployeeLoansController {
  constructor(private readonly svc: LoansService) {}

  @Post() @Permissions('payroll.manage')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateLoanDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Permissions('payroll.manage')
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }
}

@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get(':id') @Permissions('payroll.manage')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Patch(':id/cancel') @Permissions('payroll.manage')
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
