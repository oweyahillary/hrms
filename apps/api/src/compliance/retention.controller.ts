import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { UpsertRetentionPolicyDto } from './dto/retention-policy.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('compliance-retention')
@ApiBearerAuth()
@Controller('retention-policies')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Put() @Permissions('compliance.manage')
  upsert(@Body() dto: UpsertRetentionPolicyDto) { return this.retention.upsert(dto); }

  @Get() @Permissions('compliance.manage')
  list() { return this.retention.list(); }

  @Get(':id') @Permissions('compliance.manage')
  get(@Param('id') id: string) { return this.retention.get(id); }

  @Delete(':id') @Permissions('compliance.manage')
  remove(@Param('id') id: string) { return this.retention.remove(id); }
}
