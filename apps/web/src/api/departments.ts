import { api } from './client';

export interface AdminDepartment {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  headEmployeeId: string | null;
  active: boolean;
  employeeCount: number;
  subDepartmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDepartmentInput {
  name: string;
  parentDepartmentId?: string;
  headEmployeeId?: string | null;
}

export interface UpdateDepartmentInput {
  name?: string;
  parentDepartmentId?: string | null;
  headEmployeeId?: string | null;
  active?: boolean;
}

export const listDepartmentsAdmin = (includeInactive = false): Promise<AdminDepartment[]> =>
  api<AdminDepartment[]>(`/departments${includeInactive ? '?includeInactive=true' : ''}`);

export const createDepartment = (input: CreateDepartmentInput): Promise<AdminDepartment> =>
  api<AdminDepartment>('/departments', { method: 'POST', body: JSON.stringify(input) });

export const updateDepartment = (id: string, input: UpdateDepartmentInput): Promise<AdminDepartment> =>
  api<AdminDepartment>(`/departments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteDepartment = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/departments/${id}`, { method: 'DELETE' });

export interface DepartmentTreeNode extends AdminDepartment {
  depth: number;
  children: DepartmentTreeNode[];
}

/**
 * Group the flat list into a hierarchy for indented rendering, then flatten
 * it back to a depth-annotated array in parent-then-children order (what an
 * indented table actually renders row by row). Orphans (a parentDepartmentId
 * pointing at a deactivated/missing row that got filtered out) surface at
 * the top level rather than silently disappearing.
 */
export function flattenDepartmentTree(rows: AdminDepartment[]): DepartmentTreeNode[] {
  const byParent = new Map<string, AdminDepartment[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parentDepartmentId && ids.has(r.parentDepartmentId) ? r.parentDepartmentId : '__root__';
    const arr = byParent.get(key);
    if (arr) arr.push(r); else byParent.set(key, [r]);
  }
  const sortByName = (a: AdminDepartment, b: AdminDepartment) => a.name.localeCompare(b.name);

  const out: DepartmentTreeNode[] = [];
  function walk(parentKey: string, depth: number) {
    const children = (byParent.get(parentKey) ?? []).slice().sort(sortByName);
    for (const c of children) {
      out.push({ ...c, depth, children: [] });
      walk(c.id, depth + 1);
    }
  }
  walk('__root__', 0);
  return out;
}

/**
 * Every descendant of `id` within an already-flattened (parent-before-
 * children, depth-annotated) tree — the contiguous run right after `id`
 * whose depth is greater than its own. Used to keep an obviously-cyclical
 * choice out of the "move to" picker before the API even sees it.
 */
export function descendantIds(flat: DepartmentTreeNode[], id: string): Set<string> {
  const idx = flat.findIndex((n) => n.id === id);
  if (idx === -1) return new Set();
  const depth = flat[idx].depth;
  const out = new Set<string>();
  for (let i = idx + 1; i < flat.length && flat[i].depth > depth; i += 1) out.add(flat[i].id);
  return out;
}
