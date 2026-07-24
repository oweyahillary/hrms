import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, FileInput, Group, Modal, Select, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconCheck, IconChevronLeft, IconChevronRight, IconDownload, IconSettings,
  IconUpload, IconX,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import {
  deleteRosterEntry, getRoster, importRoster, listShiftDefinitions, upsertRosterEntry,
  ROSTER_TEMPLATE_CSV, type ImportRosterResult, type RosterEntry, type ShiftDefinition,
} from '../api/shifts';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { getDepartments, departmentOptions, type Option } from '../api/lookups';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { shiftColor } from '../utils/shift-color';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

function downloadTemplate() {
  const blob = new Blob([ROSTER_TEMPLATE_CSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'shift-roster-template.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

interface CellEdit { employeeId: string; employeeName: string; date: string; entry: RosterEntry | null }

export function ShiftsPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [shiftDefs, setShiftDefs] = useState<ShiftDefinition[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<CellEdit | null>(null);
  const [pickedShiftId, setPickedShiftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportRosterResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[6];

  useEffect(() => {
    void getDepartments().then((d) => setDepartments(departmentOptions(d))).catch(() => { /* filter just stays empty */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [emps, defs, entries] = await Promise.all([
        listEmployees({ pageSize: 100, sort: 'name', order: 'asc', departmentId: departmentId ?? undefined }),
        listShiftDefinitions(false),
        getRoster({ from: weekStart, to: weekEnd, departmentId: departmentId ?? undefined }),
      ]);
      setEmployees(emps.data);
      setShiftDefs(defs);
      setRoster(entries);
    } catch {
      setError('The roster could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekEnd, departmentId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const entryFor = (employeeId: string, date: string): RosterEntry | undefined =>
    roster.find((r) => r.employeeId === employeeId && r.date.slice(0, 10) === date);

  const openCell = (employee: EmployeeListRow, date: string) => {
    const entry = entryFor(employee.id, date) ?? null;
    setEditing({ employeeId: employee.id, employeeName: employee.fullName, date, entry });
    setPickedShiftId(entry?.shiftDefinitionId ?? null);
    setCellError(null);
  };

  const saveCell = async () => {
    if (!editing || !pickedShiftId) return;
    setSaving(true); setCellError(null);
    try {
      await upsertRosterEntry({ employeeId: editing.employeeId, date: editing.date, shiftDefinitionId: pickedShiftId });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Shift saved', message: '' });
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setCellError(e instanceof ApiError ? e.message : 'Could not save this shift.');
    } finally {
      setSaving(false);
    }
  };

  const clearCell = async () => {
    if (!editing?.entry) return;
    setSaving(true); setCellError(null);
    try {
      await deleteRosterEntry(editing.entry.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Shift cleared', message: '' });
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setCellError(e instanceof ApiError ? e.message : 'Could not clear this shift.');
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
      const result = await importRoster(importFile);
      setImportResult(result);
      if (result.imported > 0) setReloadKey((k) => k + 1);
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Could not import this file.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Shifts</Title>
          <Text c="sand.6" mt={4}>The week&apos;s roster — click a cell to set, change or clear a shift.</Text>
        </div>
        <Group gap="sm">
          <Button component={Link} to="/settings/shifts" variant="default" leftSection={<IconSettings size={16} />}>
            Shift definitions
          </Button>
          <Button variant="light" leftSection={<IconUpload size={16} />} onClick={openImport}>
            Import
          </Button>
        </Group>
      </Group>

      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button variant="default" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} leftSection={<IconChevronLeft size={15} />}>
            Prev week
          </Button>
          <Text fw={600} size="sm" w={160} ta="center">{shortDate(weekStart)} – {shortDate(weekEnd)}</Text>
          <Button variant="default" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} rightSection={<IconChevronRight size={15} />}>
            Next week
          </Button>
        </Group>
        <Select
          placeholder="All departments" clearable data={departments}
          value={departmentId} onChange={setDepartmentId} w={220}
        />
      </Group>

      {shiftDefs.length > 0 && (
        <Group gap="xs">
          {shiftDefs.map((s) => (
            <Badge key={s.id} variant="light" color={shiftColor(s.code)} size="sm">
              {s.code} · {s.name}
            </Badge>
          ))}
        </Group>
      )}

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={800}>
              <Table verticalSpacing="sm" withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ position: 'sticky', left: 0, background: 'var(--mantine-color-white)', zIndex: 2 }}>
                      Employee
                    </Table.Th>
                    {days.map((d, i) => (
                      <Table.Th key={d} ta="center">{DAY_LABELS[i]}<br /><Text span size="xs" c="sand.5" fw={400}>{shortDate(d)}</Text></Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 6 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && employees.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td style={{ position: 'sticky', left: 0, background: 'var(--mantine-color-white)' }}>
                        <Text size="sm" fw={500}>{e.fullName}</Text>
                        <Text size="xs" c="sand.6">{e.employeeNumber}</Text>
                      </Table.Td>
                      {days.map((d) => {
                        const entry = entryFor(e.id, d);
                        return (
                          <Table.Td
                            key={d} ta="center" style={{ cursor: 'pointer' }}
                            onClick={() => openCell(e, d)}
                          >
                            {entry
                              ? <Badge variant="light" color={shiftColor(entry.shiftCode)} size="sm">{entry.shiftCode}</Badge>
                              : <Text c="sand.4" size="sm">+</Text>}
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Stack hiddenFrom="sm" gap={0} p="md">
            {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={90} radius="sm" mb="sm" />)}
            {!loading && employees.map((e) => (
              <Card key={e.id} withBorder p="md" radius="sm" mb="sm">
                <Text fw={600} size="sm" mb={6}>{e.fullName}</Text>
                <Group gap={6}>
                  {days.map((d, i) => {
                    const entry = entryFor(e.id, d);
                    return (
                      <Badge
                        key={d} variant={entry ? 'light' : 'outline'}
                        color={entry ? shiftColor(entry.shiftCode) : 'sand'} size="sm"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openCell(e, d)}
                      >
                        {DAY_LABELS[i][0]} {entry ? entry.shiftCode : '—'}
                      </Badge>
                    );
                  })}
                </Group>
              </Card>
            ))}
          </Stack>

          {!loading && employees.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconUpload} title="No employees to show" description={departmentId ? 'None in this department.' : 'Add employees first.'} />
            </Box>
          )}
        </Card>
      )}

      <Modal
        opened={!!editing} onClose={() => setEditing(null)}
        title={editing ? `${editing.employeeName} — ${shortDate(editing.date)}` : ''}
        centered
      >
        {editing && (
          <Stack gap="md">
            <Select
              label="Shift" placeholder="Choose a shift"
              data={shiftDefs.map((s) => ({ value: s.id, label: `${s.code} · ${s.name} (${s.startTime}–${s.endTime})` }))}
              value={pickedShiftId} onChange={setPickedShiftId}
            />
            {cellError && <Text size="sm" c="red">{cellError}</Text>}
            <Group justify="space-between">
              {editing.entry
                ? <Button variant="subtle" color="red" leftSection={<IconX size={15} />} loading={saving} onClick={() => void clearCell()}>
                    Clear shift
                  </Button>
                : <span />}
              <Group gap="sm">
                <Button variant="default" onClick={() => setEditing(null)}>Cancel</Button>
                <Button disabled={!pickedShiftId} loading={saving} onClick={() => void saveCell()}>Save</Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={importOpen} onClose={() => setImportOpen(false)} title="Import roster" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Upload a CSV or XLSX with columns <Text span ff="monospace" fw={600}>employeeNumber, date, shiftCode</Text>.
          </Text>
          <Button variant="subtle" size="compact-sm" leftSection={<IconDownload size={14} />} onClick={downloadTemplate} style={{ alignSelf: 'flex-start' }}>
            Download template
          </Button>
          <FileInput
            label="File" placeholder="Choose a .csv or .xlsx file" accept=".csv,.xlsx"
            value={importFile} onChange={setImportFile}
          />
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
