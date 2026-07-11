import {
  BadRequestException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { ALLOWED_UPLOAD_MIME, contentTypeFromName, MAX_UPLOAD_BYTES } from '../storage/storage-path';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { CreateDocumentDto } from './dto/create-document.dto';

/** Minimal shape of a multipart file (avoids a hard dep on multer types). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface DocRow {
  id: string; employeeId: string; documentType: string; filePath: string;
  uploadedById: string; uploadedAt: Date; isSensitive: boolean;
}

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly storage: FileStorageService,
  ) {}

  async upload(employeeId: string, file: UploadedFileLike | undefined, dto: CreateDocumentDto, actor: AuthUser) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported file type (allowed: PDF, JPEG, PNG)');
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File exceeds 10 MB limit');

    await this.ensureEmployee(employeeId);

    const relDir = `${actor.organizationId}/${employeeId}/${randomUUID()}`;
    const filePath = await this.storage.save(relDir, file.originalname, file.buffer);

    // organizationId injected by the tenant extension; the write is auto-audited.
    const doc = (await this.prisma.employeeDocument.create({
      data: {
        employeeId,
        documentType: dto.documentType,
        filePath,
        uploadedById: actor.userId,
        isSensitive: dto.isSensitive ?? false,
      } as never,
    })) as unknown as DocRow;

    return this.toMeta(doc);
  }

  async list(employeeId: string) {
    await this.ensureEmployee(employeeId);
    const docs = (await this.prisma.employeeDocument.findMany({
      where: { employeeId }, orderBy: { uploadedAt: 'desc' },
    })) as unknown as DocRow[];
    return docs.map((d) => this.toMeta(d));
  }

  async download(employeeId: string, docId: string, actor: AuthUser) {
    const doc = (await this.prisma.employeeDocument.findFirst({
      where: { id: docId, employeeId },
    })) as unknown as DocRow | null;
    if (!doc) throw new NotFoundException('Document not found');

    const buffer = await this.storage.read(doc.filePath);

    // Reads aren't auto-audited — log sensitive-document access explicitly.
    await this.prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        action: 'download',
        entityType: 'EmployeeDocument',
        entityId: doc.id,
      } as never,
    });

    const filename = doc.filePath.split('/').pop() ?? 'document';
    return { buffer, filename, contentType: contentTypeFromName(filename) };
  }

  async remove(employeeId: string, docId: string) {
    const doc = (await this.prisma.employeeDocument.findFirst({
      where: { id: docId, employeeId },
    })) as unknown as DocRow | null;
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.employeeDocument.delete({ where: { id: doc.id } }); // auto-audited
    await this.storage.remove(doc.filePath);
    return { success: true };
  }

  private async ensureEmployee(employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId } });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  private toMeta(doc: DocRow) {
    return {
      id: doc.id,
      employeeId: doc.employeeId,
      documentType: doc.documentType,
      filename: doc.filePath.split('/').pop(),
      isSensitive: doc.isSensitive,
      uploadedById: doc.uploadedById,
      uploadedAt: doc.uploadedAt,
    };
  }
}
