import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

interface UserRow {
  id: string;
  email: string;
  roleId: string;
  employeeId: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  role?: { name: string } | null;
  employee?: { firstName: string; lastName: string } | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly passwords: PasswordService,
  ) {}

  // Every query is org-scoped automatically by the tenant extension.
  private readonly include = {
    role: { select: { name: true } },
    employee: { select: { firstName: true, lastName: true } },
  };

  async list(filter: { isActive?: boolean; roleId?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    if (filter.roleId) where.roleId = filter.roleId;
    const rows = (await this.prisma.user.findMany({
      where: where as never,
      include: this.include as never,
      orderBy: { createdAt: 'desc' },
    } as never)) as unknown as UserRow[];
    return rows.map((u) => this.present(u));
  }

  /** Read-only role list for the role-picker (Role already exists in schema). */
  async listRoles() {
    const roles = (await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
    } as never)) as unknown as Array<{ id: string; name: string }>;
    return roles.map((r) => ({ id: r.id, name: r.name }));
  }

  async create(dto: CreateUserDto) {
    const role = (await this.prisma.role.findFirst({ where: { id: dto.roleId } as never })) as unknown as { id: string } | null;
    if (!role) throw new BadRequestException('Role not found.');
    if (dto.employeeId) {
      const emp = (await this.prisma.employee.findFirst({ where: { id: dto.employeeId } as never })) as unknown as { id: string } | null;
      if (!emp) throw new BadRequestException('Employee not found.');
    }

    // No email/SMTP infrastructure exists in this codebase, so we bootstrap a
    // one-time temporary password exactly like the seed script does, force a
    // change on first login, and return the temp password ONCE for the admin to
    // share out-of-band. It is never stored in plaintext.
    const tempPassword = this.passwords.generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);

    let created: UserRow;
    try {
      created = (await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          roleId: dto.roleId,
          employeeId: dto.employeeId ?? null,
          passwordHash,
          mustChangePassword: true,
        } as never,
        include: this.include as never,
      } as never)) as unknown as UserRow;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('A user with this email already exists in this organisation.');
      }
      throw e;
    }

    return { ...this.present(created), tempPassword };
  }

  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const user = (await this.prisma.user.findFirst({ where: { id } as never })) as unknown as UserRow | null;
    if (!user) throw new NotFoundException('User not found');

    // Guard server-side: an admin must never lock themselves out. The UI also
    // hides the control, but this is the authoritative check.
    if (dto.isActive === false && id === actingUserId) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }
    if (dto.roleId) {
      const role = (await this.prisma.role.findFirst({ where: { id: dto.roleId } as never })) as unknown as { id: string } | null;
      if (!role) throw new BadRequestException('Role not found.');
    }

    const data: Record<string, unknown> = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.roleId !== undefined) data.roleId = dto.roleId;

    await this.prisma.user.update({ where: { id } as never, data: data as never });
    const fresh = (await this.prisma.user.findFirst({
      where: { id } as never,
      include: this.include as never,
    } as never)) as unknown as UserRow;
    return this.present(fresh);
  }

  private present(u: UserRow) {
    const name = u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : '';
    return {
      id: u.id,
      email: u.email,
      displayName: name || u.email,
      roleId: u.roleId,
      roleName: u.role?.name ?? null,
      employeeId: u.employeeId,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
    };
  }
}
