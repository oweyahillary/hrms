import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { FileStorageService } from '../storage/file-storage.service';
import { buildSalaryCsv, buildSalaryXlsx, buildEftCsv, buildEftXlsx, type BankPaymentRow, type EmployerPaymentInfo } from './bank-export-file';

const PESALINK_MAX = 999999; // per-transaction cap; larger amounts need RTGS

type Format = 'CSV' | 'XLSX';
type Template = 'GENERIC' | 'EFT';
const EXT: Record<Format, string> = { CSV: 'csv', XLSX: 'xlsx' };
const CONTENT_TYPE: Record<Format, string> = {
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface RunRow {
  id: string;
  organizationId: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  organization: { bankAccountNumber: string | null; bankPurposeCode: string | null };
  payslips: Array<{ employeeId: string; netPay: unknown }>;
}
interface EmpRow {
  firstName: string; lastName: string; employeeNumber: string; email: string | null;
  bankName: string | null; bankCode: string | null; bankBranchCode: string | null;
  bankAccountNumber: string | null;
}

@Injectable()
export class BankExportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly storage: FileStorageService,
  ) {}

  private async loadFinalizedRun(runId: string): Promise<RunRow> {
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id: runId } as never,
      select: {
        id: true, organizationId: true, periodMonth: true, periodYear: true, status: true,
        organization: { select: { bankAccountNumber: true, bankPurposeCode: true } },
        payslips: { select: { employeeId: true, netPay: true } },
      },
    } as never)) as unknown as RunRow | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'FINALIZED') {
      throw new ConflictException('Bank export is available only for finalized runs.');
    }
    return run;
  }

  /** Generate one file per requested format; each becomes its own batch row. */
  async generate(runId: string, template: Template, formats: Format[], userId: string) {
    if (formats.length === 0) throw new BadRequestException('At least one format is required.');
    const run = await this.loadFinalizedRun(runId);
    const narration = `Salary ${String(run.periodMonth).padStart(2, '0')}/${run.periodYear}`;

    const rows: BankPaymentRow[] = [];
    const skipped: Array<{ employeeNumber: string; reason: string }> = [];
    const warnings: string[] = [];

    // The EFT template needs employer-level fields; fail early with a clear
    // message rather than emitting a file the bank will reject.
    let employer: EmployerPaymentInfo | null = null;
    if (template === 'EFT') {
      const debitAccount = run.organization.bankAccountNumber;
      if (!debitAccount) {
        throw new ConflictException('Configure the employer debit account in organization settings before generating an EFT file.');
      }
      const purposeCode = run.organization.bankPurposeCode ?? '';
      if (!purposeCode) warnings.push('No purpose-of-payment code configured; the bank may require one.');
      employer = { debitAccount, purposeCode };
    }

    for (const p of run.payslips) {
      const emp = (await this.prisma.employee.findFirst({
        where: { id: p.employeeId } as never,
        select: {
          firstName: true, lastName: true, employeeNumber: true, email: true,
          bankName: true, bankCode: true, bankBranchCode: true, bankAccountNumber: true,
        },
      } as never)) as unknown as EmpRow | null;
      if (!emp) continue;

      if (!emp.bankAccountNumber) {
        skipped.push({ employeeNumber: emp.employeeNumber, reason: 'no bank account on file' });
        continue;
      }
      const accountNumber = this.crypto.isEncrypted(emp.bankAccountNumber)
        ? await this.crypto.decrypt(emp.bankAccountNumber)
        : emp.bankAccountNumber;
      const amount = Number(p.netPay);
      if (template === 'GENERIC' && amount > PESALINK_MAX) {
        warnings.push(`${emp.employeeNumber}: amount exceeds PesaLink per-transaction cap (KES ${PESALINK_MAX}); use RTGS.`);
      }
      rows.push({
        employeeNumber: emp.employeeNumber,
        accountName: `${emp.firstName} ${emp.lastName}`.trim(),
        accountNumber,
        bankName: emp.bankName,
        bankCode: emp.bankCode,
        bankBranchCode: emp.bankBranchCode,
        amount,
        narration,
        email: emp.email,
      });
    }

    if (rows.length === 0) {
      throw new ConflictException('No payable employees with bank accounts in this run.');
    }

    const relDir = `${run.organizationId}/bank-exports/${run.id}`;
    const stamp = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
    const batches: Array<{ id: string; format: Format; template: Template; rowCount: number }> = [];

    for (const format of formats) {
      const buffer = await this.render(template, format, rows, employer);
      const filename = `salary-${stamp}-${randomUUID().slice(0, 8)}.${EXT[format]}`;
      const filePath = await this.storage.save(relDir, filename, buffer);
      const batch = (await this.prisma.bankExportBatch.create({
        data: {
          payrollRunId: run.id, filePath, format, template, rowCount: rows.length, generatedById: userId,
        } as never,
        select: { id: true, format: true, template: true, rowCount: true },
      } as never)) as unknown as { id: string; format: Format; template: Template; rowCount: number };
      batches.push(batch);
    }

    const totalAmount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return { batches, template, included: rows.length, totalAmount, skipped, warnings };
  }

  private async render(
    template: Template, format: Format, rows: BankPaymentRow[], employer: EmployerPaymentInfo | null,
  ): Promise<Buffer> {
    if (template === 'EFT') {
      const emp = employer as EmployerPaymentInfo; // guaranteed set for EFT in generate()
      return format === 'CSV'
        ? Buffer.from(buildEftCsv(rows, emp), 'utf8')
        : buildEftXlsx(rows, emp);
    }
    return format === 'CSV'
      ? Buffer.from(buildSalaryCsv(rows), 'utf8')
      : buildSalaryXlsx(rows);
  }

  async list(runId: string) {
    await this.loadFinalizedRun(runId);
    const batches = (await this.prisma.bankExportBatch.findMany({
      where: { payrollRunId: runId } as never,
      orderBy: { generatedAt: 'desc' } as never,
      select: { id: true, format: true, template: true, rowCount: true, generatedAt: true },
    } as never)) as unknown as Array<{ id: string; format: Format; template: Template; rowCount: number; generatedAt: Date }>;
    return batches;
  }

  async download(runId: string, batchId: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    // Scope through the run so a batch from another org can't be fetched.
    const run = (await this.prisma.payrollRun.findFirst({
      where: { id: runId } as never,
      select: { periodMonth: true, periodYear: true, bankExportBatches: { where: { id: batchId } } },
    } as never)) as unknown as {
      periodMonth: number; periodYear: number;
      bankExportBatches: Array<{ id: string; filePath: string; format: Format }>;
    } | null;
    if (!run) throw new NotFoundException('Payroll run not found');
    const batch = (run.bankExportBatches ?? [])[0];
    if (!batch) throw new NotFoundException('Bank export batch not found in this run');
    const buffer = await this.storage.read(batch.filePath);
    const stamp = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
    const filename = `salary-${stamp}.${EXT[batch.format]}`;
    return { buffer, filename, contentType: CONTENT_TYPE[batch.format] };
  }
}
