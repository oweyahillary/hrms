import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatutoryRatesService } from './statutory-rates.service';
import { CreateStatutoryRateDto } from './dto/create-statutory-rate.dto';
import { UpdateStatutoryRateDto } from './dto/update-statutory-rate.dto';
import { EffectiveQueryDto, QueryStatutoryRateDto } from './dto/query-statutory-rate.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('statutory-rates')
@ApiBearerAuth()
@Controller('statutory-rates')
export class StatutoryRatesController {
  constructor(private readonly rates: StatutoryRatesService) {}

  @Post() @Permissions('statutory_rates.manage')
  create(@Body() dto: CreateStatutoryRateDto) { return this.rates.create(dto); }

  @Get()
  list(@Query() query: QueryStatutoryRateDto) { return this.rates.list(query.rateType); }

  // Before ':id' so '/statutory-rates/effective' isn't captured as an id.
  @Get('effective')
  effective(@Query() query: EffectiveQueryDto) { return this.rates.effective(query.asOf); }

  @Patch(':id') @Permissions('statutory_rates.manage')
  update(@Param('id') id: string, @Body() dto: UpdateStatutoryRateDto) { return this.rates.update(id, dto); }

  @Delete(':id') @Permissions('statutory_rates.manage')
  remove(@Param('id') id: string) { return this.rates.remove(id); }
}
