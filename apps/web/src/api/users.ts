import { api } from './client';

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
