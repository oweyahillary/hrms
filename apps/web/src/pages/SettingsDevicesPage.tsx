import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Group, Modal, Select, Skeleton, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconDeviceDesktop, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  listDevices, createDevice, updateDevice, deleteDevice, listUnmatchedPunches, resolveUnmatchedPunches,
  type AttendanceDevice, type UnmatchedPunchGroup,
} from '../api/attendance-devices';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';

interface RegisterFormValues { serialNumber: string; name: string }

function fmtDateTime(v: string | null): string {
  if (!v) return 'Never';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
}

export function SettingsDevicesPage() {
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedPunchGroup[]>([]);
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<AttendanceDevice | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AttendanceDevice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [resolving, setResolving] = useState<UnmatchedPunchGroup | null>(null);
  const [resolveEmployeeId, setResolveEmployeeId] = useState<string | null>(null);
  const [resolveSaving, setResolveSaving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    validateInputOnBlur: true,
    initialValues: { serialNumber: '', name: '' },
    validate: {
      serialNumber: (v) => (v.trim() ? null : 'Serial number is required — read it off the device (Menu > Comm > Ethernet, or the label on the unit)'),
      name: (v) => (v.trim() ? null : 'A name is required (e.g. "Main entrance")'),
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [devs, unmatchedGroups, emps] = await Promise.all([
        listDevices(),
        listUnmatchedPunches(),
        listEmployees({ pageSize: 200, sort: 'name', order: 'asc' }),
      ]);
      setDevices(devs);
      setUnmatched(unmatchedGroups);
      setEmployees(emps.data);
    } catch {
      setError('Devices could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const employeeOptions = employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeNumber})` }));

  const openRegister = () => {
    form.setValues({ serialNumber: '', name: '' });
    form.resetDirty();
    setRegisterError(null);
    setRegisterOpen(true);
  };

  const submitRegister = async (values: RegisterFormValues) => {
    setRegistering(true); setRegisterError(null);
    try {
      await createDevice({ serialNumber: values.serialNumber.trim(), name: values.name.trim() });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Device registered', message: '' });
      setRegisterOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRegisterError(e instanceof ApiError ? e.message : 'Could not register this device.');
    } finally {
      setRegistering(false);
    }
  };

  const openRename = (d: AttendanceDevice) => {
    setRenaming(d);
    setRenameValue(d.name);
    setRenameError(null);
  };

  const submitRename = async () => {
    if (!renaming) return;
    setRenameSaving(true); setRenameError(null);
    try {
      await updateDevice(renaming.id, { name: renameValue.trim() });
      setRenaming(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRenameError(e instanceof ApiError ? e.message : 'Could not rename this device.');
    } finally {
      setRenameSaving(false);
    }
  };

  const toggleActive = async (d: AttendanceDevice) => {
    setTogglingId(d.id);
    try {
      await updateDevice(d.id, { active: !d.active });
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
      await deleteDevice(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Device removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not remove this device.');
    } finally {
      setDeleting(false);
    }
  };

  const openResolve = (g: UnmatchedPunchGroup) => {
    setResolving(g);
    setResolveEmployeeId(null);
    setResolveError(null);
  };

  const submitResolve = async () => {
    if (!resolving || !resolveEmployeeId) return;
    setResolveSaving(true); setResolveError(null);
    try {
      const result = await resolveUnmatchedPunches(resolving.devicePin, resolveEmployeeId);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Punches resolved', message: `${result.resolved} punch(es) matched and materialized into attendance.`,
      });
      setResolving(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setResolveError(e instanceof ApiError ? e.message : 'Could not resolve this pin.');
    } finally {
      setResolveSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={960}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Devices</Title>
          <Text c="sand.6" mt={4}>
            Biometric attendance devices pushing over the network — no wiring here, just the registry that
            gates which serial numbers are trusted.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openRegister}>Register device</Button>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Serial number</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Last seen</Table.Th>
                    <Table.Th />
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
                  {!loading && devices.map((d) => (
                    <Table.Tr key={d.id}>
                      <Table.Td><Text size="sm" fw={500}>{d.name}</Text></Table.Td>
                      <Table.Td><Text size="sm" ff="monospace">{d.serialNumber}</Text></Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={d.active ? 'brand' : 'sand'}>
                          {d.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Table.Td>
                      <Table.Td><Text size="sm" c="sand.6">{fmtDateTime(d.lastSeenAt)}</Text></Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button size="compact-sm" variant="subtle" onClick={() => openRename(d)}>Rename</Button>
                          <Button
                            size="compact-sm" variant="subtle" color={d.active ? 'sand' : 'brand'}
                            loading={togglingId === d.id} onClick={() => void toggleActive(d)}
                          >
                            {d.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                            onClick={() => { setDeleteError(null); setDeleteTarget(d); }}
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

          {!loading && devices.length === 0 && (
            <Box p="md">
              <EmptyState
                icon={IconDeviceDesktop} title="No devices registered yet"
                description="Register a device's serial number to let it push attendance."
                actionLabel="Register device" onAction={openRegister}
              />
            </Box>
          )}
        </Card>
      )}

      {!error && unmatched.length > 0 && (
        <Card p={0} radius="md">
          <Box p="md" pb={0}>
            <Text fw={600}>Unmatched punches</Text>
            <Text size="sm" c="sand.6" mb="sm">
              Punches from a recognized device with a PIN that doesn&apos;t match any employee number yet —
              resolve to backfill and materialize them into attendance.
            </Text>
          </Box>
          <Box style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Device</Table.Th>
                    <Table.Th>Pin</Table.Th>
                    <Table.Th>Punches</Table.Th>
                    <Table.Th>First seen</Table.Th>
                    <Table.Th>Last seen</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {unmatched.map((g) => (
                    <Table.Tr key={`${g.deviceId}::${g.devicePin}`}>
                      <Table.Td>{g.deviceName}</Table.Td>
                      <Table.Td><Text ff="monospace" size="sm">{g.devicePin}</Text></Table.Td>
                      <Table.Td>{g.count}</Table.Td>
                      <Table.Td><Text size="sm" c="sand.6">{fmtDateTime(g.firstPunchedAt)}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="sand.6">{fmtDateTime(g.lastPunchedAt)}</Text></Table.Td>
                      <Table.Td>
                        <Button size="compact-sm" variant="light" onClick={() => openResolve(g)}>Resolve</Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>
        </Card>
      )}

      <Modal opened={registerOpen} onClose={() => setRegisterOpen(false)} title="Register device" centered>
        <form onSubmit={form.onSubmit((v) => void submitRegister(v))}>
          <Stack gap="md">
            <TextInput
              label="Serial number" withAsterisk placeholder="ABC1234567890"
              description="Must exactly match the device's own SN — this is the only thing that identifies it."
              {...form.getInputProps('serialNumber')}
            />
            <TextInput label="Name" withAsterisk placeholder="Main entrance" {...form.getInputProps('name')} />
            {registerError && <Text size="sm" c="red">{registerError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRegisterOpen(false)}>Cancel</Button>
              <Button type="submit" loading={registering}>Register</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!renaming} onClose={() => setRenaming(null)} title="Rename device" centered>
        <Stack gap="md">
          <TextInput label="Name" value={renameValue} onChange={(e) => setRenameValue(e.currentTarget.value)} />
          {renameError && <Text size="sm" c="red">{renameError}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button loading={renameSaving} onClick={() => void submitRename()}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete device" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Delete <strong>{deleteTarget?.name}</strong>? This only works if it has no punches on record —
            otherwise deactivate it instead, so its history stays intact.
          </Text>
          {deleteError && <Text size="sm" c="red">{deleteError}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" loading={deleting} onClick={() => void doDelete()}>Delete</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!resolving} onClose={() => setResolving(null)} title="Resolve unmatched pin" centered>
        {resolving && (
          <Stack gap="md">
            <Text size="sm" c="sand.6">
              Pin <strong>{resolving.devicePin}</strong> on {resolving.deviceName} — {resolving.count} punch(es).
              Picking an employee backfills every punch under this pin and re-derives their attendance.
            </Text>
            <Select
              label="Employee" withAsterisk searchable placeholder="Search by name or employee number"
              data={employeeOptions} value={resolveEmployeeId} onChange={setResolveEmployeeId}
            />
            {resolveError && <Text size="sm" c="red">{resolveError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setResolving(null)}>Cancel</Button>
              <Button loading={resolveSaving} disabled={!resolveEmployeeId} onClick={() => void submitResolve()}>
                Resolve
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
