import { api } from './client';

export interface AttendanceDevice {
  id: string;
  serialNumber: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  registeredAt: string;
}

export interface CreateDeviceInput { serialNumber: string; name: string }
export interface UpdateDeviceInput { name?: string; active?: boolean }

export const listDevices = (): Promise<AttendanceDevice[]> => api<AttendanceDevice[]>('/attendance-devices');

export const createDevice = (input: CreateDeviceInput): Promise<AttendanceDevice> =>
  api<AttendanceDevice>('/attendance-devices', { method: 'POST', body: JSON.stringify(input) });

export const updateDevice = (id: string, patch: UpdateDeviceInput): Promise<AttendanceDevice> =>
  api<AttendanceDevice>(`/attendance-devices/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/** 409s (via ApiError) if any punch still references this device — deactivate instead. */
export const deleteDevice = (id: string): Promise<{ success: boolean }> =>
  api<{ success: boolean }>(`/attendance-devices/${id}`, { method: 'DELETE' });

export interface UnmatchedPunchGroup {
  devicePin: string;
  deviceId: string;
  deviceName: string;
  count: number;
  firstPunchedAt: string;
  lastPunchedAt: string;
}

export const listUnmatchedPunches = (): Promise<UnmatchedPunchGroup[]> =>
  api<UnmatchedPunchGroup[]>('/attendance-devices/unmatched-punches');

export const resolveUnmatchedPunches = (devicePin: string, employeeId: string): Promise<{ resolved: number }> =>
  api<{ resolved: number }>('/attendance-devices/unmatched-punches/resolve', {
    method: 'POST', body: JSON.stringify({ devicePin, employeeId }),
  });
