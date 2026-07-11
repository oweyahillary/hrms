import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayrollRunsService } from './payroll-runs.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { CreateCorrectionDto } from './dto/create-correction.dto';
import { FinalizeQueryDto } from './dto/finalize-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('payroll-runs')
@ApiBearerAuth()
@Controller('payroll/runs')
export class PayrollRunsController {
  constructor(private readonly runs: PayrollRunsService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Body() dto: CreatePayrollRunDto, @Query('__faultInject') faultInject?: string) {
    return this.runs.create(dto, faultInject);
  }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list() { return this.runs.list(); }

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  findOne(@Param('id') id: string) { return this.runs.findOne(id); }

  @Post(':id/finalize') @Roles(...HR_MANAGEMENT_ROLES)
  finalize(@Param('id') id: string, @Query() q: FinalizeQueryDto) {
    return this.runs.finalize(id, q.override === 'true');
  }

  @Post(':id/correction') @Roles(...HR_MANAGEMENT_ROLES)
  correction(@Param('id') id: string, @Body() dto: CreateCorrectionDto) {
    return this.runs.createCorrection(id, dto);
  }

  @Delete(':id') @Roles(...HR_MANAGEMENT_ROLES)
  remove(@Param('id') id: string) { return this.runs.remove(id); }
}
