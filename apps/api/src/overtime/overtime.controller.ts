import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OvertimeService } from './overtime.service';
import { CreateOvertimeEntryDto } from './dto/create-overtime-entry.dto';
import { QueryOvertimeDto } from './dto/query-overtime.dto';
import { DeriveOvertimeDto } from './dto/derive-overtime.dto';
import { RejectOvertimeDto } from './dto/reject-overtime.dto';
import { BulkApproveOvertimeDto } from './dto/bulk-approve-overtime.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

// payroll.manage is a temporary mapping — overtime predates the granular permission
// catalogue and never had its own key; see feat/granular-permissions for the split.
const MANAGE = 'payroll.manage';

@ApiTags('overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  /** Generates/updates PENDING DERIVED entries for the range from existing attendance + shift data. Idempotent — see OvertimeService.derive. */
  @Post('derive') @Permissions(MANAGE)
  derive(@Body() dto: DeriveOvertimeDto) { return this.overtime.derive(dto); }

  @Post() @Permissions(MANAGE)
  create(@Body() dto: CreateOvertimeEntryDto) { return this.overtime.createManual(dto); }

  @Get() @Permissions(MANAGE)
  list(@Query() query: QueryOvertimeDto) { return this.overtime.list(query); }

  @Post('bulk-approve') @Permissions(MANAGE)
  bulkApprove(@Body() dto: BulkApproveOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.bulkApprove(dto, user); }

  @Get(':id') @Permissions(MANAGE)
  get(@Param('id') id: string) { return this.overtime.get(id); }

  @Patch(':id') @Permissions(MANAGE)
  update(@Param('id') id: string, @Body() dto: Partial<CreateOvertimeEntryDto>) { return this.overtime.update(id, dto); }

  @Delete(':id') @Permissions(MANAGE)
  remove(@Param('id') id: string) { return this.overtime.remove(id); }

  @Post(':id/approve') @Permissions(MANAGE)
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.overtime.approve(id, user); }

  @Post(':id/reject') @Permissions(MANAGE)
  reject(@Param('id') id: string, @Body() dto: RejectOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.reject(id, dto, user); }
}
