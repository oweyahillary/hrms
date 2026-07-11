import {
  ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { CryptoService } from '../crypto/crypto.service';
import { isPiiPrivileged, presentPii } from './employee-pii';
import { EMPLOYEE_ANON_MARKER } from './anonymization';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { TerminateEmployeeDto } from './dto/terminate-employee.dto';
import type { ListEmployeesDto } from './dto/list-employees.dto';

// Shape of the raw employee row we read back from Prisma (subset we use).
interface EmployeeRow {
  id: string; employeeNumber: string; firstName: string; lastName: string;
  nationalId: string; kraPin: string | null; bankAccountNumber: string | null;
  bankName: string | null; phone: string | null; email: string | null;
  dateOfBirth: Date | null; gender: string | null;
  departmentId: string | null; jobTitleId: string | null;
  employmentType: string; employmentStatus: string;
  hireDate: Date; exitDate: Date | null; nextOfKin: unknown;
  createdAt: Date; updatedAt: Date;
}

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
  ) {}

  async create(dto: CreateEmployeeDto, actorRole: string) {
    const data: Record<string, unknown> = {
      employeeNumber: dto.employeeNumber,
      firstName: dto.firstName,
      lastName: dto.lastName,
      nationalId: await this.crypto.encrypt(dto.nationalId),
      nationalIdHmac: this.crypto.blindIndex(dto.nationalId),
      kraPin: dto.kraPin ? await this.crypto.encrypt(dto.kraPin) : null,
      kraPinHmac: dto.kraPin ? this.crypto.blindIndex(dto.kraPin) : null,
      bankAccountNumber: dto.bankAccountNumber ? await this.crypto.encrypt(dto.bankAccountNumber) : null,
      bankName: dto.bankName ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      gender: dto.gender ?? null,
      departmentId: dto.departmentId ?? null,
      jobTitleId: dto.jobTitleId ?? null,
      employmentType: dto.employmentType,
      hireDate: new Date(dto.hireDate),
      nextOfKin: dto.nextOfKin ?? undefined,
    };

    try {
      // organizationId is injected by the tenant extension.
      // organizationId is injected by the tenant extension; cast bridges the
      // static type (which still lists it) to the runtime shape.
      const row = (await this.prisma.employee.create({
        data: data as unknown as Prisma.EmployeeUncheckedCreateInput,
      })) as unknown as EmployeeRow;
      return this.toResponse(row, actorRole);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('employeeNumber already exists');
      }
      throw err;
    }
  }

  async list(query: ListEmployeesDto, actorRole: string) {
    const where: Record<string, unknown> = {};
    if (query.status) where.employmentStatus = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where, skip, take: query.pageSize, orderBy: { createdAt: 'desc' },
      }) as unknown as Promise<EmployeeRow[]>,
      this.prisma.employee.count({ where }) as unknown as Promise<number>,
    ]);

    const data = await Promise.all(rows.map((r) => this.toResponse(r, actorRole)));
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string, actorRole: string) {
    // findFirst (not findUnique) so the tenant extension scopes by org.
    const row = (await this.prisma.employee.findFirst({ where: { id } })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');
    return this.toResponse(row, actorRole);
  }

  /** Find an employee by raw national ID using the blind index (no plaintext scan). */
  async lookupByNationalId(nationalId: string, actorRole: string) {
    const hmac = this.crypto.blindIndex(nationalId);
    const row = (await this.prisma.employee.findFirst({
      where: { nationalIdHmac: hmac },
    })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');
    return this.toResponse(row, actorRole);
  }

  async update(id: string, dto: UpdateEmployeeDto, actorRole: string) {
    // Scoped read first (update-by-id isn't org-injected — see docs/spine.md).
    await this.ensureExists(id);

    const data: Record<string, unknown> = {};
    const assign = (k: keyof UpdateEmployeeDto, v: unknown) => { if (v !== undefined) data[k] = v; };

    assign('employeeNumber', dto.employeeNumber);
    assign('firstName', dto.firstName);
    assign('lastName', dto.lastName);
    assign('phone', dto.phone);
    assign('email', dto.email);
    assign('gender', dto.gender);
    assign('departmentId', dto.departmentId);
    assign('jobTitleId', dto.jobTitleId);
    assign('employmentType', dto.employmentType);
    assign('bankName', dto.bankName);
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.hireDate !== undefined) data.hireDate = new Date(dto.hireDate);
    if (dto.nextOfKin !== undefined) data.nextOfKin = dto.nextOfKin;

    // Re-encrypt PII + refresh blind indexes when supplied.
    if (dto.nationalId !== undefined) {
      data.nationalId = await this.crypto.encrypt(dto.nationalId);
      data.nationalIdHmac = this.crypto.blindIndex(dto.nationalId);
    }
    if (dto.kraPin !== undefined) {
      data.kraPin = dto.kraPin ? await this.crypto.encrypt(dto.kraPin) : null;
      data.kraPinHmac = dto.kraPin ? this.crypto.blindIndex(dto.kraPin) : null;
    }
    if (dto.bankAccountNumber !== undefined) {
      data.bankAccountNumber = dto.bankAccountNumber ? await this.crypto.encrypt(dto.bankAccountNumber) : null;
    }

    try {
      const row = (await this.prisma.employee.update({
        where: { id },
        data: data as unknown as Prisma.EmployeeUncheckedUpdateInput,
      })) as unknown as EmployeeRow;
      return this.toResponse(row, actorRole);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('employeeNumber already exists');
      }
      throw err;
    }
  }

  async terminate(id: string, dto: TerminateEmployeeDto, actorRole: string) {
    await this.ensureExists(id);
    const row = (await this.prisma.employee.update({
      where: { id },
      data: {
        employmentStatus: 'EXITED',
        exitDate: dto.exitDate ? new Date(dto.exitDate) : new Date(),
      },
    })) as unknown as EmployeeRow;
    return this.toResponse(row, actorRole);
  }

  /**
   * Irreversibly anonymize an employee's identifying PII in place (DPA erasure).
   * Payslips, audit logs and other statutory records are preserved (referential
   * integrity + legal retention). Idempotent: a second call is a no-op.
   */
  async anonymize(id: string) {
    const row = (await this.prisma.employee.findFirst({ where: { id } })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');

    const payslips = await this.prisma.payslip.count({ where: { employeeId: id } as never });
    if (row.firstName === EMPLOYEE_ANON_MARKER) {
      return { employeeId: id, anonymized: true, alreadyAnonymized: true, retained: { payslips } };
    }

    const tombstone = await this.crypto.encrypt('ERASED');
    await this.prisma.employee.update({
      where: { id },
      data: {
        firstName: EMPLOYEE_ANON_MARKER,
        lastName: EMPLOYEE_ANON_MARKER,
        nationalId: tombstone,
        nationalIdHmac: this.crypto.blindIndex(randomUUID()),
        kraPin: null, kraPinHmac: null,
        bankName: null, bankAccountNumber: null,
        phone: null, email: null,
        dateOfBirth: null, gender: null, nextOfKin: null,
      } as never,
    });
    return { employeeId: id, anonymized: true, alreadyAnonymized: false, retained: { payslips } };
  }

  private async ensureExists(id: string): Promise<void> {
    const row = await this.prisma.employee.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Employee not found');
  }

  /** Decrypt PII server-side, then expose full or masked values per role. */
  private async toResponse(row: EmployeeRow, actorRole: string) {
    const privileged = isPiiPrivileged(actorRole);
    const nationalId = await this.crypto.decrypt(row.nationalId);
    const kraPin = row.kraPin ? await this.crypto.decrypt(row.kraPin) : null;
    const bankAccountNumber = row.bankAccountNumber ? await this.crypto.decrypt(row.bankAccountNumber) : null;

    return {
      id: row.id,
      employeeNumber: row.employeeNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      nationalId: presentPii(nationalId, privileged),
      kraPin: presentPii(kraPin, privileged),
      bankAccountNumber: presentPii(bankAccountNumber, privileged),
      bankName: row.bankName,
      phone: row.phone,
      email: row.email,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      departmentId: row.departmentId,
      jobTitleId: row.jobTitleId,
      employmentType: row.employmentType,
      employmentStatus: row.employmentStatus,
      hireDate: row.hireDate,
      exitDate: row.exitDate,
      nextOfKin: row.nextOfKin,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      piiMasked: !privileged,
    };
  }
}
