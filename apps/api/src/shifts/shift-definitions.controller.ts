import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShiftDefinitionsService } from './shift-definitions.service';
import { CreateShiftDefinitionDto } from './dto/create-shift-definition.dto';
import { UpdateShiftDefinitionDto } from './dto/update-shift-definition.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

const VIEW = ['shifts.view', 'shifts.manage'];

@ApiTags('shift-definitions')
@ApiBearerAuth()
@Controller('shift-definitions')
export class ShiftDefinitionsController {
  constructor(private readonly definitions: ShiftDefinitionsService) {}

  @Post() @Permissions('shifts.manage')
  create(@Body() dto: CreateShiftDefinitionDto) {
    return this.definitions.create(dto);
  }

  @Get() @AnyPermission(...VIEW)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.definitions.list(includeInactive === 'true');
  }

  @Get(':id') @AnyPermission(...VIEW)
  get(@Param('id') id: string) {
    return this.definitions.get(id);
  }

  @Patch(':id') @Permissions('shifts.manage')
  update(@Param('id') id: string, @Body() dto: UpdateShiftDefinitionDto) {
    return this.definitions.update(id, dto);
  }

  /** 409 if any roster assignment still references it — deactivate (PATCH active:false) instead. */
  @Delete(':id') @Permissions('shifts.manage')
  remove(@Param('id') id: string) {
    return this.definitions.remove(id);
  }
}
