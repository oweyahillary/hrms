import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SalaryStructuresService } from './salary-structures.service';
import { CreateSalaryStructureDto } from './dto/create-salary-structure.dto';
import { UpdateSalaryStructureDto } from './dto/update-salary-structure.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';
import { EffectiveQueryDto } from './dto/effective-query.dto';

@ApiTags('salary-structures')
@ApiBearerAuth()
@Controller('employees/:employeeId/salary-structures')
export class EmployeeSalaryStructuresController {
  constructor(private readonly svc: SalaryStructuresService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateSalaryStructureDto) {
    return this.svc.create(employeeId, dto);
  }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list(@Param('employeeId') employeeId: string) { return this.svc.list(employeeId); }

  @Get('effective') @Roles(...HR_MANAGEMENT_ROLES)
  effective(@Param('employeeId') employeeId: string, @Query() q: EffectiveQueryDto) {
    return this.svc.effective(employeeId, q.asOf);
  }
}

@ApiTags('salary-structures')
@ApiBearerAuth()
@Controller('salary-structures')
export class SalaryStructuresController {
  constructor(private readonly svc: SalaryStructuresService) {}

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Patch(':id') @Roles(...HR_MANAGEMENT_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateSalaryStructureDto) { return this.svc.update(id, dto); }

  @Delete(':id') @Roles(...HR_MANAGEMENT_ROLES)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
