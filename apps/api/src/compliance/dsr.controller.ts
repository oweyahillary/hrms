import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DsrService } from './dsr.service';
import { CreateDsrDto } from './dto/create-dsr.dto';
import { TransitionDsrDto } from './dto/transition-dsr.dto';
import { ListDsrDto } from './dto/list-dsr.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

const VIEW = ['compliance.view', 'compliance.manage'];

@ApiTags('compliance-dsr')
@ApiBearerAuth()
@Controller()
export class DsrController {
  constructor(private readonly dsr: DsrService) {}

  @Post('employees/:employeeId/data-subject-requests') @Permissions('compliance.manage')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateDsrDto) {
    return this.dsr.create(employeeId, dto);
  }

  @Get('data-subject-requests') @AnyPermission(...VIEW)
  list(@Query() q: ListDsrDto) { return this.dsr.list(q.status); }

  @Get('data-subject-requests/:id') @AnyPermission(...VIEW)
  get(@Param('id') id: string) { return this.dsr.get(id); }

  @Patch('data-subject-requests/:id') @Permissions('compliance.manage')
  transition(@Param('id') id: string, @Body() dto: TransitionDsrDto) {
    return this.dsr.transition(id, dto);
  }
}
