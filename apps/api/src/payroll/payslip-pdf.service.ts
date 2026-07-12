import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { FileStorageService } from '../storage/file-storage.service';
import { renderPayslipPdf, type PayslipDocumentData } from './payslip-document';

interface RunWithOrg {
  id: string;
  organizationId: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  runType: string;
  organization: {
    name: string;
    kraPin: string | null;
    physicalAddress: string | null;
    registrationNumber: string | null;
    payslipNotice: string | null;
    logoPath: string | null;
    logoAlignment: string;
  };
  payslips: Array<{
    id: string; employeeId: string; grossPay: unknown; paye: unknown;
    nssfEmployee: unknown; nssfEmployer: unknown; shif: unknown; ahlEmployee: unknown;
    ahlEmployer: unknown; otherDeductions: unknown; netPay: unknown;
    oneThirdRulePass: boolean; pdfStatus: string; pdfPath: string | null;
  }>;
}
interface EmployeeRow { firstName: string; lastName: string; employeeNumber: string; kraPin: string | null }

/**
 * Generates payslip PDFs as a step DECOUPLED from finalize: the payroll data is
 * already frozen and authoritative; this renders the downstream artifact. It is
 * idempotent — only payslips not yet READY are (re)rendered — so it is safe to
 * call eagerly after finalize, from the retry endpoint, or from a scheduler/cron.
 */
@Injectable()
export class PayslipPdfService {
  private readonly logger = new Logger(PayslipPdfService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly storage: FileStorageService,
  ) {}

  /** Render + attach PDFs for any finalized payslip not yet READY. Idempotent. */
  async generateMissingForRun(runId: string): Promise<{ total: number; ready: number; failed: number }> {
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id: runId } as never,
      include: {
        organization: {
          select: {
            name: true, kraPin: true, physicalAddress: true,
            registrationNumber: true, payslipNotice: true, logoPath: true, logoAlignment: true,
          },
        },
        payslips: true,
      },
    } as never)) as unknown as RunWithOrg | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'FINALIZED') {
      throw new ConflictException('Payslip PDFs are generated only for finalized runs.');
    }

    const payslips = run.payslips ?? [];
    let ready = payslips.filter((p) => p.pdfStatus === 'READY').length;
    let failed = 0;

    // Resolve the org logo once (fail-soft); shared by every payslip in the run.
    let logo: { buffer: Buffer; alignment: 'LEFT' | 'CENTER' | 'RIGHT' } | null = null;
    if (run.organization.logoPath) {
      try {
        const buffer = await this.storage.read(run.organization.logoPath);
        const a = run.organization.logoAlignment;
        logo = { buffer, alignment: a === 'CENTER' || a === 'RIGHT' ? a : 'LEFT' };
      } catch {
        logo = null; // missing/unreadable logo → text-only header
      }
    }

    for (const p of payslips) {
      if (p.pdfStatus === 'READY') continue;
      try {
        const emp = (await this.prisma.employee.findFirst({
          where: { id: p.employeeId } as never,
          select: { firstName: true, lastName: true, employeeNumber: true, kraPin: true },
        } as never)) as unknown as EmployeeRow | null;
        if (!emp) throw new Error(`employee ${p.employeeId} not found`);

        const empKraPin = emp.kraPin ? await this.crypto.decrypt(emp.kraPin) : null;
        const data: PayslipDocumentData = {
          employer: {
            name: run.organization.name,
            kraPin: run.organization.kraPin,
            address: run.organization.physicalAddress,
            registrationNumber: run.organization.registrationNumber,
            notice: run.organization.payslipNotice,
            logo,
          },
          employee: {
            fullName: `${emp.firstName} ${emp.lastName}`.trim(),
            employeeNumber: emp.employeeNumber,
            kraPin: empKraPin,
          },
          period: { month: run.periodMonth, year: run.periodYear, runType: run.runType },
          earnings: { grossPay: Number(p.grossPay) },
          deductions: {
            paye: Number(p.paye), nssfEmployee: Number(p.nssfEmployee), shif: Number(p.shif),
            ahlEmployee: Number(p.ahlEmployee), otherDeductions: Number(p.otherDeductions),
          },
          employerContributions: {
            nssfEmployer: Number(p.nssfEmployer), ahlEmployer: Number(p.ahlEmployer),
          },
          netPay: Number(p.netPay),
          oneThirdRulePass: p.oneThirdRulePass,
          generatedAt: new Date(),
          reference: p.id.slice(0, 8),
        };

        const buffer = await renderPayslipPdf(data);
        const relDir = `${run.organizationId}/payslips/${run.id}`;
        const pdfPath = await this.storage.save(relDir, `${p.id}.pdf`, buffer);

        // pdfPath NULL->value + status READY: permitted by the finalized-payslip trigger.
        await this.prisma.payslip.update({
          where: { id: p.id },
          data: { pdfPath, pdfStatus: 'READY' } as never,
        });
        ready += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(`payslip ${p.id} PDF generation failed: ${(err as Error).message}`);
        await this.prisma.payslip
          .update({ where: { id: p.id }, data: { pdfStatus: 'FAILED' } as never })
          .catch(() => undefined);
      }
    }

    return { total: payslips.length, ready, failed };
  }

  /** Read a finalized payslip's stored PDF for download (org-scoped via the run). */
  async getPayslipPdf(runId: string, payslipId: string): Promise<{ buffer: Buffer; filename: string }> {
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id: runId } as never,
      include: { payslips: { where: { id: payslipId } } },
    } as never)) as unknown as {
      periodMonth: number; periodYear: number;
      payslips: Array<{ id: string; pdfPath: string | null; pdfStatus: string }>;
    } | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    const p = (run.payslips ?? [])[0];
    if (!p) throw new NotFoundException('Payslip not found in this run');
    if (p.pdfStatus !== 'READY' || !p.pdfPath) {
      throw new ConflictException('Payslip PDF is not ready yet — it is still being prepared.');
    }
    const buffer = await this.storage.read(p.pdfPath);
    const filename = `payslip-${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}-${p.id.slice(0, 8)}.pdf`;
    return { buffer, filename };
  }
}
