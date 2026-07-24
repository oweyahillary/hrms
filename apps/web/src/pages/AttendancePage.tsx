import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, FileInput, Group, Modal, Select, SegmentedControl, Skeleton,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconCheck, IconClockHour4, IconDownload, IconUpload, IconUsers,
} from '@tabler/icons-react';
import {
  listAttendance, upsertAttendance, importAttendance, ATTENDANCE_STATUSES,
  NEUTRAL_TEMPLATE_CSV, ZKTECO_TEMPLATE_CSV,
  type AttendanceRecord, type AttendanceStatus, type AttendanceImportPreset, type ImportAttendanceResult,
} from '../api/attendance';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { getDepartments, departmentOptions, type Option } from '../api/lookups';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { shiftColor } from '../utils/shift-color';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', ON_LEAVE: 'On leave',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: 'brand', ABSENT: 'red', LATE: 'amber', ON_LEAVE: 'sand',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function monthRange(monthStr: string): { from: string; to: string } {
  const [y, m] = monthStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${monthStr}-01`, to: `${monthStr}-${String(lastDay).padStart(2, '0')}` };
}
function toInstant(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}
function timeOf(iso: string | null): string {
  return iso ? iso.slice(11, 16) : '';
}

function downloadTemplate(preset: AttendanceImportPreset) {
  const content = preset === 'ZKTECO' ? ZKTECO_TEMPLATE_CSV : NEUTRAL_TEMPLATE_CSV;
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `attendance-template-${preset.toLowerCase()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

interface EditState { employee: EmployeeListRow; record: AttendanceRecord | null }

export function AttendancePage() {
  const [view, setView] = useState<'day' | 'month'>('day');
  const [date, setDate] = useState(todayIso());
  const [month, setMonth] = useState(currentMonth());
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<EditState | null>(null);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importPreset, setImportPreset] = useState<AttendanceImportPreset>('NEUTRAL');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportAttendanceResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    void getDepartments().then((d) => setDepartments(departmentOptions(d))).catch(() => { /* filter just stays empty */ });
  }, []);

  const range = view === 'day' ? { from: date, to: date } : monthRange(month);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [emps, recs] = await Promise.all([
        listEmployees({ pageSize: 100, sort: 'name', order: 'asc', departmentId: departmentId ?? undefined }),
        listAttendance({ departmentId: departmentId ?? undefined, from: range.from, to: range.to }),
      ]);
      setEmployees(emps.data);
      setRecords(recs);
    } catch {
      setError('Attendance could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, month, departmentId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const recordFor = (employeeId: string): AttendanceRecord | undefined =>
    records.find((r) => r.employeeId === employeeId && r.date.slice(0, 10) === date);

  const openEdit = (employee: EmployeeListRow, record: AttendanceRecord | null) => {
    setEditing({ employee, record });
    setClockIn(timeOf(record?.clockIn ?? null));
    setClockOut(timeOf(record?.clockOut ?? null));
    setStatus(record?.status ?? null);
    setSaveError(null);
  };

  const submit = async () => {
    if (!editing) return;
    setSaving(true); setSaveError(null);
    try {
      await upsertAttendance({
        employeeId: editing.employee.id,
        date,
        clockIn: clockIn ? toInstant(date, clockIn) : undefined,
        clockOut: clockOut ? toInstant(date, clockOut) : undefined,
        status: (status as AttendanceStatus) || undefined,
      });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Attendance saved', message: '' });
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save this record.');
    } finally {
      setSaving(false);
    }
  };

  const openImport = () => {
    setImportFile(null); setImportResult(null); setImportError(null); setImportOpen(true);
  };
  const submitImport = async () => {
    if (!importFile) return;
    setImporting(true); setImportError(null); setImportResult(null);
    try {
      const result = await importAttendance(importFile, importPreset);
      setImportResult(result);
      if (result.imported > 0) setReloadKey((k) => k + 1);
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Could not import this file.');
    } finally {
      setImporting(false);
    }
  };

  // Month view: per-employee status counts.
  const monthSummary = employees.map((e) => {
    const rows = records.filter((r) => r.employeeId === e.id);
    const counts: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, ON_LEAVE: 0 };
    rows.forEach((r) => { counts[r.status] += 1; });
    return { employee: e, counts };
  });

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Attendance</Title>
          <Text c="sand.6" mt={4}>The day&apos;s register, or a month&apos;s summary — mark, correct and import.</Text>
        </div>
        <Button variant="light" leftSection={<IconUpload size={16} />} onClick={openImport}>
          Import
        </Button>
      </Group>

      <Group justify="space-between" wrap="wrap">
        <SegmentedControl
          value={view} onChange={(v) => setView(v as 'day' | 'month')}
          data={[{ label: 'Day', value: 'day' }, { label: 'Month', value: 'month' }]}
        />
        <Group>
          {view === 'day' ? (
            <TextInput label="Date" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value || todayIso())} w={180} />
          ) : (
            <TextInput label="Month" type="month" value={month} onChange={(e) => setMonth(e.currentTarget.value || currentMonth())} w={180} />
          )}
          <Select
            label="Department" placeholder="All departments" clearable
            data={departments} value={departmentId} onChange={setDepartmentId} w={220}
          />
        </Group>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && view === 'day' && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={860}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th>Shift</Table.Th>
                    <Table.Th>Clock in</Table.Th>
                    <Table.Th>Clock out</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Late</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 6 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && employees.map((e) => {
                    const r = recordFor(e.id);
                    return (
                      <Table.Tr key={e.id} onClick={() => openEdit(e, r ?? null)} style={{ cursor: 'pointer' }}>
                        <Table.Td>
                          <Text size="sm" fw={500}>{e.fullName}</Text>
                          <Text size="xs" c="sand.6">{e.employeeNumber}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            {r?.shiftCode
                              ? <Badge variant="light" size="sm" color={shiftColor(r.shiftCode)}>{r.shiftCode}</Badge>
                              : <Text size="xs" c="sand.4">—</Text>}
                            {r?.unassigned && (
                              <Badge variant="outline" size="sm" color="sand">Unassigned</Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>{timeOf(r?.clockIn ?? null) || '—'}</Table.Td>
                        <Table.Td>{timeOf(r?.clockOut ?? null) || '—'}</Table.Td>
                        <Table.Td>
                          {r ? <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                            : <Badge variant="light" size="sm" color="sand">Not marked</Badge>}
                        </Table.Td>
                        <Table.Td>
                          {r && r.lateMinutes > 0 ? <Text size="sm" c="amber.7">{r.lateMinutes}m</Text> : <Text size="sm" c="sand.5">—</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Button size="compact-sm" variant="subtle" onClick={(ev) => { ev.stopPropagation(); openEdit(e, r ?? null); }}>
                            {r ? 'Edit' : 'Mark'}
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Stack hiddenFrom="sm" gap={0} p="md">
            {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={80} radius="sm" mb="sm" />)}
            {!loading && employees.map((e) => {
              const r = recordFor(e.id);
              return (
                <Card key={e.id} withBorder p="md" radius="sm" mb="sm" onClick={() => openEdit(e, r ?? null)} style={{ cursor: 'pointer' }}>
                  <Group justify="space-between" mb={4}>
                    <div>
                      <Text fw={600} size="sm">{e.fullName}</Text>
                      <Text size="xs" c="sand.6">{e.employeeNumber}</Text>
                    </div>
                    {r ? <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      : <Badge variant="light" size="sm" color="sand">Not marked</Badge>}
                  </Group>
                  <Group gap={6}>
                    {r?.shiftCode && <Badge variant="light" size="sm" color={shiftColor(r.shiftCode)}>{r.shiftCode}</Badge>}
                    <Text size="xs" c="sand.6">{timeOf(r?.clockIn ?? null) || '—'} – {timeOf(r?.clockOut ?? null) || '—'}</Text>
                    {r && r.lateMinutes > 0 && <Text size="xs" c="amber.7">{r.lateMinutes}m late</Text>}
                  </Group>
                </Card>
              );
            })}
          </Stack>

          {!loading && employees.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconUsers} title="No employees to show" description={departmentId ? 'None in this department.' : 'Add employees first.'} />
            </Box>
          )}
        </Card>
      )}

      {!error && view === 'month' && (
        <Card p={0} radius="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th ta="center">Present</Table.Th>
                    <Table.Th ta="center">Late</Table.Th>
                    <Table.Th ta="center">Absent</Table.Th>
                    <Table.Th ta="center">On leave</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 6 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && monthSummary.map(({ employee, counts }) => (
                    <Table.Tr key={employee.id}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{employee.fullName}</Text>
                        <Text size="xs" c="sand.6">{employee.employeeNumber}</Text>
                      </Table.Td>
                      <Table.Td ta="center">{counts.PRESENT}</Table.Td>
                      <Table.Td ta="center">{counts.LATE > 0 ? <Text span c="amber.7">{counts.LATE}</Text> : counts.LATE}</Table.Td>
                      <Table.Td ta="center">{counts.ABSENT > 0 ? <Text span c="red.7">{counts.ABSENT}</Text> : counts.ABSENT}</Table.Td>
                      <Table.Td ta="center">{counts.ON_LEAVE}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          {!loading && employees.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconUsers} title="No employees to show" description={departmentId ? 'None in this department.' : 'Add employees first.'} />
            </Box>
          )}
        </Card>
      )}

      <Modal
        opened={!!editing} onClose={() => setEditing(null)}
        title={editing ? `${editing.record ? 'Edit' : 'Mark'} attendance — ${editing.employee.fullName}` : ''}
        centered
      >
        {editing && (
          <Stack gap="md">
            <Text size="sm" c="sand.6">{date}</Text>
            <Group grow>
              <TextInput label="Clock in" type="time" value={clockIn} onChange={(e) => setClockIn(e.currentTarget.value)} />
              <TextInput label="Clock out" type="time" value={clockOut} onChange={(e) => setClockOut(e.currentTarget.value)} />
            </Group>
            <Select
              label="Status" placeholder="Auto (derived from the shift and clock-in)" clearable
              data={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              value={status} onChange={setStatus}
            />
            {saveError && (
              <Group gap={6} c="red"><IconAlertTriangle size={16} /><Text size="sm">{saveError}</Text></Group>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditing(null)}>Cancel</Button>
              <Button leftSection={<IconClockHour4 size={16} />} loading={saving} onClick={() => void submit()}>
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import attendance" centered>
        <Stack gap="md">
          <Select
            label="Source format" allowDeselect={false}
            data={[{ value: 'NEUTRAL', label: 'Neutral CSV (employeeNumber, date, clockIn, clockOut, status)' }, { value: 'ZKTECO', label: 'ZKTeco device export' }]}
            value={importPreset} onChange={(v) => setImportPreset((v as AttendanceImportPreset) ?? 'NEUTRAL')}
          />
          <Button
            variant="subtle" size="compact-sm" leftSection={<IconDownload size={14} />}
            onClick={() => downloadTemplate(importPreset)} style={{ alignSelf: 'flex-start' }}
          >
            Download {importPreset === 'ZKTECO' ? 'ZKTeco' : 'neutral'} template
          </Button>
          <FileInput
            label="File" placeholder="Choose a .csv file" accept=".csv"
            value={importFile} onChange={setImportFile}
          />
          {importPreset === 'ZKTECO' && (
            <Text size="xs" c="sand.6">
              Column names are the commonly documented ZKTeco export headers — if your device&apos;s export uses
              different column names, use the neutral format instead until this is confirmed against a real export.
            </Text>
          )}
          {importError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{importError}</Alert>
          )}
          {importResult && (
            <Alert
              color={importResult.skipped > 0 ? 'amber' : 'brand'} variant="light"
              icon={importResult.skipped > 0 ? <IconAlertTriangle size={16} /> : <IconCheck size={16} />}
              title={`${importResult.imported} imported, ${importResult.skipped} skipped`}
            >
              {importResult.errors.length > 0 && (
                <Stack gap={4} mt="xs">
                  {importResult.errors.map((e, i) => (
                    <Text key={i} size="xs">Row {e.row}: {e.message}</Text>
                  ))}
                </Stack>
              )}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setImportOpen(false)}>Close</Button>
            <Button disabled={!importFile} loading={importing} onClick={() => void submitImport()}>Upload</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
