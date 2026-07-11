import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { TerminateEmployeeDto } from './dto/terminate-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';
import { LookupEmployeeDto } from './dto/lookup-employee.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { PII_PRIVILEGED_ROLES } from './employee-pii';

const MANAGE = [...PII_PRIVILEGED_ROLES] as string[];

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @Roles(...MANAGE)
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.create(dto, user.role);
  }

  @Get()
  list(@Query() query: ListEmployeesDto, @CurrentUser() user: AuthUser) {
    return this.employees.list(query, user.role);
  }

  // Declared BEFORE :id so '/employees/lookup' isn't captured as an id.
  @Get('lookup')
  @Roles(...MANAGE)
  lookup(@Query() dto: LookupEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.lookupByNationalId(dto.nationalId, user.role);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.employees.get(id, user.role);
  }

  @Patch(':id')
  @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.update(id, dto, user.role);
  }

  @Post(':id/terminate')
  @Roles(...MANAGE)
  @HttpCode(200)
  terminate(@Param('id') id: string, @Body() dto: TerminateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.terminate(id, dto, user.role);
  }

  @Post(':id/anonymize')
  @Roles('Admin')
  anonymize(@Param('id') id: string) {
    return this.employees.anonymize(id);
  }
}
