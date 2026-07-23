import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShiftDefinitionsService } from './shift-definitions.service';
import { CreateShiftDefinitionDto } from './dto/create-shift-definition.dto';
import { UpdateShiftDefinitionDto } from './dto/update-shift-definition.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('shift-definitions')
@ApiBearerAuth()
@Controller('shift-definitions')
export class ShiftDefinitionsController {
  constructor(private readonly definitions: ShiftDefinitionsService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateShiftDefinitionDto) {
    return this.definitions.create(dto);
  }

  @Get() @Roles(...MANAGE)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.definitions.list(includeInactive === 'true');
  }

  @Get(':id') @Roles(...MANAGE)
  get(@Param('id') id: string) {
    return this.definitions.get(id);
  }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateShiftDefinitionDto) {
    return this.definitions.update(id, dto);
  }

  /** 409 if any roster assignment still references it — deactivate (PATCH active:false) instead. */
  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) {
    return this.definitions.remove(id);
  }
}
