import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { ALLOWED_LOGO_MIME, MAX_LOGO_BYTES, contentTypeFromName } from '../storage/storage-path';
import type { UpdateBrandingDto } from './dto/update-branding.dto';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface OrgRow {
  id: string;
  name: string;
  kraPin: string | null;
  physicalAddress: string | null;
  registrationNumber: string | null;
  payslipNotice: string | null;
  logoPath: string | null;
  logoAlignment: string;
  brandColor: string | null;
  bankAccountNumber: string | null;
  bankPurposeCode: string | null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly storage: FileStorageService,
  ) {}

  private async load(orgId: string): Promise<OrgRow> {
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId } as never,
      select: {
        id: true, name: true, kraPin: true, physicalAddress: true,
        registrationNumber: true, payslipNotice: true, logoPath: true, logoAlignment: true,
        brandColor: true, bankAccountNumber: true, bankPurposeCode: true,
      },
    } as never)) as unknown as OrgRow | null;
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Public view of branding (never leaks the raw storage path). */
  private present(org: OrgRow) {
    return {
      name: org.name,
      kraPin: org.kraPin,
      physicalAddress: org.physicalAddress,
      registrationNumber: org.registrationNumber,
      payslipNotice: org.payslipNotice,
      logoAlignment: org.logoAlignment,
      brandColor: org.brandColor,
      bankAccountNumber: org.bankAccountNumber,
      bankPurposeCode: org.bankPurposeCode,
      hasLogo: org.logoPath != null,
    };
  }

  async getBranding(orgId: string) {
    return this.present(await this.load(orgId));
  }

  async updateBranding(orgId: string, dto: UpdateBrandingDto) {
    await this.load(orgId); // 404 if missing
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'kraPin', 'physicalAddress', 'registrationNumber', 'payslipNotice', 'logoAlignment', 'brandColor', 'bankAccountNumber', 'bankPurposeCode'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const updated = (await this.prisma.organization.update({
      where: { id: orgId },
      data: data as never,
      select: {
        id: true, name: true, kraPin: true, physicalAddress: true,
        registrationNumber: true, payslipNotice: true, logoPath: true, logoAlignment: true,
        brandColor: true, bankAccountNumber: true, bankPurposeCode: true,
      },
    } as never)) as unknown as OrgRow;
    return this.present(updated);
  }

  async uploadLogo(orgId: string, file: UploadedFileLike | undefined) {
    if (!file) throw new BadRequestException('file is required');
    if (!ALLOWED_LOGO_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported logo type (allowed: PNG, JPEG)');
    }
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException('Logo exceeds 2 MB limit');

    const org = await this.load(orgId);
    const filename = `logo.${EXT[file.mimetype]}`;
    const newPath = await this.storage.save(`${orgId}/branding`, filename, file.buffer);

    // Remove a previous logo of a different extension so no orphan lingers.
    if (org.logoPath && org.logoPath !== newPath) {
      await this.storage.remove(org.logoPath).catch(() => undefined);
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { logoPath: newPath } as never,
    });
    return { hasLogo: true };
  }

  async deleteLogo(orgId: string) {
    const org = await this.load(orgId);
    if (org.logoPath) {
      await this.storage.remove(org.logoPath).catch(() => undefined);
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { logoPath: null } as never,
      });
    }
    return { hasLogo: false };
  }

  /**
   * Resolve "the" organization for unauthenticated branding. The deployment
   * model is single-tenant per client (one DB + one API per client), so exactly
   * one row is expected. If there are zero or several, we return nothing rather
   * than guess which brand to show — callers fall back to neutral defaults.
   */
  private async soleOrg(): Promise<OrgRow | null> {
    const rows = (await this.prisma.organization.findMany({
      take: 2, // enough to detect "more than one" without loading the table
      select: {
        id: true, name: true, kraPin: true, physicalAddress: true,
        registrationNumber: true, payslipNotice: true, logoPath: true, logoAlignment: true,
        brandColor: true, bankAccountNumber: true, bankPurposeCode: true,
      },
    } as never)) as unknown as OrgRow[];
    return rows.length === 1 ? rows[0] : null;
  }

  /**
   * Branding for pre-login screens: name, accent colour and whether a logo
   * exists — nothing sensitive, and deliberately readable without a session so
   * the sign-in page can carry the client's identity.
   */
  async publicBranding(): Promise<{ name: string | null; brandColor: string | null; hasLogo: boolean }> {
    const org = await this.soleOrg();
    if (!org) return { name: null, brandColor: null, hasLogo: false };
    return { name: org.name, brandColor: org.brandColor, hasLogo: org.logoPath != null };
  }

  /** The logo for pre-login screens (see publicBranding for the rationale). */
  async publicLogo(): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const org = await this.soleOrg();
    if (!org?.logoPath) throw new NotFoundException('No logo available');
    return this.getLogo(org.id);
  }

  /** Read the stored logo for preview/download. */
  async getLogo(orgId: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const org = await this.load(orgId);
    if (!org.logoPath) throw new NotFoundException('No logo set for this organization');
    const buffer = await this.storage.read(org.logoPath);
    const filename = org.logoPath.split('/').pop() ?? 'logo';
    return { buffer, contentType: contentTypeFromName(filename), filename };
  }
}
