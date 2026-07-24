import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Checkbox, Group, Modal, NumberInput, Skeleton, Stack, Switch, Table,
  Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconMoon, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  createShiftDefinition, deleteShiftDefinition, listShiftDefinitions, updateShiftDefinition,
  type ShiftDefinition,
} from '../api/shifts';
import { getAttendanceSettings, updateAttendanceSettings } from '../api/organization';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { shiftColor } from '../utils/shift-color';

interface FormValues {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  isNightShift: boolean;
  breakMinutes: number | string;
}

export function SettingsShiftsPage() {
  const [rows, setRows] = useState<ShiftDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<ShiftDefinition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [graceMinutes, setGraceMinutes] = useState<number | string>('');
  const [graceLoaded, setGraceLoaded] = useState(false);
  const [graceSaving, setGraceSaving] = useState(false);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: {
      code: '', name: '', startTime: '', endTime: '',
      crossesMidnight: false, isNightShift: false, breakMinutes: 0,
    },
    validate: {
      code: (v) => (v.trim() ? null : 'A short code is required (e.g. M, A, N)'),
      name: (v) => (v.trim() ? null : 'Name is required'),
      startTime: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'Use HH:MM (24-hour)'),
      endTime: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'Use HH:MM (24-hour)'),
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listShiftDefinitions(true));
    } catch {
      setError('Shift definitions could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  useEffect(() => {
    void getAttendanceSettings()
      .then((s) => { setGraceMinutes(s.lateGraceMinutes); setGraceLoaded(true); })
      .catch(() => setGraceLoaded(true));
  }, []);

  const saveGrace = async () => {
    setGraceSaving(true);
    try {
      const saved = await updateAttendanceSettings({ lateGraceMinutes: Number(graceMinutes) });
      setGraceMinutes(saved.lateGraceMinutes);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Grace period saved', message: '' });
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not save', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setGraceSaving(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    form.setValues({ code: '', name: '', startTime: '', endTime: '', crossesMidnight: false, isNightShift: false, breakMinutes: 0 });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (s: ShiftDefinition) => {
    setEditing(s);
    form.setValues({
      code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime,
      crossesMidnight: s.crossesMidnight, isNightShift: s.isNightShift, breakMinutes: s.breakMinutes,
    });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async (values: FormValues) => {
    setSaving(true); setFormError(null);
    try {
      if (editing) {
        await updateShiftDefinition(editing.id, {
          name: values.name.trim(), startTime: values.startTime, endTime: values.endTime,
          crossesMidnight: values.crossesMidnight, isNightShift: values.isNightShift,
          breakMinutes: Number(values.breakMinutes) || 0,
        });
      } else {
        await createShiftDefinition({
          code: values.code.trim().toUpperCase(), name: values.name.trim(),
          startTime: values.startTime, endTime: values.endTime,
          crossesMidnight: values.crossesMidnight, isNightShift: values.isNightShift,
          breakMinutes: Number(values.breakMinutes) || 0,
        });
      }
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: editing ? 'Shift updated' : 'Shift created', message: '',
      });
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save this shift.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: ShiftDefinition) => {
    setTogglingId(s.id);
    try {
      await updateShiftDefinition(s.id, { active: !s.active });
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not update', message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setTogglingId(null);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteShiftDefinition(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Shift removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not remove this shift.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack gap="lg" maw={960}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Shift definitions</Title>
          <Text c="sand.6" mt={4}>The shift patterns available for the roster — codes, hours and breaks.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>New shift</Button>
      </Group>

      <Card p="lg" radius="md">
        <Text fw={600} mb={4}>Late grace period</Text>
        <Text size="sm" c="sand.6" mb="md">
          Minutes after a shift&apos;s scheduled start before a clock-in counts as late rather than present.
        </Text>
        <Group align="flex-end">
          <NumberInput
            label="Grace minutes" min={0} max={180} allowDecimal={false} w={160}
            disabled={!graceLoaded}
            value={graceMinutes} onChange={setGraceMinutes}
          />
          <Button loading={graceSaving} disabled={!graceLoaded} onClick={() => void saveGrace()}>Save</Button>
        </Group>
      </Card>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Code</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Hours</Table.Th>
                    <Table.Th>Break</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 4 }).map((_, i) => (
                    <Table.Tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <Table.Td key={j}><Skeleton h={14} radius="sm" /></Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                  {!loading && rows.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td><Badge variant="light" color={shiftColor(s.code)}>{s.code}</Badge></Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {s.name}
                          {s.isNightShift && <IconMoon size={14} color="var(--mantine-color-sand-5)" />}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {s.startTime}–{s.endTime}{s.crossesMidnight ? ' (+1d)' : ''}
                      </Table.Td>
                      <Table.Td>{s.breakMinutes} min</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={s.active ? 'brand' : 'sand'}>
                          {s.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button size="compact-sm" variant="subtle" leftSection={<IconPencil size={13} />} onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button
                            size="compact-sm" variant="subtle" color={s.active ? 'sand' : 'brand'}
                            loading={togglingId === s.id} onClick={() => void toggleActive(s)}
                          >
                            {s.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                            onClick={() => { setDeleteError(null); setDeleteTarget(s); }}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconPlus} title="No shift definitions yet" description="Create the first shift pattern for the roster." actionLabel="New shift" onAction={openNew} />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit shift' : 'New shift'} centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <Group grow>
              <TextInput
                label="Code" withAsterisk placeholder="M" maxLength={10}
                disabled={!!editing}
                description={editing ? 'Immutable once created — rosters and imports reference it.' : undefined}
                {...form.getInputProps('code')}
              />
              <TextInput label="Name" withAsterisk placeholder="Morning" {...form.getInputProps('name')} />
            </Group>
            <Group grow>
              <TextInput label="Start time" type="time" withAsterisk {...form.getInputProps('startTime')} />
              <TextInput label="End time" type="time" withAsterisk {...form.getInputProps('endTime')} />
            </Group>
            <NumberInput
              label="Break (minutes)" min={0} max={480} allowDecimal={false}
              {...form.getInputProps('breakMinutes')}
            />
            <Checkbox
              label="Crosses midnight" description="The shift ends the day after it starts"
              {...form.getInputProps('crossesMidnight', { type: 'checkbox' })}
            />
            <Switch
              label="Night shift" description="Cosmetic flag shown on the roster — independent of crosses midnight"
              {...form.getInputProps('isNightShift', { type: 'checkbox' })}
            />
            {formError && <Text size="sm" c="red">{formError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create shift'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete shift" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Delete <strong>{deleteTarget?.code} · {deleteTarget?.name}</strong>? This only works if no roster
            entries reference it — otherwise deactivate it instead.
          </Text>
          {deleteError && <Text size="sm" c="red">{deleteError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" loading={deleting} onClick={() => void doDelete()}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
