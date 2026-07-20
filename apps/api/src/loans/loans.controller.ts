import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('loans')
@ApiBearerAuth()
@Controller('employees/:employeeId/loans')
export class EmployeeLoansController {
  constructor(private readonly svc: LoansService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateLoanDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }
}

@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Patch(':id/cancel') @Roles(...HR_MANAGEMENT_ROLES)
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
