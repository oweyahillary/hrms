import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Drawer, Group, Modal, Select, Skeleton, Stack, Table, Text, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconFileSearch, IconPlus } from '@tabler/icons-react';
import {
  createDsr, listDsr, transitionDsr, DSR_REQUEST_TYPES, DSR_STATUSES, DSR_TRANSITIONS,
  type DataSubjectRequest, type DsrRequestType, type DsrStatus,
} from '../../api/compliance';
import { loadEmployeeOptions, type EmployeeOption } from '../../api/employee-options';
import { ApiError } from '../../api/client';
import { ErrorCard } from '../../components/ErrorCard';
import { EmptyState } from '../../components/EmptyState';
import { formatDate as fmtDate } from '../../utils/date';

const TYPE_LABEL: Record<DsrRequestType, string> = {
  ACCESS: 'Access', CORRECTION: 'Correction', ERASURE: 'Erasure',
};
const STATUS_LABEL: Record<DsrStatus, string> = {
  RECEIVED: 'Received', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', REJECTED: 'Rejected',
};
const STATUS_COLOR: Record<DsrStatus, string> = {
  RECEIVED: 'sand', IN_PROGRESS: 'amber', COMPLETED: 'brand', REJECTED: 'red',
};
const TERMINAL = new Set<DsrStatus>(['COMPLETED', 'REJECTED']);

/** Green (safe) > 10 days, amber 3–10, red under 3 or overdue. Resolved requests get a neutral badge instead. */
function SlaBadge({ r }: { r: DataSubjectRequest }) {
  if (TERMINAL.has(r.status)) {
    return <Badge variant="light" color="sand" size="sm">Resolved</Badge>;
  }
  const color = r.overdue || r.daysUntilDue < 3 ? 'red' : r.daysUntilDue <= 10 ? 'amber' : 'brand';
  const label = r.overdue
    ? `${Math.abs(r.daysUntilDue)}d overdue`
    : `${r.daysUntilDue}d left`;
  return <Badge variant="light" color={color} size="sm">{label}</Badge>;
}

interface CreateFormValues {
  employeeId: string;
  requestType: DsrRequestType;
  notes: string;
}

export function DsrPage() {
  const [rows, setRows] = useState<DataSubjectRequest[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [active, setActive] = useState<DataSubjectRequest | null>(null);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const createForm = useForm<CreateFormValues>({
    validateInputOnBlur: true,
    initialValues: { employeeId: '', requestType: 'ACCESS', notes: '' },
    validate: {
      employeeId: (v) => (v ? null : 'Choose the data subject'),
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [dsr, emps] = await Promise.all([
        listDsr(statusFilter ? (statusFilter as DsrStatus) : undefined),
        loadEmployeeOptions(),
      ]);
      setRows(dsr);
      setEmployees(emps);
    } catch {
      setError('Data subject requests could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const nameOf = (employeeId: string): string =>
    employees.find((e) => e.value === employeeId)?.label ?? employeeId;

  const openDetail = (r: DataSubjectRequest) => {
    setActive(r);
    setNextStatus(null);
    setNote('');
    setUpdateError(null);
  };

  const submitCreate = async (values: CreateFormValues) => {
    setSaving(true);
    try {
      await createDsr(values.employeeId, {
        requestType: values.requestType,
        notes: values.notes.trim() || undefined,
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Request logged', message: 'The 30-day SLA clock has started.',
      });
      setCreateOpen(false);
      createForm.reset();
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not log request',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const submitTransition = async () => {
    if (!active || !nextStatus) return;
    setUpdating(true); setUpdateError(null);
    try {
      const updated = await transitionDsr(active.id, {
        status: nextStatus as (typeof DSR_TRANSITIONS)[number],
        notes: note.trim() || undefined,
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Status updated', message: `Now ${STATUS_LABEL[updated.status]}.`,
      });
      setActive(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setUpdateError(e instanceof ApiError ? e.message : 'Could not update this request.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Data subject requests</Title>
          <Text c="sand.6" mt={4}>
            Access, correction and erasure requests — each has a 30-day response deadline.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          Log a request
        </Button>
      </Group>

      <Group>
        <Select
          placeholder="All statuses" clearable w={220}
          data={DSR_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          value={statusFilter} onChange={setStatusFilter}
        />
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Subject</Table.Th>
                    <Table.Th>Received</Table.Th>
                    <Table.Th>SLA</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 4 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && rows.map((r) => (
                    <Table.Tr key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                      <Table.Td>{TYPE_LABEL[r.requestType]}</Table.Td>
                      <Table.Td>{nameOf(r.employeeId)}</Table.Td>
                      <Table.Td>{fmtDate(r.submittedAt)}</Table.Td>
                      <Table.Td><SlaBadge r={r} /></Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Stack hiddenFrom="sm" gap={0} p="md">
            {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={64} radius="sm" mb="sm" />)}
            {!loading && rows.map((r) => (
              <Card key={r.id} withBorder p="md" radius="sm" mb="sm" onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                <Group justify="space-between" mb={4}>
                  <Text fw={600} size="sm">{nameOf(r.employeeId)}</Text>
                  <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </Group>
                <Text size="xs" c="sand.6" mb={6}>{TYPE_LABEL[r.requestType]} · Received {fmtDate(r.submittedAt)}</Text>
                <SlaBadge r={r} />
              </Card>
            ))}
          </Stack>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState
                icon={IconFileSearch}
                title="No data subject requests"
                description={statusFilter ? 'None match this filter.' : 'Access, correction and erasure requests will appear here once logged.'}
              />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Log a data subject request" centered>
        <form onSubmit={createForm.onSubmit((v) => void submitCreate(v))}>
          <Stack gap="md">
            <Select
              label="Data subject" placeholder="Choose an employee" searchable withAsterisk
              data={employees} {...createForm.getInputProps('employeeId')}
            />
            <Select
              label="Request type" withAsterisk allowDeselect={false}
              data={DSR_REQUEST_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              value={createForm.values.requestType}
              onChange={(v) => createForm.setFieldValue('requestType', (v as DsrRequestType) ?? 'ACCESS')}
            />
            <Textarea label="Notes" autosize minRows={2} {...createForm.getInputProps('notes')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Log request</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Drawer opened={!!active} onClose={() => setActive(null)} title="Data subject request" position="right" size="md">
        {active && (
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={600}>{nameOf(active.employeeId)}</Text>
              <Badge variant="light" color={STATUS_COLOR[active.status]}>{STATUS_LABEL[active.status]}</Badge>
            </Group>
            <Group gap="xl">
              <div>
                <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Type</Text>
                <Text size="sm">{TYPE_LABEL[active.requestType]}</Text>
              </div>
              <div>
                <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Received</Text>
                <Text size="sm">{fmtDate(active.submittedAt)}</Text>
              </div>
              <div>
                <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Due</Text>
                <Text size="sm">{fmtDate(active.dueDate)}</Text>
              </div>
            </Group>
            {active.resolvedAt && (
              <div>
                <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Resolved</Text>
                <Text size="sm">{fmtDate(active.resolvedAt)}</Text>
              </div>
            )}
            {active.notes && (
              <div>
                <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Notes so far</Text>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{active.notes}</Text>
              </div>
            )}

            {TERMINAL.has(active.status) ? (
              <Text size="sm" c="sand.6">This request is closed and cannot be changed further.</Text>
            ) : (
              <>
                <Select
                  label="Advance to" placeholder="Choose the next status"
                  data={DSR_TRANSITIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                  value={nextStatus} onChange={setNextStatus}
                />
                <Textarea
                  label="Note" placeholder="What was done, or why" autosize minRows={2}
                  value={note} onChange={(e) => setNote(e.currentTarget.value)}
                />
                {updateError && (
                  <Text size="sm" c="red">{updateError}</Text>
                )}
                <Group justify="flex-end">
                  <Button disabled={!nextStatus} loading={updating} onClick={() => void submitTransition()}>
                    Update status
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
