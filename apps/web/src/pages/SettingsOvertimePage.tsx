import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Checkbox, Group, Modal, NumberInput, Select, Skeleton, Stack, Table,
  Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  listOvertimePolicies, createOvertimePolicy, updateOvertimePolicy, deleteOvertimePolicy,
  OVERTIME_HOURLY_RATE_BASES, type OvertimePolicy, type OvertimeHourlyRateBasis,
} from '../api/overtime';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { formatDate } from '../utils/date';

const BASIS_LABEL: Record<OvertimeHourlyRateBasis, string> = {
  MONTHLY_X12_DIV_52_WEEKLY_HOURS: 'Monthly × 12 ÷ 52 weeks ÷ weekly hours',
  MONTHLY_DIV_26_DIV_8: 'Monthly ÷ 26 days ÷ 8 hours',
};

interface FormValues {
  effectiveFrom: string;
  normalDayMultiplier: number | string;
  restDayMultiplier: number | string;
  holidayMultiplier: number | string;
  hourlyRateBasis: OvertimeHourlyRateBasis;
  normalWeeklyHours: number | string;
  minimumMinutesToCount: number | string;
  maxHoursPerDay: number | string;
  requiresApproval: boolean;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

const DEFAULTS: FormValues = {
  effectiveFrom: todayIso(), normalDayMultiplier: 1.5, restDayMultiplier: 2, holidayMultiplier: 2,
  hourlyRateBasis: 'MONTHLY_X12_DIV_52_WEEKLY_HOURS', normalWeeklyHours: 45,
  minimumMinutesToCount: 30, maxHoursPerDay: '', requiresApproval: true,
};

export function SettingsOvertimePage() {
  const [rows, setRows] = useState<OvertimePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<OvertimePolicy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OvertimePolicy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const form = useForm<FormValues>({ validateInputOnBlur: true, initialValues: DEFAULTS });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listOvertimePolicies());
    } catch {
      setError('Overtime policies could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const isEditable = (p: OvertimePolicy): boolean => new Date(p.effectiveFrom).getTime() > Date.now();

  const openNew = () => {
    setEditing(null);
    const latest = rows[0]; // list is ordered effectiveFrom desc
    form.setValues(latest
      ? {
          effectiveFrom: todayIso(), normalDayMultiplier: latest.normalDayMultiplier, restDayMultiplier: latest.restDayMultiplier,
          holidayMultiplier: latest.holidayMultiplier, hourlyRateBasis: latest.hourlyRateBasis, normalWeeklyHours: latest.normalWeeklyHours,
          minimumMinutesToCount: latest.minimumMinutesToCount, maxHoursPerDay: latest.maxHoursPerDay ?? '', requiresApproval: latest.requiresApproval,
        }
      : DEFAULTS);
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (p: OvertimePolicy) => {
    setEditing(p);
    form.setValues({
      effectiveFrom: p.effectiveFrom.slice(0, 10), normalDayMultiplier: p.normalDayMultiplier, restDayMultiplier: p.restDayMultiplier,
      holidayMultiplier: p.holidayMultiplier, hourlyRateBasis: p.hourlyRateBasis, normalWeeklyHours: p.normalWeeklyHours,
      minimumMinutesToCount: p.minimumMinutesToCount, maxHoursPerDay: p.maxHoursPerDay ?? '', requiresApproval: p.requiresApproval,
    });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async (values: FormValues) => {
    setSaving(true); setFormError(null);
    const payload = {
      effectiveFrom: values.effectiveFrom,
      normalDayMultiplier: Number(values.normalDayMultiplier),
      restDayMultiplier: Number(values.restDayMultiplier),
      holidayMultiplier: Number(values.holidayMultiplier),
      hourlyRateBasis: values.hourlyRateBasis,
      normalWeeklyHours: Number(values.normalWeeklyHours),
      minimumMinutesToCount: Number(values.minimumMinutesToCount),
      maxHoursPerDay: values.maxHoursPerDay === '' ? null : Number(values.maxHoursPerDay),
      requiresApproval: values.requiresApproval,
    };
    try {
      if (editing) await updateOvertimePolicy(editing.id!, payload);
      else await createOvertimePolicy(payload);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: editing ? 'Version updated' : 'Version created', message: '' });
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save this policy version.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteOvertimePolicy(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Version removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not remove this version.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack gap="lg" maw={960}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Overtime policy</Title>
          <Text c="sand.6" mt={4}>
            Multipliers, hourly-rate basis and approval rules — effective-dated, like statutory rates. A version already
            in force is immutable; add a new one to change it going forward.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>New version</Button>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={800}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Effective from</Table.Th>
                    <Table.Th>Normal / rest / holiday</Table.Th>
                    <Table.Th>Basis</Table.Th>
                    <Table.Th>Minimum</Table.Th>
                    <Table.Th>Cap</Table.Th>
                    <Table.Th>Approval</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 2 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && rows.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {formatDate(p.effectiveFrom)}
                          {!isEditable(p) && <Badge variant="light" size="xs" color="brand">In force</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td>{p.normalDayMultiplier}× / {p.restDayMultiplier}× / {p.holidayMultiplier}×</Table.Td>
                      <Table.Td><Text size="xs" c="sand.6">{BASIS_LABEL[p.hourlyRateBasis]}</Text></Table.Td>
                      <Table.Td>{p.minimumMinutesToCount}min</Table.Td>
                      <Table.Td>{p.maxHoursPerDay === null ? '—' : `${p.maxHoursPerDay}h`}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={p.requiresApproval ? 'amber' : 'brand'}>
                          {p.requiresApproval ? 'Required' : 'Auto'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {isEditable(p) && (
                          <Group gap={4} wrap="nowrap" justify="flex-end">
                            <Button size="compact-sm" variant="subtle" onClick={() => openEdit(p)}>Edit</Button>
                            <Button
                              size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                              onClick={() => { setDeleteError(null); setDeleteTarget(p); }}
                            >
                              Remove
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

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconPlus} title="No overtime policy configured yet" description="Reasonable defaults apply until you set one." actionLabel="New version" onAction={openNew} />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit policy version' : 'New policy version'} centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <TextInput label="Effective from" type="date" withAsterisk {...form.getInputProps('effectiveFrom')} />
            <Group grow>
              <NumberInput label="Normal day ×" min={1} max={10} step={0.1} decimalScale={2} {...form.getInputProps('normalDayMultiplier')} />
              <NumberInput label="Rest day ×" min={1} max={10} step={0.1} decimalScale={2} {...form.getInputProps('restDayMultiplier')} />
              <NumberInput label="Holiday ×" min={1} max={10} step={0.1} decimalScale={2} {...form.getInputProps('holidayMultiplier')} />
            </Group>
            <Select
              label="Hourly rate basis" allowDeselect={false}
              data={OVERTIME_HOURLY_RATE_BASES.map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
              value={form.values.hourlyRateBasis}
              onChange={(v) => form.setFieldValue('hourlyRateBasis', (v as OvertimeHourlyRateBasis) ?? 'MONTHLY_X12_DIV_52_WEEKLY_HOURS')}
            />
            <NumberInput
              label="Normal weekly hours" description="Only used by the monthly × 12 ÷ 52 basis" min={1} max={84}
              {...form.getInputProps('normalWeeklyHours')}
            />
            <Group grow>
              <NumberInput label="Minimum minutes to count" min={0} max={180} {...form.getInputProps('minimumMinutesToCount')} />
              <NumberInput label="Daily cap (hours)" description="Blank = uncapped" min={0} max={24} step={0.5} decimalScale={2} {...form.getInputProps('maxHoursPerDay')} />
            </Group>
            <Checkbox
              label="Requires approval" description="Off: derived and manual entries are auto-approved"
              {...form.getInputProps('requiresApproval', { type: 'checkbox' })}
            />
            {formError && <Text size="sm" c="red">{formError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create version'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove policy version" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Remove the version effective {deleteTarget ? formatDate(deleteTarget.effectiveFrom) : ''}? This only works
            while it isn&apos;t yet in force.
          </Text>
          {deleteError && <Text size="sm" c="red">{deleteError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" loading={deleting} onClick={() => void doDelete()}>Remove</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
