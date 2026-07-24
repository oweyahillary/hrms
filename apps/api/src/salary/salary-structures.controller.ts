import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalaryStructuresService } from './salary-structures.service';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { UpdateSalaryStructureDto } from './dto/update-salary-structure.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { EffectiveQueryDto } from './dto/effective-query.dto';

@ApiTags('salary-structures')
@ApiBearerAuth()
@Controller('employees/:employeeId/salary-structures')
export class EmployeeSalaryStructuresController {
  constructor(private readonly svc: SalaryStructuresService) {}

  @Post() @Permissions('payroll.manage')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateSalaryStructureDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Permissions('payroll.manage')
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }

  @Get('effective') @Permissions('payroll.manage')
  effective(@Param('employeeId') employeeId: string, @Query() q: EffectiveQueryDto) {
    return this.svc.effective(employeeId, q.asOf);
  }
}

@ApiTags('salary-structures')
@ApiBearerAuth()
@Controller('salary-structures')
export class SalaryStructuresController {
  constructor(private readonly svc: SalaryStructuresService) {}

  @Get(':id') @Permissions('payroll.manage')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Patch(':id') @Permissions('payroll.manage')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryStructureDto) { return this.svc.update(id, dto); }

  @Delete(':id') @Permissions('payroll.manage')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
