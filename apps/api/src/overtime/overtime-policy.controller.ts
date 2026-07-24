import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OvertimePolicyService } from './overtime-policy.service';
import { CreateOvertimePolicyDto } from './dto/create-overtime-policy.dto';
import { UpdateOvertimePolicyDto } from './dto/update-overtime-policy.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('overtime-policies')
@ApiBearerAuth()
@Controller('overtime-policies')
export class OvertimePolicyController {
  constructor(private readonly policies: OvertimePolicyService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateOvertimePolicyDto) { return this.policies.create(dto); }

  @Get() @Roles(...MANAGE)
  list() { return this.policies.list(); }

  // Before ':id' so '/overtime-policies/effective' isn't captured as an id.
  @Get('effective') @Roles(...MANAGE)
  effective(@Query('asOf') asOf?: string) { return this.policies.effective(asOf); }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateOvertimePolicyDto) { return this.policies.update(id, dto); }

  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) { return this.policies.remove(id); }
}
