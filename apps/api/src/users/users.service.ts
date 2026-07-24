import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import {
  resolveRolePermissions, isScopeable, ROLE_PERMISSION_DEFAULTS, ROLE_TEMPLATES, type GrantedPermission,
} from '../auth/permissions';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';
import type { GrantedPermissionDto } from './dto/granted-permission.dto';

interface RoleRow { id: string; name: string; permissions: unknown }
/** The historically-known role names — see auth/permissions.ts. Not deletable (may still be renamed/re-permissioned). */
const SEEDED_ROLE_NAMES = new Set(Object.keys(ROLE_PERMISSION_DEFAULTS));

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

  /** Roles for the role-picker AND the Settings > Roles admin page. */
  async listRoles() {
    const roles = (await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    } as never)) as unknown as Array<RoleRow & { _count: { users: number } }>;
    return roles.map((r) => this.presentRole(r, r._count.users));
  }

  async getRole(id: string) {
    const role = (await this.prisma.role.findFirst({
      where: { id } as never, include: { _count: { select: { users: true } } },
    } as never)) as unknown as (RoleRow & { _count: { users: number } }) | null;
    if (!role) throw new NotFoundException('Role not found');
    return this.presentRole(role, role._count.users);
  }

  /** Ready-made permission sets for the "New role" picker — see auth/permissions.ts's ROLE_TEMPLATES. */
  templates() {
    return ROLE_TEMPLATES;
  }

  async createRole(dto: CreateRoleDto) {
    try {
      const role = (await this.prisma.role.create({
        data: { name: dto.name, permissions: this.normalize(dto.permissions) } as never,
      })) as unknown as RoleRow;
      return this.presentRole(role, 0);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A role with this name already exists in this organisation.');
      }
      throw err;
    }
  }

  /**
   * Seeded roles (the historically-known names — see ROLE_PERMISSION_DEFAULTS)
   * may have their permissions re-assigned like any other role. The one thing
   * they can't do is rename AWAY from 'Admin': createLogin's "only an Admin
   * can grant the Admin role" check resolves the Admin role BY NAME, so
   * renaming it would silently break that bootstrap safeguard.
   */
  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = (await this.prisma.role.findFirst({ where: { id } as never })) as unknown as RoleRow | null;
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'Admin' && dto.name !== undefined && dto.name !== 'Admin') {
      throw new ConflictException("The Admin role can't be renamed — other checks resolve it by that exact name.");
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.permissions !== undefined) data.permissions = this.normalize(dto.permissions);

    try {
      const updated = (await this.prisma.role.update({
        where: { id }, data: data as never,
      })) as unknown as RoleRow;
      const userCount = await this.prisma.user.count({ where: { roleId: id } as never });
      return this.presentRole(updated, userCount);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A role with this name already exists in this organisation.');
      }
      throw err;
    }
  }

  async removeRole(id: string) {
    const role = (await this.prisma.role.findFirst({ where: { id } as never })) as unknown as RoleRow | null;
    if (!role) throw new NotFoundException('Role not found');
    if (SEEDED_ROLE_NAMES.has(role.name)) {
      throw new ConflictException(`"${role.name}" is a built-in role and can't be deleted — its permissions can still be edited.`);
    }
    const userCount = await this.prisma.user.count({ where: { roleId: id } as never });
    if (userCount > 0) {
      throw new ConflictException(`${userCount} user(s) still hold this role — reassign them first.`);
    }
    await this.prisma.role.delete({ where: { id } });
    return { success: true };
  }

  /**
   * FORCES scope 'ALL' for any key that isn't scopeable — never trust the
   * client's scope choice on its own. A picker that silently accepted
   * OWN_DEPARTMENT for e.g. settings.manage would store a claim the backend
   * never actually enforces, which is worse than no picker at all.
   */
  private normalize(permissions: GrantedPermissionDto[]): GrantedPermission[] {
    return permissions.map((p) => ({
      key: p.key,
      scope: isScopeable(p.key) && p.scope === 'OWN_DEPARTMENT' ? 'OWN_DEPARTMENT' : 'ALL',
    }));
  }

  private presentRole(r: RoleRow, userCount: number) {
    return {
      id: r.id,
      name: r.name,
      permissions: resolveRolePermissions(r.permissions),
      isSeeded: SEEDED_ROLE_NAMES.has(r.name),
      userCount,
    };
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
