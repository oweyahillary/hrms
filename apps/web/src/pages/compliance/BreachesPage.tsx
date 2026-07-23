import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Drawer, Grid, Group, Modal, NumberInput, Progress, Skeleton, Stack,
  Table, Text, Textarea, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconCheck, IconCircleCheck, IconClockHour4, IconPlus, IconShieldExclamation,
} from '@tabler/icons-react';
import {
  createBreach, listBreaches, notifyEmployeesOfBreach, notifyOdpc, updateBreach,
  type BreachIncident, type BreachStatus, type OdpcClockStatus,
} from '../../api/compliance';
import { ApiError } from '../../api/client';
import { ErrorCard } from '../../components/ErrorCard';
import { EmptyState } from '../../components/EmptyState';
import { formatDate as fmtDate } from '../../utils/date';

const STATUS_LABEL: Record<BreachStatus, string> = { OPEN: 'Open', CONTAINED: 'Contained', CLOSED: 'Closed' };
const STATUS_COLOR: Record<BreachStatus, string> = { OPEN: 'red', CONTAINED: 'amber', CLOSED: 'sand' };
const ODPC_LABEL: Record<OdpcClockStatus, string> = {
  WITHIN_WINDOW: 'Within window', OVERDUE: 'Overdue', NOTIFIED_ON_TIME: 'Notified on time', NOTIFIED_LATE: 'Notified late',
};
const ODPC_COLOR: Record<OdpcClockStatus, string> = {
  WITHIN_WINDOW: 'amber', OVERDUE: 'red', NOTIFIED_ON_TIME: 'brand', NOTIFIED_LATE: 'red',
};

/** Ticks every second so the prominent open-incident cards read as a genuine live clock. */
function useNow(tickMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

function formatCountdown(deadline: string, now: Date): { label: string; overdue: boolean } {
  const ms = new Date(deadline).getTime() - now.getTime();
  const overdue = ms <= 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const clock = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return { label: overdue ? `Overdue by ${clock}` : clock, overdue };
}

function OpenIncidentClock({ b, now }: { b: BreachIncident; now: Date }) {
  const { label, overdue } = formatCountdown(b.odpc.deadline, now);
  const notified = !!b.odpcNotifiedAt;
  const pctElapsed = Math.min(
    100,
    Math.max(0, ((now.getTime() - new Date(b.detectedAt).getTime()) / (72 * 3_600_000)) * 100),
  );
  return (
    <Card withBorder p="lg" radius="md">
      <Group justify="space-between" align="flex-start" mb="sm">
        <Group gap="sm" align="flex-start">
          <ThemeIcon size={38} radius="md" variant="light" color={overdue ? 'red' : 'amber'}>
            <IconShieldExclamation size={20} stroke={1.7} />
          </ThemeIcon>
          <div>
            <Text fw={600}>{b.description}</Text>
            <Text size="xs" c="sand.6">Detected {fmtDate(b.detectedAt)} · {b.affectedEmployeeCount} affected</Text>
          </div>
        </Group>
        <Badge variant="light" color={STATUS_COLOR[b.status]}>{STATUS_LABEL[b.status]}</Badge>
      </Group>

      <Text size="xs" c="sand.6" tt="uppercase" fw={600} mb={4}>
        {notified ? 'ODPC notification deadline (already notified)' : '72-hour ODPC notification clock'}
      </Text>
      <Text fz={28} fw={700} c={overdue && !notified ? 'red' : undefined} mb={4}>{label}</Text>
      <Progress value={pctElapsed} color={overdue ? 'red' : 'amber'} size="sm" mb="sm" />

      {!notified && (
        <Text size="xs" c="sand.6">
          Kenya DPA s.43 requires notifying the ODPC without undue delay, no later than 72 hours after detection.
        </Text>
      )}
    </Card>
  );
}

interface CreateFormValues {
  detectedAt: string;
  description: string;
  affectedEmployeeCount: number | string;
}

export function BreachesPage() {
  const [rows, setRows] = useState<BreachIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const now = useNow(1000);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [active, setActive] = useState<BreachIncident | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const createForm = useForm<CreateFormValues>({
    validateInputOnBlur: true,
    initialValues: { detectedAt: new Date().toISOString().slice(0, 16), description: '', affectedEmployeeCount: '' },
    validate: {
      detectedAt: (v) => (v ? null : 'When was this detected?'),
      description: (v) => (v.trim() ? null : 'Describe what happened'),
      affectedEmployeeCount: (v) => (Number(v) >= 0 ? null : 'Enter a count (0 if unknown/none confirmed yet)'),
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listBreaches());
    } catch {
      setError('Breach incidents could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const openIncidents = rows.filter((r) => r.status === 'OPEN');

  const refreshActive = (updated: BreachIncident) => {
    setActive(updated);
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const submitCreate = async (values: CreateFormValues) => {
    setSaving(true);
    try {
      await createBreach({
        detectedAt: new Date(values.detectedAt).toISOString(),
        description: values.description.trim(),
        affectedEmployeeCount: Number(values.affectedEmployeeCount),
      });
      notifications.show({
        color: 'red', icon: <IconCheck size={16} />,
        title: 'Breach logged', message: 'The 72-hour ODPC clock has started.',
      });
      setCreateOpen(false);
      createForm.reset();
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not log breach',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (key: string, fn: () => Promise<BreachIncident>) => {
    setActionBusy(key); setActionError(null);
    try {
      refreshActive(await fn());
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'That action failed.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Breach incidents</Title>
          <Text c="sand.6" mt={4}>
            The ODPC must be notified within 72 hours of detecting a breach — this is the clock that matters.
          </Text>
        </div>
        <Button color="red" leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          Log a breach
        </Button>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && !loading && openIncidents.length > 0 && (
        <Grid gutter="md">
          {openIncidents.map((b) => (
            <Grid.Col key={b.id} span={{ base: 12, md: 6 }}>
              <Box onClick={() => setActive(b)} style={{ cursor: 'pointer' }}>
                <OpenIncidentClock b={b} now={now} />
              </Box>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {!error && (
        <Card p={0} radius="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Detected</Table.Th>
                    <Table.Th>Description</Table.Th>
                    <Table.Th>Affected</Table.Th>
                    <Table.Th>ODPC clock</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 3 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && rows.map((b) => (
                    <Table.Tr key={b.id} onClick={() => setActive(b)} style={{ cursor: 'pointer' }}>
                      <Table.Td>{fmtDate(b.detectedAt)}</Table.Td>
                      <Table.Td><Text size="sm" lineClamp={1} maw={320}>{b.description}</Text></Table.Td>
                      <Table.Td>{b.affectedEmployeeCount}</Table.Td>
                      <Table.Td><Badge variant="light" size="sm" color={ODPC_COLOR[b.odpc.status]}>{ODPC_LABEL[b.odpc.status]}</Badge></Table.Td>
                      <Table.Td><Badge variant="light" size="sm" color={STATUS_COLOR[b.status]}>{STATUS_LABEL[b.status]}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconShieldExclamation} title="No breach incidents logged" description="Hopefully it stays that way." />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="Log a breach incident" centered>
        <form onSubmit={createForm.onSubmit((v) => void submitCreate(v))}>
          <Stack gap="md">
            <TextInput
              label="Detected at" type="datetime-local" withAsterisk
              description="When you became aware of it — this starts the 72-hour clock"
              {...createForm.getInputProps('detectedAt')}
            />
            <Textarea label="Description" withAsterisk autosize minRows={2} {...createForm.getInputProps('description')} />
            <NumberInput
              label="Employees affected" withAsterisk min={0} allowDecimal={false}
              {...createForm.getInputProps('affectedEmployeeCount')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" color="red" loading={saving}>Log breach</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Drawer opened={!!active} onClose={() => setActive(null)} title="Breach incident" position="right" size="md">
        {active && (
          <Stack gap="lg">
            <div>
              <Text fw={600}>{active.description}</Text>
              <Text size="xs" c="sand.6" mt={4}>{active.affectedEmployeeCount} employee(s) affected</Text>
            </div>

            <Stack gap="sm">
              <ChecklistRow
                done label="Detected" detail={fmtDate(active.detectedAt)}
              />
              <ChecklistRow
                done={!!active.odpcNotifiedAt}
                label="ODPC notified"
                detail={active.odpcNotifiedAt ? fmtDate(active.odpcNotifiedAt) : `Deadline ${fmtDate(active.odpc.deadline)}`}
                action={!active.odpcNotifiedAt ? (
                  <Button
                    size="compact-sm" color="red" loading={actionBusy === 'odpc'}
                    onClick={() => void runAction('odpc', () => notifyOdpc(active.id))}
                  >
                    Mark ODPC notified
                  </Button>
                ) : undefined}
              />
              <ChecklistRow
                done={!!active.employeesNotifiedAt}
                label="Employees notified"
                detail={active.employeesNotifiedAt ? fmtDate(active.employeesNotifiedAt) : 'Not yet notified'}
                action={!active.employeesNotifiedAt ? (
                  <Button
                    size="compact-sm" variant="light" loading={actionBusy === 'employees'}
                    onClick={() => void runAction('employees', () => notifyEmployeesOfBreach(active.id))}
                  >
                    Mark employees notified
                  </Button>
                ) : undefined}
              />
              <ChecklistRow
                done={active.status === 'CONTAINED' || active.status === 'CLOSED'}
                label="Contained"
                detail={active.status === 'OPEN' ? 'Still open' : 'Contained'}
                action={active.status === 'OPEN' ? (
                  <Button
                    size="compact-sm" variant="light" color="amber" loading={actionBusy === 'contain'}
                    onClick={() => void runAction('contain', () => updateBreach(active.id, { status: 'CONTAINED' }))}
                  >
                    Mark contained
                  </Button>
                ) : undefined}
              />
              <ChecklistRow
                done={active.status === 'CLOSED'}
                label="Closed"
                detail={active.status === 'CLOSED' ? 'Closed' : 'Still active'}
                action={active.status !== 'CLOSED' ? (
                  <Button
                    size="compact-sm" variant="light" color="sand" loading={actionBusy === 'close'}
                    onClick={() => void runAction('close', () => updateBreach(active.id, { status: 'CLOSED' }))}
                  >
                    Close incident
                  </Button>
                ) : undefined}
              />
            </Stack>

            {actionError && <Text size="sm" c="red">{actionError}</Text>}
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

function ChecklistRow({ done, label, detail, action }: {
  done: boolean; label: string; detail: string; action?: React.ReactNode;
}) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={24} radius="xl" variant="light" color={done ? 'brand' : 'sand'}>
          {done ? <IconCircleCheck size={15} /> : <IconClockHour4 size={15} />}
        </ThemeIcon>
        <div>
          <Text size="sm" fw={600}>{label}</Text>
          <Text size="xs" c="sand.6">{detail}</Text>
        </div>
      </Group>
      {action}
    </Group>
  );
}
