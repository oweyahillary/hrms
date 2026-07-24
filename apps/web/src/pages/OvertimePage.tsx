import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, Group, Modal, NumberInput, Select, Skeleton, Stack, Table,
  Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconChecks, IconClockPlus, IconPlus } from '@tabler/icons-react';
import {
  listOvertime, deriveOvertime, createOvertimeEntry, approveOvertimeEntry, rejectOvertimeEntry,
  bulkApproveOvertime, OVERTIME_CATEGORIES,
  type OvertimeEntry, type OvertimeCategory, type OvertimeStatus, type DeriveOvertimeResult,
} from '../api/overtime';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { getDepartments, departmentOptions, type Option } from '../api/lookups';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { formatDate } from '../utils/date';
import { kes } from '../utils/money';

const CATEGORY_LABEL: Record<OvertimeCategory, string> = {
  NORMAL_DAY: 'Normal day', REST_DAY: 'Rest day', HOLIDAY: 'Holiday',
};
const CATEGORY_COLOR: Record<OvertimeCategory, string> = {
  NORMAL_DAY: 'brand', REST_DAY: 'amber', HOLIDAY: 'red',
};
const STATUS_LABEL: Record<OvertimeStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
const STATUS_COLOR: Record<OvertimeStatus, string> = { PENDING: 'amber', APPROVED: 'brand', REJECTED: 'red' };

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function firstOfMonthIso(): string { return `${new Date().toISOString().slice(0, 7)}-01`; }

interface EntryFormValues {
  employeeId: string; date: string; hours: number | string; category: OvertimeCategory; note: string;
}

export function OvertimePage() {
  const [status, setStatus] = useState<OvertimeStatus | null>('PENDING');
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [rows, setRows] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [rejectTarget, setRejectTarget] = useState<OvertimeEntry | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  const [entryOpen, setEntryOpen] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriveFrom, setDeriveFrom] = useState(firstOfMonthIso());
  const [deriveTo, setDeriveTo] = useState(todayIso());
  const [deriving, setDeriving] = useState(false);
  const [deriveResult, setDeriveResult] = useState<DeriveOvertimeResult | null>(null);
  const [deriveError, setDeriveError] = useState<string | null>(null);

  const entryForm = useForm<EntryFormValues>({
    validateInputOnBlur: true,
    initialValues: { employeeId: '', date: todayIso(), hours: '', category: 'NORMAL_DAY', note: '' },
    validate: {
      employeeId: (v) => (v ? null : 'Choose an employee'),
      hours: (v) => (Number(v) > 0 ? null : 'Enter hours worked'),
    },
  });

  useEffect(() => {
    void getDepartments().then((d) => setDepartments(departmentOptions(d))).catch(() => { /* filter just stays empty */ });
    void loadEmployeeOptions().then(setEmployees).catch(() => { /* picker just stays empty */ });
  }, []);

  const employeeName = (id: string): string => employees.find((e) => e.value === id)?.label ?? id;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listOvertime({ status: status ?? undefined, from, to, departmentId: departmentId ?? undefined }));
    } catch {
      setError('Overtime could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [status, from, to, departmentId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const approve = async (id: string) => {
    setActingId(id);
    try {
      await approveOvertimeEntry(id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not approve', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setActingId(null);
    }
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true); setRejectError(null);
    try {
      await rejectOvertimeEntry(rejectTarget.id, rejectNote.trim());
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Entry rejected', message: '' });
      setRejectTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRejectError(e instanceof ApiError ? e.message : 'Could not reject this entry.');
    } finally {
      setRejecting(false);
    }
  };

  const doBulkApprove = async () => {
    setBulkApproving(true);
    try {
      const result = await bulkApproveOvertime(from, to, departmentId ?? undefined);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: `${result.approved} entries approved`, message: '' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not bulk approve', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setBulkApproving(false);
    }
  };

  const openEntry = () => {
    entryForm.setValues({ employeeId: '', date: todayIso(), hours: '', category: 'NORMAL_DAY', note: '' });
    entryForm.resetDirty();
    setEntryError(null);
    setEntryOpen(true);
  };

  const submitEntry = async (values: EntryFormValues) => {
    setSavingEntry(true); setEntryError(null);
    try {
      await createOvertimeEntry({
        employeeId: values.employeeId, date: values.date, hours: Number(values.hours),
        category: values.category, note: values.note.trim() || undefined,
      });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Overtime entry recorded', message: '' });
      setEntryOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setEntryError(e instanceof ApiError ? e.message : 'Could not record this entry.');
    } finally {
      setSavingEntry(false);
    }
  };

  const openDerive = () => {
    setDeriveFrom(firstOfMonthIso()); setDeriveTo(todayIso());
    setDeriveResult(null); setDeriveError(null);
    setDeriveOpen(true);
  };

  const submitDerive = async () => {
    setDeriving(true); setDeriveError(null); setDeriveResult(null);
    try {
      const result = await deriveOvertime(deriveFrom, deriveTo);
      setDeriveResult(result);
      if (result.derived > 0 || result.updated > 0 || result.removed > 0) setReloadKey((k) => k + 1);
    } catch (e) {
      setDeriveError(e instanceof ApiError ? e.message : 'Could not derive overtime for this range.');
    } finally {
      setDeriving(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Overtime</Title>
          <Text c="sand.6" mt={4}>Derived from attendance, or entered manually — review and approve before it reaches payroll.</Text>
        </div>
        <Group>
          <Button variant="light" leftSection={<IconClockPlus size={16} />} onClick={openDerive}>Derive from attendance</Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openEntry}>New entry</Button>
        </Group>
      </Group>

      <Group justify="space-between" wrap="wrap">
        <Group>
          <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value || firstOfMonthIso())} w={160} />
          <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value || todayIso())} w={160} />
          <Select
            label="Status" placeholder="All statuses" clearable w={160}
            data={[{ value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]}
            value={status} onChange={(v) => setStatus(v as OvertimeStatus | null)}
          />
          <Select
            label="Department" placeholder="All departments" clearable w={200}
            data={departments} value={departmentId} onChange={setDepartmentId}
          />
        </Group>
        {status === 'PENDING' && rows.length > 0 && (
          <Button
            variant="light" color="brand" leftSection={<IconChecks size={16} />}
            loading={bulkApproving} onClick={() => void doBulkApprove()}
            style={{ alignSelf: 'flex-end' }}
          >
            Approve all in range ({rows.length})
          </Button>
        )}
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={860}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Employee</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Hours</Table.Th>
                    <Table.Th>Amount</Table.Th>
                    <Table.Th>Source</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
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
                  {!loading && rows.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td><Text size="sm" fw={500}>{employeeName(r.employeeId)}</Text></Table.Td>
                      <Table.Td>{formatDate(r.date)}</Table.Td>
                      <Table.Td><Badge variant="light" size="sm" color={CATEGORY_COLOR[r.category]}>{CATEGORY_LABEL[r.category]}</Badge></Table.Td>
                      <Table.Td>{r.hours}h</Table.Td>
                      <Table.Td>{r.amount === null ? <Text size="sm" c="sand.5">—</Text> : kes(r.amount)}</Table.Td>
                      <Table.Td><Badge variant="outline" size="sm" color="sand">{r.source === 'DERIVED' ? 'Derived' : 'Manual'}</Badge></Table.Td>
                      <Table.Td><Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge></Table.Td>
                      <Table.Td>
                        {r.status === 'PENDING' && (
                          <Group gap={4} wrap="nowrap" justify="flex-end">
                            <Button size="compact-sm" variant="subtle" color="brand" loading={actingId === r.id} onClick={() => void approve(r.id)}>
                              Approve
                            </Button>
                            <Button size="compact-sm" variant="subtle" color="red" onClick={() => { setRejectError(null); setRejectNote(''); setRejectTarget(r); }}>
                              Reject
                            </Button>
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Stack hiddenFrom="sm" gap={0} p="md">
            {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={90} radius="sm" mb="sm" />)}
            {!loading && rows.map((r) => (
              <Card key={r.id} withBorder p="md" radius="sm" mb="sm">
                <Group justify="space-between" mb={4}>
                  <Text fw={600} size="sm">{employeeName(r.employeeId)}</Text>
                  <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </Group>
                <Group gap={6} mb={6}>
                  <Badge variant="light" size="sm" color={CATEGORY_COLOR[r.category]}>{CATEGORY_LABEL[r.category]}</Badge>
                  <Text size="xs" c="sand.6">{formatDate(r.date)} · {r.hours}h{r.amount !== null ? ` · ${kes(r.amount)}` : ''}</Text>
                </Group>
                {r.status === 'PENDING' && (
                  <Group gap={6}>
                    <Button size="compact-sm" variant="light" color="brand" loading={actingId === r.id} onClick={() => void approve(r.id)}>Approve</Button>
                    <Button size="compact-sm" variant="light" color="red" onClick={() => { setRejectError(null); setRejectNote(''); setRejectTarget(r); }}>Reject</Button>
                  </Group>
                )}
              </Card>
            ))}
          </Stack>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconClockPlus} title="No overtime entries in this range" description="Derive from attendance, or record one manually." actionLabel="New entry" onAction={openEntry} />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject overtime entry" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Reject {rejectTarget ? employeeName(rejectTarget.employeeId) : ''}&apos;s {rejectTarget?.hours}h entry on {rejectTarget ? formatDate(rejectTarget.date) : ''}?
          </Text>
          <Textarea label="Reason" withAsterisk placeholder="Why this entry is being rejected" value={rejectNote} onChange={(e) => setRejectNote(e.currentTarget.value)} />
          {rejectError && <Text size="sm" c="red">{rejectError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button color="red" loading={rejecting} disabled={!rejectNote.trim()} onClick={() => void doReject()}>Reject</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={entryOpen} onClose={() => setEntryOpen(false)} title="New overtime entry" centered>
        <form onSubmit={entryForm.onSubmit((v) => void submitEntry(v))}>
          <Stack gap="md">
            <Select
              label="Employee" withAsterisk searchable placeholder="Search by name or employee number"
              data={employees} {...entryForm.getInputProps('employeeId')}
            />
            <Group grow>
              <TextInput label="Date" type="date" withAsterisk {...entryForm.getInputProps('date')} />
              <NumberInput label="Hours" withAsterisk min={0.25} max={24} step={0.25} decimalScale={2} {...entryForm.getInputProps('hours')} />
            </Group>
            <Select
              label="Category" withAsterisk allowDeselect={false}
              data={OVERTIME_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
              value={entryForm.values.category} onChange={(v) => entryForm.setFieldValue('category', (v as OvertimeCategory) ?? 'NORMAL_DAY')}
            />
            <Textarea label="Note" placeholder="Optional context" {...entryForm.getInputProps('note')} />
            {entryError && <Text size="sm" c="red">{entryError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEntryOpen(false)}>Cancel</Button>
              <Button type="submit" loading={savingEntry}>Save entry</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={deriveOpen} onClose={() => setDeriveOpen(false)} title="Derive overtime from attendance" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.6">
            Scans completed attendance (clock-in and clock-out both set) in this range and generates pending overtime
            entries. Safe to re-run — existing pending derived entries are updated, not duplicated; approved or
            already-paid entries are never touched.
          </Text>
          <Group grow>
            <TextInput label="From" type="date" value={deriveFrom} onChange={(e) => setDeriveFrom(e.currentTarget.value)} />
            <TextInput label="To" type="date" value={deriveTo} onChange={(e) => setDeriveTo(e.currentTarget.value)} />
          </Group>
          {deriveError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{deriveError}</Alert>
          )}
          {deriveResult && (
            <Alert
              color="brand" variant="light" icon={<IconCheck size={16} />}
              title={`${deriveResult.derived} new, ${deriveResult.updated} updated, ${deriveResult.removed} removed`}
            >
              {deriveResult.excessReported.length > 0 && (
                <Stack gap={4} mt="xs">
                  <Text size="xs" fw={600}>Capped by the daily maximum — excess not counted:</Text>
                  {deriveResult.excessReported.map((e, i) => (
                    <Text key={i} size="xs">{employeeName(e.employeeId)} on {formatDate(e.date)}: {e.hours}h counted, {e.excessHours}h excess</Text>
                  ))}
                </Stack>
              )}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeriveOpen(false)}>Close</Button>
            <Button loading={deriving} onClick={() => void submitDerive()}>Derive</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
