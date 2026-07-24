import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OvertimeService } from './overtime.service';
import { CreateOvertimeEntryDto } from './dto/create-overtime-entry.dto';
import { QueryOvertimeDto } from './dto/query-overtime.dto';
import { DeriveOvertimeDto } from './dto/derive-overtime.dto';
import { RejectOvertimeDto } from './dto/reject-overtime.dto';
import { BulkApproveOvertimeDto } from './dto/bulk-approve-overtime.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  /** Generates/updates PENDING DERIVED entries for the range from existing attendance + shift data. Idempotent — see OvertimeService.derive. */
  @Post('derive') @Roles(...MANAGE)
  derive(@Body() dto: DeriveOvertimeDto) { return this.overtime.derive(dto); }

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateOvertimeEntryDto) { return this.overtime.createManual(dto); }

  @Get() @Roles(...MANAGE)
  list(@Query() query: QueryOvertimeDto) { return this.overtime.list(query); }

  @Post('bulk-approve') @Roles(...MANAGE)
  bulkApprove(@Body() dto: BulkApproveOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.bulkApprove(dto, user); }

  @Get(':id') @Roles(...MANAGE)
  get(@Param('id') id: string) { return this.overtime.get(id); }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: Partial<CreateOvertimeEntryDto>) { return this.overtime.update(id, dto); }

  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) { return this.overtime.remove(id); }

  @Post(':id/approve') @Roles(...MANAGE)
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.overtime.approve(id, user); }

  @Post(':id/reject') @Roles(...MANAGE)
  reject(@Param('id') id: string, @Body() dto: RejectOvertimeDto, @CurrentUser() user: AuthUser) { return this.overtime.reject(id, dto, user); }
}
