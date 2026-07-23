import { api } from './client';

export interface ShiftDefinition {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  isNightShift: boolean;
  breakMinutes: number;
  active: boolean;
}

export interface CreateShiftDefinitionInput {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight?: boolean;
  isNightShift?: boolean;
  breakMinutes?: number;
}

export interface UpdateShiftDefinitionInput {
  name?: string;
  startTime?: string;
  endTime?: string;
  crossesMidnight?: boolean;
  isNightShift?: boolean;
  breakMinutes?: number;
  active?: boolean;
}

export const listShiftDefinitions = (includeInactive = false): Promise<ShiftDefinition[]> =>
  api<ShiftDefinition[]>(`/shift-definitions${includeInactive ? '?includeInactive=true' : ''}`);

export const createShiftDefinition = (input: CreateShiftDefinitionInput): Promise<ShiftDefinition> =>
  api<ShiftDefinition>('/shift-definitions', { method: 'POST', body: JSON.stringify(input) });

export const updateShiftDefinition = (id: string, patch: UpdateShiftDefinitionInput): Promise<ShiftDefinition> =>
  api<ShiftDefinition>(`/shift-definitions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/** 409s (via ApiError) if roster assignments still reference it — deactivate instead. */
export const deleteShiftDefinition = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/shift-definitions/${id}`, { method: 'DELETE' });

export interface RosterEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  date: string;
  shiftDefinitionId: string;
  shiftCode: string;
  shiftName: string;
  source: 'MANUAL' | 'IMPORT';
}

export interface RosterQuery { from: string; to: string; departmentId?: string }

export const getRoster = (q: RosterQuery): Promise<RosterEntry[]> => {
  const qs = new URLSearchParams({ from: q.from, to: q.to });
  if (q.departmentId) qs.set('departmentId', q.departmentId);
  return api<RosterEntry[]>(`/shifts/roster?${qs.toString()}`);
};

export interface UpsertRosterInput { employeeId: string; date: string; shiftDefinitionId: string }

export const upsertRosterEntry = (input: UpsertRosterInput): Promise<{ id: string }> =>
  api<{ id: string }>('/shifts/roster', { method: 'POST', body: JSON.stringify(input) });

/** Clears a single day's assignment. */
export const deleteRosterEntry = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/shifts/roster/${id}`, { method: 'DELETE' });

export interface ImportRosterResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

/** Format is inferred from the file extension — the API also accepts an explicit ?format= override. */
export const importRoster = (file: File): Promise<ImportRosterResult> => {
  const form = new FormData();
  form.append('file', file);
  const format = file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
  return api<ImportRosterResult>(`/shifts/roster/import?format=${format}`, { method: 'POST', body: form });
};

export const ROSTER_TEMPLATE_CSV = 'employeeNumber,date,shiftCode\nEMP-001,2026-08-04,M\n';
