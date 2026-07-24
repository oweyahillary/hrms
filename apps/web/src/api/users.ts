import { api } from './client';
import type { GrantedPermission } from '../auth/permissions';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  roleId: string;
  roleName: string | null;
  employeeId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  /** Which resource group this belongs to, for the grouped Roles UI. */
  resource: string;
  /** Whether OWN_DEPARTMENT is a real, enforced option for this key — false means always show it as ALL, no scope picker. */
  scopeable: boolean;
}

export interface RoleTemplate {
  name: string;
  description: string;
  permissions: GrantedPermission[];
}

export interface AdminRole {
  id: string;
  name: string;
  permissions: GrantedPermission[];
  /** One of the historically-known role names (Admin, HR Manager, HR Officer, Manager, Employee) — editable but not deletable. */
  isSeeded: boolean;
  userCount: number;
}

export interface CreateRoleInput {
  name: string;
  permissions: GrantedPermission[];
}

export interface UpdateRoleInput {
  name?: string;
  permissions?: GrantedPermission[];
}

export interface CreateUserInput {
  email: string;
  roleId: string;
  employeeId?: string;
}

/** The create response carries the one-time temp password — shown once, never re-fetchable. */
export interface CreatedUser extends UserRow {
  tempPassword: string;
}

export interface UpdateUserInput {
  isActive?: boolean;
  roleId?: string;
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&')}` : '';
}

export const listUsers = (params: { isActive?: boolean; roleId?: string } = {}): Promise<UserRow[]> =>
  api<UserRow[]>(`/users${qs({
    isActive: params.isActive === undefined ? undefined : String(params.isActive),
    roleId: params.roleId,
  })}`);

export const listRoles = (): Promise<RoleOption[]> => api<RoleOption[]>('/roles');

/** The full permission catalogue, for the Settings > Roles checkbox editor. */
export const getPermissionCatalogue = (): Promise<PermissionDef[]> => api<PermissionDef[]>('/roles/catalogue');

export const listAdminRoles = (): Promise<AdminRole[]> => api<AdminRole[]>('/roles');

/** Ready-made permission sets for the "New role" picker — fully editable after creation. */
export const getRoleTemplates = (): Promise<RoleTemplate[]> => api<RoleTemplate[]>('/roles/templates');

export const createRole = (input: CreateRoleInput): Promise<AdminRole> =>
  api<AdminRole>('/roles', { method: 'POST', body: JSON.stringify(input) });

export const updateRole = (id: string, input: UpdateRoleInput): Promise<AdminRole> =>
  api<AdminRole>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteRole = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/roles/${id}`, { method: 'DELETE' });

export const createUser = (input: CreateUserInput): Promise<CreatedUser> =>
  api<CreatedUser>('/users', { method: 'POST', body: JSON.stringify(input) });

export const updateUser = (id: string, input: UpdateUserInput): Promise<UserRow> =>
  api<UserRow>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export interface UserOption {
  value: string;
  label: string;
}

/** Active users flattened to Select options — mirrors loadEmployeeOptions. */
export async function loadUserOptions(): Promise<UserOption[]> {
  const users = await listUsers({ isActive: true });
  return users.map((u) => ({ value: u.id, label: u.displayName }));
}
