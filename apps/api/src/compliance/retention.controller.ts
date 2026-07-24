import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { UpsertRetentionPolicyDto } from './dto/retention-policy.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

const VIEW = ['compliance.view', 'compliance.manage'];

@ApiTags('compliance-retention')
@ApiBearerAuth()
@Controller('retention-policies')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Put() @Permissions('compliance.manage')
  upsert(@Body() dto: UpsertRetentionPolicyDto) { return this.retention.upsert(dto); }

  @Get() @AnyPermission(...VIEW)
  list() { return this.retention.list(); }

  @Get(':id') @AnyPermission(...VIEW)
  get(@Param('id') id: string) { return this.retention.get(id); }

  @Delete(':id') @Permissions('compliance.manage')
  remove(@Param('id') id: string) { return this.retention.remove(id); }
}
