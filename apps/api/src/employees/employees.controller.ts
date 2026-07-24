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
import { CreateLoginDto } from './dto/create-login.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @Permissions('employees.write')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.create(dto, user);
  }

  // The list payload carries no PII (see LIST_SELECT), so unlike the other
  // reads it doesn't need the caller's permissions to decide masking. Not
  // gated on any permission today (pre-dates this migration; see PR notes).
  @Get()
  list(@Query() query: ListEmployeesDto) {
    return this.employees.list(query);
  }

  // Declared BEFORE :id so '/employees/lookup' isn't captured as an id.
  @Get('lookup')
  @Permissions('pii.view')
  lookup(@Query() dto: LookupEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.lookupByNationalId(dto.nationalId, user);
  }

  /**
   * Preview of the next auto-allocated number, for pre-filling the create form.
   * Declared before @Get(':id') — Nest matches in order, so ':id' would
   * otherwise swallow 'next-number'.
   */
  @Get('next-number')
  nextNumber() {
    return this.employees.numberingPreview();
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.employees.get(id, user);
  }

  @Patch(':id')
  @Permissions('employees.write')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.update(id, dto, user);
  }

  @Post(':id/terminate')
  @Permissions('employees.write')
  @HttpCode(200)
  terminate(@Param('id') id: string, @Body() dto: TerminateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.terminate(id, dto, user);
  }

  @Post(':id/anonymize')
  @Permissions('employees.anonymize')
  anonymize(@Param('id') id: string) {
    return this.employees.anonymize(id);
  }

  // Granting 'Admin' is further restricted to Admin actors inside the service.
  @Post(':id/create-login')
  @Permissions('employees.write')
  createLogin(@Param('id') id: string, @Body() dto: CreateLoginDto, @CurrentUser() user: AuthUser) {
    return this.employees.createLogin(id, dto, user);
  }
}
