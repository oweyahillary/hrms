import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OvertimeService } from './overtime.service';
import { CreateOvertimeEntryDto } from './dto/create-overtime-entry.dto';
import { QueryOvertimeDto } from './dto/query-overtime.dto';
import { DeriveOvertimeDto } from './dto/derive-overtime.dto';
import { RejectOvertimeDto } from './dto/reject-overtime.dto';
import { BulkApproveOvertimeDto } from './dto/bulk-approve-overtime.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

const VIEW = ['overtime.view', 'overtime.approve', 'overtime.manage'];

@ApiTags('overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  /** Generates/updates PENDING DERIVED entries for the range from existing attendance + shift data. Idempotent — see OvertimeService.derive. */
  @Post('derive') @Permissions('overtime.manage')
  derive(@Body() dto: DeriveOvertimeDto) { return this.overtime.derive(dto); }

  @Post() @Permissions('overtime.manage')
  create(@Body() dto: CreateOvertimeEntryDto) { return this.overtime.createManual(dto); }

  @Get() @AnyPermission(...VIEW)
  list(@Query() query: QueryOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.list(query, user); }

  @Post('bulk-approve') @Permissions('overtime.approve')
  bulkApprove(@Body() dto: BulkApproveOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.bulkApprove(dto, user); }

  @Get(':id') @AnyPermission(...VIEW)
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.overtime.get(id, user); }

  @Patch(':id') @Permissions('overtime.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateOvertimeEntryDto>) { return this.overtime.update(id, dto); }

  @Delete(':id') @Permissions('overtime.manage')
  remove(@Param('id') id: string) { return this.overtime.remove(id); }

  @Post(':id/approve') @Permissions('overtime.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.overtime.approve(id, user); }

  @Post(':id/reject') @Permissions('overtime.approve')
  reject(@Param('id') id: string, @Body() dto: RejectOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.reject(id, dto, user); }
}
