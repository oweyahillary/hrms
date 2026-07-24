import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { ALLOWED_LOGO_MIME, MAX_LOGO_BYTES, contentTypeFromName } from '../storage/storage-path';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import type { UpdateNumberingDto } from './dto/update-numbering.dto';
import type { UpdateLeaveApprovalDto } from './dto/update-leave-approval.dto';
import type { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import type { UpdateAttendanceSettingsDto } from './dto/update-attendance-settings.dto';
import { formatEmployeeNumber } from '../employees/employee-number';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

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

  /** Leave approval policy: who signs off, and whether employees may choose. */
  async getLeaveApproval(orgId: string) {
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId },
      select: {
        leaveApprovalMode: true, leaveHrApproverUserId: true, allowEmployeeChosenApprovers: true,
      },
    })) as unknown as {
      leaveApprovalMode: string;
      leaveHrApproverUserId: string | null;
      allowEmployeeChosenApprovers: boolean;
    } | null;
    if (!org) throw new NotFoundException('Organization not found');

    // The approver is a plain column, so resolve the name here rather than
    // handing the UI an id it can't turn into a person.
    let hrApproverName: string | null = null;
    if (org.leaveHrApproverUserId) {
      const u = (await this.prisma.user.findFirst({
        where: { id: org.leaveHrApproverUserId },
        include: { employee: { select: { firstName: true, lastName: true } } },
      } as never)) as unknown as {
        email: string; employee?: { firstName: string; lastName: string } | null;
      } | null;
      hrApproverName = u ? (u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email) : null;
    }

    return {
      leaveApprovalMode: org.leaveApprovalMode,
      leaveHrApproverUserId: org.leaveHrApproverUserId,
      hrApproverName,
      allowEmployeeChosenApprovers: org.allowEmployeeChosenApprovers,
      /** True when nothing can be approved — worth surfacing before someone applies. */
      needsHrApprover: org.leaveHrApproverUserId == null,
    };
  }

  async updateLeaveApproval(orgId: string, dto: UpdateLeaveApprovalDto) {
    // leaveHrApproverUserId is a plain column (see schema.prisma) — nothing at
    // the database level stops a dangling or unsuitable id, so check here.
    if (dto.leaveHrApproverUserId) {
      const u = (await this.prisma.user.findFirst({
        where: { id: dto.leaveHrApproverUserId },
        include: { role: { select: { name: true } } },
      } as never)) as unknown as { isActive: boolean; role?: { name: string } } | null;
      if (!u) throw new BadRequestException('leaveHrApproverUserId does not exist');
      if (!u.isActive) throw new BadRequestException('That user is deactivated and cannot approve leave');
      if (!HR_MANAGEMENT_ROLES.includes(u.role?.name ?? '')) {
        throw new BadRequestException('The leave approver must hold an HR or Admin role');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.leaveApprovalMode !== undefined) data.leaveApprovalMode = dto.leaveApprovalMode;
    if (dto.leaveHrApproverUserId !== undefined) data.leaveHrApproverUserId = dto.leaveHrApproverUserId;
    if (dto.allowEmployeeChosenApprovers !== undefined) {
      data.allowEmployeeChosenApprovers = dto.allowEmployeeChosenApprovers;
    }
    await this.prisma.organization.update({ where: { id: orgId }, data });
    return this.getLeaveApproval(orgId);
  }

  /** Employee-number auto-numbering config. Admin/HR only (set via settings). */
  async getNumbering(orgId: string) {
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId },
      select: {
        employeeNumberPrefix: true, employeeNumberPadding: true, employeeNumberNextSeq: true,
      },
    })) as unknown as {
      employeeNumberPrefix: string | null;
      employeeNumberPadding: number;
      employeeNumberNextSeq: number;
    } | null;
    if (!org) throw new NotFoundException('Organization not found');
    return {
      employeeNumberPrefix: org.employeeNumberPrefix,
      employeeNumberPadding: org.employeeNumberPadding,
      employeeNumberNextSeq: org.employeeNumberNextSeq,
      autoNumbering: org.employeeNumberPrefix != null,
      preview: org.employeeNumberPrefix
        ? formatEmployeeNumber(org.employeeNumberPrefix, org.employeeNumberPadding, org.employeeNumberNextSeq)
        : null,
    };
  }

  async updateNumbering(orgId: string, dto: UpdateNumberingDto) {
    const data: Record<string, unknown> = {};
    // `null` clears the prefix (turns auto-numbering off); `undefined` leaves it.
    if (dto.employeeNumberPrefix !== undefined) data.employeeNumberPrefix = dto.employeeNumberPrefix;
    if (dto.employeeNumberPadding !== undefined) data.employeeNumberPadding = dto.employeeNumberPadding;
    if (dto.employeeNumberNextSeq !== undefined) data.employeeNumberNextSeq = dto.employeeNumberNextSeq;
    await this.prisma.organization.update({ where: { id: orgId }, data });
    return this.getNumbering(orgId);
  }

  async getPayrollSettings(orgId: string) {
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId },
      select: { severanceDayRateBasis: true },
    })) as unknown as { severanceDayRateBasis: string } | null;
    if (!org) throw new NotFoundException('Organization not found');
    return { severanceDayRateBasis: org.severanceDayRateBasis };
  }

  async updatePayrollSettings(orgId: string, dto: UpdatePayrollSettingsDto) {
    const data: Record<string, unknown> = {};
    if (dto.severanceDayRateBasis !== undefined) data.severanceDayRateBasis = dto.severanceDayRateBasis;
    await this.prisma.organization.update({ where: { id: orgId }, data });
    return this.getPayrollSettings(orgId);
  }

  async getAttendanceSettings(orgId: string) {
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId },
      select: { lateGraceMinutes: true },
    })) as unknown as { lateGraceMinutes: number } | null;
    if (!org) throw new NotFoundException('Organization not found');
    return { lateGraceMinutes: org.lateGraceMinutes };
  }

  async updateAttendanceSettings(orgId: string, dto: UpdateAttendanceSettingsDto) {
    const data: Record<string, unknown> = {};
    if (dto.lateGraceMinutes !== undefined) data.lateGraceMinutes = dto.lateGraceMinutes;
    await this.prisma.organization.update({ where: { id: orgId }, data });
    return this.getAttendanceSettings(orgId);
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
