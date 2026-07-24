import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BreachService } from './breach.service';
import { CreateBreachDto } from './dto/create-breach.dto';
import { UpdateBreachDto } from './dto/update-breach.dto';
import { ListBreachDto } from './dto/list-breach.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

const VIEW = ['compliance.view', 'compliance.manage'];

@ApiTags('compliance-breach')
@ApiBearerAuth()
@Controller('breach-incidents')
export class BreachController {
  constructor(private readonly breach: BreachService) {}

  @Post() @Permissions('compliance.manage')
  create(@Body() dto: CreateBreachDto) { return this.breach.create(dto); }

  @Get() @AnyPermission(...VIEW)
  list(@Query() q: ListBreachDto) { return this.breach.list(q.status); }

  @Get(':id') @AnyPermission(...VIEW)
  get(@Param('id') id: string) { return this.breach.get(id); }

  @Patch(':id') @Permissions('compliance.manage')
  update(@Param('id') id: string, @Body() dto: UpdateBreachDto) { return this.breach.update(id, dto); }

  @Post(':id/notify-odpc') @Permissions('compliance.manage')
  notifyOdpc(@Param('id') id: string) { return this.breach.notifyOdpc(id); }

  @Post(':id/notify-employees') @Permissions('compliance.manage')
  notifyEmployees(@Param('id') id: string) { return this.breach.notifyEmployees(id); }
}
