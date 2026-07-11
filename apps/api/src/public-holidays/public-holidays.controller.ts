import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PublicHolidaysService } from './public-holidays.service';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { QueryPublicHolidayDto } from './dto/query-public-holiday.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('public-holidays')
@ApiBearerAuth()
@Controller('public-holidays')
export class PublicHolidaysController {
  constructor(private readonly holidays: PublicHolidaysService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreatePublicHolidayDto) { return this.holidays.create(dto); }

  @Get()
  list(@Query() query: QueryPublicHolidayDto) { return this.holidays.list(query.year); }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdatePublicHolidayDto) { return this.holidays.update(id, dto); }

  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) { return this.holidays.remove(id); }
}
