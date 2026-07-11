import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DsrService } from './dsr.service';
import { CreateDsrDto } from './dto/create-dsr.dto';
import { TransitionDsrDto } from './dto/transition-dsr.dto';
import { ListDsrDto } from './dto/list-dsr.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('compliance-dsr')
@ApiBearerAuth()
@Controller()
export class DsrController {
  constructor(private readonly dsr: DsrService) {}

  @Post('employees/:employeeId/data-subject-requests') @Roles(...HR_MANAGEMENT_ROLES)
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateDsrDto) {
    return this.dsr.create(employeeId, dto);
  }

  @Get('data-subject-requests') @Roles(...HR_MANAGEMENT_ROLES)
  list(@Query() q: ListDsrDto) { return this.dsr.list(q.status); }

  @Get('data-subject-requests/:id') @Roles(...HR_MANAGEMENT_ROLES)
  get(@Param('id') id: string) { return this.dsr.get(id); }

  @Patch('data-subject-requests/:id') @Roles(...HR_MANAGEMENT_ROLES)
  transition(@Param('id') id: string, @Body() dto: TransitionDsrDto) {
    return this.dsr.transition(id, dto);
  }
}
