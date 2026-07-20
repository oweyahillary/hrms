import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SeveranceService } from './severance.service';
import { CreateSeveranceDto } from './dto/create-severance.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('severance')
@ApiBearerAuth()
@Controller('employees/:employeeId/severance-calculations')
export class EmployeeSeveranceController {
  constructor(private readonly svc: SeveranceService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateSeveranceDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list(@Param('employeeId') employeeId: string) {
    return this.svc.list(employeeId);
  }
}

@ApiTags('severance')
@ApiBearerAuth()
@Controller('severance-calculations')
export class SeveranceController {
  constructor(private readonly svc: SeveranceService) {}

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
}
