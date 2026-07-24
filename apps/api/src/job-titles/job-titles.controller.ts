import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JobTitlesService } from './job-titles.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';
import { UpdateJobTitleDto } from './dto/update-job-title.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('job-titles')
@ApiBearerAuth()
@Controller('job-titles')
export class JobTitlesController {
  constructor(private readonly jobTitles: JobTitlesService) {}

  @Post() @Permissions('org_structure.manage')
  create(@Body() dto: CreateJobTitleDto) { return this.jobTitles.create(dto); }

  @Get()
  list() { return this.jobTitles.list(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.jobTitles.get(id); }

  @Patch(':id') @Permissions('org_structure.manage')
  update(@Param('id') id: string, @Body() dto: UpdateJobTitleDto) { return this.jobTitles.update(id, dto); }

  @Delete(':id') @Permissions('org_structure.manage')
  remove(@Param('id') id: string) { return this.jobTitles.remove(id); }
}
