import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { FileStorageService } from '../storage/file-storage.service';
import { buildSalaryCsv, buildSalaryXlsx, type BankPaymentRow } from './bank-export-file';

const PESALINK_MAX = 999999; // per-transaction cap; larger amounts need RTGS

type Format = 'CSV' | 'XLSX';
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
  payslips: Array<{ employeeId: string; netPay: unknown }>;
}
interface EmpRow {
  firstName: string; lastName: string; employeeNumber: string;
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
  async generate(runId: string, formats: Format[], userId: string) {
    if (formats.length === 0) throw new BadRequestException('At least one format is required.');
    const run = await this.loadFinalizedRun(runId);
    const narration = `Salary ${String(run.periodMonth).padStart(2, '0')}/${run.periodYear}`;

    const rows: BankPaymentRow[] = [];
    const skipped: Array<{ employeeNumber: string; reason: string }> = [];
    const warnings: string[] = [];

    for (const p of run.payslips) {
      const emp = (await this.prisma.employee.findFirst({
        where: { id: p.employeeId } as never,
        select: {
          firstName: true, lastName: true, employeeNumber: true,
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
      if (amount > PESALINK_MAX) {
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
      });
    }

    if (rows.length === 0) {
      throw new ConflictException('No payable employees with bank accounts in this run.');
    }

    const relDir = `${run.organizationId}/bank-exports/${run.id}`;
    const stamp = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
    const batches: Array<{ id: string; format: Format; rowCount: number }> = [];

    for (const format of formats) {
      const buffer = format === 'CSV'
        ? Buffer.from(buildSalaryCsv(rows), 'utf8')
        : await buildSalaryXlsx(rows);
      const filename = `salary-${stamp}-${randomUUID().slice(0, 8)}.${EXT[format]}`;
      const filePath = await this.storage.save(relDir, filename, buffer);
      const batch = (await this.prisma.bankExportBatch.create({
        data: {
          payrollRunId: run.id, filePath, format, rowCount: rows.length, generatedById: userId,
        } as never,
        select: { id: true, format: true, rowCount: true },
      } as never)) as unknown as { id: string; format: Format; rowCount: number };
      batches.push(batch);
    }

    const totalAmount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return { batches, included: rows.length, totalAmount, skipped, warnings };
  }

  async list(runId: string) {
    await this.loadFinalizedRun(runId);
    const batches = (await this.prisma.bankExportBatch.findMany({
      where: { payrollRunId: runId } as never,
      orderBy: { generatedAt: 'desc' } as never,
      select: { id: true, format: true, rowCount: true, generatedAt: true },
    } as never)) as unknown as Array<{ id: string; format: Format; rowCount: number; generatedAt: Date }>;
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
