import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PublicHolidaysService } from './public-holidays.service';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { QueryPublicHolidayDto } from './dto/query-public-holiday.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('public-holidays')
@ApiBearerAuth()
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(private readonly holidays: PublicHolidaysService) {}

  @Post() @Permissions('shifts.manage')
  create(@Body() dto: CreatePublicHolidayDto) { return this.holidays.create(dto); }

  @Get()
  list(@Query() query: QueryPublicHolidayDto) { return this.holidays.list(query.year); }

  @Patch(':id') @Permissions('shifts.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePublicHolidayDto) { return this.holidays.update(id, dto); }

  @Delete(':id') @Permissions('shifts.manage')
  remove(@Param('id') id: string) { return this.holidays.remove(id); }
}
