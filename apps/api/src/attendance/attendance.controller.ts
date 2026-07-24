import {
  Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { UpsertAttendanceDto } from './dto/upsert-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import type { ImportPreset } from './attendance-import-presets';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

interface UploadedCsv { buffer: Buffer; }
const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];
const MAX_CSV_BYTES = 5 * 1024 * 1024;

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post() @Roles(...MANAGE)
  upsert(@Body() dto: UpsertAttendanceDto) {
    return this.attendance.upsert(dto);
  }

  @Get() @Roles(...MANAGE)
  list(@Query() query: QueryAttendanceDto) {
    return this.attendance.list(query);
  }

  /** preset defaults to NEUTRAL (today's columns, unchanged) — pass preset=ZKTECO for a ZKTeco device export. */
  @Post('import') @Roles(...MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CSV_BYTES } }))
  import(@UploadedFile() file: UploadedCsv, @Query('preset') preset?: string) {
    return this.attendance.importCsv(file.buffer, preset === 'ZKTECO' ? 'ZKTECO' : ('NEUTRAL' satisfies ImportPreset));
  }
}
