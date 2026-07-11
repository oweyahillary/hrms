import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { UpsertRetentionPolicyDto } from './dto/retention-policy.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('compliance-retention')
@ApiBearerAuth()
@Controller('retention-policies')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Put() @Roles(...HR_MANAGEMENT_ROLES)
  upsert(@Body() dto: UpsertRetentionPolicyDto) { return this.retention.upsert(dto); }

  @Get() @Roles(...HR_MANAGEMENT_ROLES)
  list() { return this.retention.list(); }

  @Get(':id') @Roles(...HR_MANAGEMENT_ROLES)
  get(@Param('id') id: string) { return this.retention.get(id); }

  @Delete(':id') @Roles(...HR_MANAGEMENT_ROLES)
  remove(@Param('id') id: string) { return this.retention.remove(id); }
}
