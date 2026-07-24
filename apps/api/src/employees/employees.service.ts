import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../auth/password.service';
import { isPiiPrivileged, presentPii } from './employee-pii';
import { EMPLOYEE_ANON_MARKER } from './anonymization';
import { formatEmployeeNumber } from './employee-number';
import { getRequestContext } from '../common/context/request-context';
import { ROLE_PERMISSION_DEFAULTS } from '../auth/permissions';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { TerminateEmployeeDto } from './dto/terminate-employee.dto';
import type { EmployeeSortField, ListEmployeesDto } from './dto/list-employees.dto';
import type { CreateLoginDto } from './dto/create-login.dto';

/**
 * Columns the list view needs. Deliberately EXCLUDES the encrypted columns
 * (nationalId / kraPin / bankAccountNumber): a table never renders them, and
 * fetching them meant decrypting three values per row (75 crypto ops for a
 * 25-row page) and putting national IDs on the wire for a view that doesn't
 * show them. Detail (`GET /employees/:id`) still returns the full record.
 */
const LIST_SELECT = {
  id: true, employeeNumber: true, firstName: true, lastName: true,
  phone: true, email: true, departmentId: true, jobTitleId: true,
  employmentType: true, employmentStatus: true, hireDate: true, exitDate: true,
  createdAt: true,
} as const;

interface EmployeeListRow {
  id: string; employeeNumber: string; firstName: string; lastName: string;
  phone: string | null; email: string | null;
  departmentId: string | null; jobTitleId: string | null;
  employmentType: string; employmentStatus: string;
  hireDate: Date; exitDate: Date | null; createdAt: Date;
}

/** Map the sort whitelist to Prisma orderBy. `name` sorts by surname then first name. */
function orderByFor(sort: EmployeeSortField, order: 'asc' | 'desc'): Record<string, unknown>[] {
  if (sort === 'name') return [{ lastName: order }, { firstName: order }];
  return [{ [sort]: order }];
}

/** The org's numbering config, as read for allocation/preview. */
interface OrgNumbering {
  employeeNumberPrefix: string | null;
  employeeNumberPadding: number;
  employeeNumberNextSeq: number;
}

// Shape of the raw employee row we read back from Prisma (subset we use).
interface EmployeeRow {
  id: string; employeeNumber: string; firstName: string; lastName: string;
  nationalId: string; kraPin: string | null; bankAccountNumber: string | null;
  bankName: string | null; bankCode: string | null; bankBranchCode: string | null;
  phone: string | null; email: string | null;
  dateOfBirth: Date | null; gender: string | null;
  departmentId: string | null; jobTitleId: string | null;
  employmentType: string; employmentStatus: string;
  hireDate: Date; exitDate: Date | null; nextOfKin: unknown;
  createdAt: Date; updatedAt: Date;
  user?: { email: string; isActive: boolean; role: { name: string } } | null;
}

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Read the org's numbering config without consuming a number.
   * `next` is a PREVIEW ONLY — it is not reserved. Two people opening the form
   * at once will both see the same preview; the real number is allocated at save
   * time, so they end up with different ones.
   */
  async numberingPreview(): Promise<{ autoNumbering: boolean; prefix: string | null; next: string | null }> {
    const orgId = getRequestContext().organizationId;
    const org = (await this.prisma.organization.findFirst({
      where: { id: orgId },
      select: { employeeNumberPrefix: true, employeeNumberPadding: true, employeeNumberNextSeq: true },
    })) as unknown as OrgNumbering | null;
    if (!org?.employeeNumberPrefix) return { autoNumbering: false, prefix: null, next: null };
    return {
      autoNumbering: true,
      prefix: org.employeeNumberPrefix,
      next: formatEmployeeNumber(org.employeeNumberPrefix, org.employeeNumberPadding, org.employeeNumberNextSeq),
    };
  }

  /**
   * Hand out the next employee number, consuming it.
   *
   * The counter lives on the organisation row and is bumped with an atomic
   * `increment`, so two concurrent creates take a row lock in turn and can never
   * read the same value — this is why the sequence isn't derived from
   * MAX(employeeNumber)+1, which races and would also choke on the mixed legacy
   * formats already in the table (EMP-001, SMOKE-1784…, P9-…).
   *
   * A number may still be taken if someone typed it in manually, so we skip past
   * collisions. The DB's @@unique([organizationId, employeeNumber]) remains the
   * final backstop and surfaces as a 409.
   */
  private async allocateEmployeeNumber(): Promise<string> {
    const orgId = getRequestContext().organizationId;
    if (!orgId) throw new ConflictException('No organisation context for numbering');

    for (let attempt = 0; attempt < 20; attempt += 1) {
      // Returns the POST-increment row, so the value we own is next - 1.
      const org = (await this.prisma.organization.update({
        where: { id: orgId },
        data: { employeeNumberNextSeq: { increment: 1 } },
        select: { employeeNumberPrefix: true, employeeNumberPadding: true, employeeNumberNextSeq: true },
      })) as unknown as OrgNumbering;

      if (!org.employeeNumberPrefix) {
        throw new BadRequestException(
          'employeeNumber is required: automatic numbering is off. Set an employee number prefix in '
          + 'organisation settings, or supply employeeNumber explicitly.',
        );
      }

      const seq = org.employeeNumberNextSeq - 1;
      const candidate = formatEmployeeNumber(org.employeeNumberPrefix, org.employeeNumberPadding, seq);
      const taken = await this.prisma.employee.count({ where: { employeeNumber: candidate } });
      if (taken === 0) return candidate;
      // Otherwise the counter has already advanced; loop and try the next one.
    }
    throw new ConflictException(
      'Could not allocate an employee number — the next 20 candidates are all taken. '
      + 'Check the employee number prefix in organisation settings.',
    );
  }

  async create(dto: CreateEmployeeDto, actor: AuthUser) {
    // An explicit number always wins (needed when migrating staff who already
    // have one); auto-numbering only fills the gap when it's omitted.
    const employeeNumber = dto.employeeNumber?.trim()
      ? dto.employeeNumber.trim()
      : await this.allocateEmployeeNumber();

    const data: Record<string, unknown> = {
      employeeNumber,
      firstName: dto.firstName,
      lastName: dto.lastName,
      nationalId: await this.crypto.encrypt(dto.nationalId),
      nationalIdHmac: this.crypto.blindIndex(dto.nationalId),
      kraPin: dto.kraPin ? await this.crypto.encrypt(dto.kraPin) : null,
      kraPinHmac: dto.kraPin ? this.crypto.blindIndex(dto.kraPin) : null,
      bankAccountNumber: dto.bankAccountNumber ? await this.crypto.encrypt(dto.bankAccountNumber) : null,
      bankName: dto.bankName ?? null,
      bankCode: dto.bankCode ?? null,
      bankBranchCode: dto.bankBranchCode ?? null,
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
      return this.toResponse(row, actor);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('employeeNumber already exists');
      }
      throw err;
    }
  }

  async list(query: ListEmployeesDto) {
    const where: Record<string, unknown> = {};
    if (query.status) where.employmentStatus = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.q) {
      // Plaintext columns only. The tenant extension adds organizationId at the
      // top level of `where`, which ANDs with this OR block — so search can
      // never reach across orgs.
      where.OR = [
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { employeeNumber: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        select: LIST_SELECT,
        skip,
        take: query.pageSize,
        orderBy: orderByFor(query.sort, query.order),
      }) as unknown as Promise<EmployeeListRow[]>,
      this.prisma.employee.count({ where }) as unknown as Promise<number>,
    ]);

    // No decryption here — LIST_SELECT omits every encrypted column, so there is
    // no PII to mask and no per-row crypto cost.
    return {
      data: rows.map((r) => ({ ...r, fullName: `${r.firstName} ${r.lastName}` })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: string, actor: AuthUser) {
    // findFirst (not findUnique) so the tenant extension scopes by org.
    const row = (await this.prisma.employee.findFirst({
      where: { id },
      include: { user: { select: { email: true, isActive: true, role: { select: { name: true } } } } },
    })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');
    return this.toResponse(row, actor);
  }

  /**
   * Provision a login for an existing employee. Granting the 'Admin' role is
   * restricted to actors who ARE (by name) an Admin — a deliberate, narrow
   * exception left name-based rather than permission-based: even a
   * permission system needs some root bootstrap identity below which pure
   * RBAC operates, and a custom role granted every other permission still
   * should not be able to mint new Admins. Everything else can hand out the
   * rest. Roles are resolved-or-created by name because only 'Admin' is ever
   * actually seeded (see apps/api/scripts/seed.ts) — the same pattern
   * seed.ts itself uses; a newly-created role is backfilled with the same
   * permission set ROLE_PERMISSION_DEFAULTS would give it, not left empty.
   *
   * There is no email infrastructure in this app: the temporary password is
   * returned once in the response body, the same precedent as MFA backup
   * codes (AuthService.enableMfa). It cannot be retrieved again — only reset.
   */
  async createLogin(employeeId: string, dto: CreateLoginDto, actor: AuthUser) {
    if (dto.roleName === 'Admin' && actor.role !== 'Admin') {
      throw new ForbiddenException('Only an Admin can grant the Admin role');
    }

    // findFirst (not findUnique) so the tenant extension scopes by org.
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('Employee not found');

    let role = (await this.prisma.role.findFirst({
      where: { name: dto.roleName },
    })) as unknown as { id: string } | null;
    role ??= (await this.prisma.role.create({
      data: { name: dto.roleName, permissions: [...(ROLE_PERMISSION_DEFAULTS[dto.roleName] ?? [])] } as never,
    })) as unknown as { id: string };

    const temporaryPassword = this.passwords.generateTempPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    try {
      await this.prisma.user.create({
        data: {
          email: dto.email, passwordHash, mustChangePassword: true, roleId: role.id, employeeId,
        } as never,
      });
    } catch (err) {
      // Prisma 7's driver adapter (no Rust query engine) reports the failing
      // columns in the message text, not a structured meta.target array —
      // confirmed against a live P2002 (see the two unique constraints on User:
      // employeeId, and [organizationId, email]).
      const { code, message } = err as { code?: string; message?: string };
      if (code === 'P2002') {
        if (message?.includes('employeeId')) throw new ConflictException('This employee already has a login');
        if (message?.includes('email')) throw new ConflictException('That email is already in use');
      }
      throw err;
    }

    return { email: dto.email, temporaryPassword, role: dto.roleName };
  }

  /** Find an employee by raw national ID using the blind index (no plaintext scan). */
  async lookupByNationalId(nationalId: string, actor: AuthUser) {
    const hmac = this.crypto.blindIndex(nationalId);
    const row = (await this.prisma.employee.findFirst({
      where: { nationalIdHmac: hmac },
    })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');
    return this.toResponse(row, actor);
  }

  async update(id: string, dto: UpdateEmployeeDto, actor: AuthUser) {
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
    assign('bankCode', dto.bankCode);
    assign('bankBranchCode', dto.bankBranchCode);
    // `new Date(null)` is 1970-01-01, not null — so clearing a date has to be
    // handled explicitly or a cleared DOB silently becomes the epoch.
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }
    if (dto.hireDate !== undefined && dto.hireDate) data.hireDate = new Date(dto.hireDate);
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
      return this.toResponse(row, actor);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('employeeNumber already exists');
      }
      throw err;
    }
  }

  async terminate(id: string, dto: TerminateEmployeeDto, actor: AuthUser) {
    await this.ensureExists(id);
    const row = (await this.prisma.employee.update({
      where: { id },
      data: {
        employmentStatus: 'EXITED',
        exitDate: dto.exitDate ? new Date(dto.exitDate) : new Date(),
      },
    })) as unknown as EmployeeRow;
    return this.toResponse(row, actor);
  }

  /**
   * Irreversibly anonymize an employee's identifying PII in place (DPA erasure).
   * Payslips, audit logs and other statutory records are preserved (referential
   * integrity + legal retention). Idempotent: a second call is a no-op.
   *
   * ERASURE IS FOR LEAVERS. A current employee's data can't be erased — it's
   * needed to pay them and to file their PAYE, which is a lawful basis to refuse
   * the request. Enforcing that here also keeps the record coherent: without it
   * you get an ACTIVE employee with no name and no bank account, who then still
   * counts toward headcount and shows up in payroll pickers. Terminate first,
   * then erase.
   */
  async anonymize(id: string) {
    const row = (await this.prisma.employee.findFirst({ where: { id } })) as unknown as EmployeeRow | null;
    if (!row) throw new NotFoundException('Employee not found');

    const payslips = await this.prisma.payslip.count({ where: { employeeId: id } as never });

    // Idempotency is checked BEFORE the status guard on purpose: a record erased
    // under the old rules may still be ACTIVE, and re-erasing it must stay a
    // harmless no-op rather than start throwing.
    if (row.firstName === EMPLOYEE_ANON_MARKER) {
      return { employeeId: id, anonymized: true, alreadyAnonymized: true, retained: { payslips } };
    }

    if (row.employmentStatus !== 'EXITED') {
      throw new ConflictException(
        `Cannot erase an employee whose status is ${row.employmentStatus}. Erasure is for people who have left: `
        + 'terminate them first (POST /employees/:id/terminate), then erase.',
      );
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

  /** Decrypt PII server-side, then expose full or masked values per the caller's permissions. */
  private async toResponse(row: EmployeeRow, actor: AuthUser) {
    const privileged = isPiiPrivileged(actor.permissions);
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
      // Routing codes are public bank identifiers (not PII) and are accepted by
      // create/update — they were simply never returned, so a client could write
      // them but not read them back. Needed by the employee detail screen.
      bankCode: row.bankCode,
      bankBranchCode: row.bankBranchCode,
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
      login: row.user ? { email: row.user.email, role: row.user.role.name, isActive: row.user.isActive } : null,
    };
  }
}
