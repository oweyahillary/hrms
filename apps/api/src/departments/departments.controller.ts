import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Post() @Roles(...MANAGE)
  create(@Body() dto: CreateDepartmentDto) {
    return this.departments.create(dto);
  }

  @Get()
  list() {
    return this.departments.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.departments.get(id);
  }

  @Patch(':id') @Roles(...MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(id, dto);
  }

  @Delete(':id') @Roles(...MANAGE)
  remove(@Param('id') id: string) {
    return this.departments.remove(id);
  }
}
