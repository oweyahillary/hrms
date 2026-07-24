import {
  Controller, Delete, Get, Param, Post, Res, StreamableFile,
  UploadedFile, UseInterceptors, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { EmployeeDocumentsService, type UploadedFileLike } from './employee-documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { MAX_UPLOAD_BYTES } from '../storage/storage-path';

@ApiTags('employee-documents')
@ApiBearerAuth()
@Controller('employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Post()
  @Permissions('employees.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @Param('employeeId') employeeId: string,
    @UploadedFile() file: UploadedFileLike,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.upload(employeeId, file, dto, user);
  }

  @Get()
  @Permissions('employees.write')
  list(@Param('employeeId') employeeId: string) {
    return this.documents.list(employeeId);
  }

  @Get(':docId/download')
  @Permissions('employees.write')
  async download(
    @Param('employeeId') employeeId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.documents.download(employeeId, docId, user);
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `attachment; filename="${f.filename}"`,
    });
    return new StreamableFile(f.buffer);
  }

  @Delete(':docId')
  @Permissions('employees.write')
  remove(@Param('employeeId') employeeId: string, @Param('docId') docId: string) {
    return this.documents.remove(employeeId, docId);
  }
}
