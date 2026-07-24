import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SeveranceService } from './severance.service';
import { CreateSeveranceDto } from './dto/create-severance.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('severance')
@ApiBearerAuth()
@Controller('employees/:employeeId/severance-calculations')
export class EmployeeSeveranceController {
  constructor(private readonly svc: SeveranceService) {}

  @Post() @Permissions('payroll.manage')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateSeveranceDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Permissions('payroll.manage')
  list(@Param('employeeId') employeeId: string) {
    return this.svc.list(employeeId);
  }
}

@ApiTags('severance')
@ApiBearerAuth()
@Controller('severance-calculations')
export class SeveranceController {
  constructor(private readonly svc: SeveranceService) {}

  @Get(':id') @Permissions('payroll.manage')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
}
