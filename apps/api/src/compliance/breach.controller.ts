import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BreachService } from './breach.service';
import { CreateBreachDto } from './dto/create-breach.dto';
import { UpdateBreachDto } from './dto/update-breach.dto';
import { ListBreachDto } from './dto/list-breach.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('compliance-breach')
@ApiBearerAuth()
@Controller('breach-incidents')
export class BreachController {
  constructor(private readonly breach: BreachService) {}

  @Post() @Roles(...HR_MANAGEMENT_ROLES)
  create(@Body() dto: CreateBreachDto) { return this.breach.create(dto); }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list(@Query() q: ListBreachDto) { return this.breach.list(q.status); }

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  get(@Param('id') id: string) { return this.breach.get(id); }

  @Patch(':id') @Roles(...HR_MANAGEMENT_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateBreachDto) { return this.breach.update(id, dto); }

  @Post(':id/notify-odpc') @Roles(...HR_MANAGEMENT_ROLES)
  notifyOdpc(@Param('id') id: string) { return this.breach.notifyOdpc(id); }

  @Post(':id/notify-employees') @Roles(...HR_MANAGEMENT_ROLES)
  notifyEmployees(@Param('id') id: string) { return this.breach.notifyEmployees(id); }
}
