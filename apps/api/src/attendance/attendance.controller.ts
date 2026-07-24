import {
  Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { UpsertAttendanceDto } from './dto/upsert-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import type { ImportPreset } from './attendance-import-presets';
import { Permissions } from '../auth/decorators/permissions.decorator';

interface UploadedCsv { buffer: Buffer; }
const MAX_CSV_BYTES = 5 * 1024 * 1024;

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post() @Permissions('attendance.manage')
  upsert(@Body() dto: UpsertAttendanceDto) {
    return this.attendance.upsert(dto);
  }

  @Get() @Permissions('attendance.manage')
  list(@Query() query: QueryAttendanceDto) {
    return this.attendance.list(query);
  }

  /** preset defaults to NEUTRAL (today's columns, unchanged) — pass preset=ZKTECO for a ZKTeco device export. */
  @Post('import') @Permissions('attendance.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES } }))
  import(@UploadedFile() file: UploadedCsv, @Query('preset') preset?: string) {
    return this.attendance.importCsv(file.buffer, preset === 'ZKTECO' ? 'ZKTECO' : ('NEUTRAL' satisfies ImportPreset));
  }
}
