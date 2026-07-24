import {
  Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ShiftRosterService } from './shift-roster.service';
import { UpsertRosterDto } from './dto/upsert-roster.dto';
import { QueryRosterDto } from './dto/query-roster.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

interface UploadedFileLike { buffer: Buffer; originalname: string; mimetype: string }

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Explicit ?format= wins; otherwise inferred from the upload's mimetype/filename. */
function resolveFormat(explicit: string | undefined, file: UploadedFileLike): 'csv' | 'xlsx' {
  if (explicit === 'csv' || explicit === 'xlsx') return explicit;
  const isXlsx = file.mimetype.includes('spreadsheetml') || file.originalname.toLowerCase().endsWith('.xlsx');
  return isXlsx ? 'xlsx' : 'csv';
}

@ApiTags('shift-roster')
@ApiBearerAuth()
@Controller('shifts/roster')
export class ShiftRosterController {
  constructor(private readonly roster: ShiftRosterService) {}

  @Get() @Roles(...MANAGE)
  get(@Query() query: QueryRosterDto) {
    return this.roster.getRoster(query);
  }

  @Post() @Roles(...MANAGE)
  upsert(@Body() dto: UpsertRosterDto) {
    return this.roster.upsert(dto);
  }

  @Post('import')
  @Roles(...MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  import(@UploadedFile() file: UploadedFileLike, @Query('format') format?: string) {
    return this.roster.importFile(file.buffer, resolveFormat(format, file));
  }

  /** Clears a single day's assignment. */
  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) {
    return this.roster.remove(id);
  }
}
