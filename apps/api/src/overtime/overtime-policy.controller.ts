import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OvertimePolicyService } from './overtime-policy.service';
import { CreateOvertimePolicyDto } from './dto/create-overtime-policy.dto';
import { UpdateOvertimePolicyDto } from './dto/update-overtime-policy.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

const MANAGE = 'overtime.manage';

@ApiTags('overtime-policies')
@ApiBearerAuth()
@Controller('overtime-policies')
export class OvertimePolicyController {
  constructor(private readonly policies: OvertimePolicyService) {}

  @Post() @Permissions(MANAGE)
  create(@Body() dto: CreateOvertimePolicyDto) { return this.policies.create(dto); }

  @Get() @Permissions(MANAGE)
  list() { return this.policies.list(); }

  // Before ':id' so '/overtime-policies/effective' isn't captured as an id.
  @Get('effective') @Permissions(MANAGE)
  effective(@Query('asOf') asOf?: string) { return this.policies.effective(asOf); }

  @Patch(':id') @Permissions(MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateOvertimePolicyDto) { return this.policies.update(id, dto); }

  @Delete(':id') @Permissions(MANAGE)
  remove(@Param('id') id: string) { return this.policies.remove(id); }
}
