import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Badge, Button, Card, Group, Modal, Select, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPlus } from '@tabler/icons-react';
import {
  listUsers, listRoles, updateUser, type UserRow, type RoleOption,
} from '../api/users';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';

const STATUS_FILTERS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

function fmtLastLogin(v: string | null): string {
  if (!v) return 'Never';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
}

export function UsersPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [isActive, setIsActive] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deactivate confirm + change-role modals, each driven by the targeted user.
  const [confirmUser, setConfirmUser] = useState<UserRow | null>(null);
  const [roleUser, setRoleUser] = useState<UserRow | null>(null);
  const [newRoleId, setNewRoleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listRoles().then(setRoles).catch(() => { /* role filter/picker just stays empty */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listUsers({
        isActive: isActive === null ? undefined : isActive === 'true',
        roleId: roleId ?? undefined,
      }));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to manage users.'
        : 'Could not load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isActive, roleId]);

  useEffect(() => { void load(); }, [load]);

  const setActive = async (u: UserRow, active: boolean) => {
    setBusy(true);
    try {
      await updateUser(u.id, { isActive: active });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: active ? 'User reactivated' : 'User deactivated',
        message: active ? `${u.displayName} can log in again.` : `${u.displayName} can no longer log in.`,
      });
      setConfirmUser(null);
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not update user',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  const saveRole = async () => {
    if (!roleUser || !newRoleId) return;
    setBusy(true);
    try {
      await updateUser(roleUser.id, { roleId: newRoleId });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Role changed', message: `${roleUser.displayName}\u2019s role was updated.` });
      setRoleUser(null);
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not change role',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Users</Title>
          <Text c="sand.6" size="sm" mt={2}>
            Logins for this organisation. Invite a user to generate a temporary password for them.
          </Text>
        </div>
        <Button component={RouterLink} to="/settings/users/new" leftSection={<IconPlus size={16} />}>
          Invite user
        </Button>
      </Group>

      <Group>
        <Select
          label="Status" placeholder="All" clearable data={STATUS_FILTERS}
          value={isActive} onChange={setIsActive} w={160}
        />
        <Select
          label="Role" placeholder="All roles" clearable searchable
          data={roles.map((r) => ({ value: r.id, label: r.name }))}
          value={roleId} onChange={setRoleId} w={220}
        />
      </Group>

      {error && <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />}

      {!error && <Card p={0} radius="md" withBorder>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name / email</Table.Th>
              <Table.Th visibleFrom="sm">Role</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th visibleFrom="md">Last login</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && [0, 1, 2, 3].map((i) => (
              <Table.Tr key={i}>
                {(['', 'sm', '', 'md', ''] as const).map((vf, j) => (<Table.Td key={j} visibleFrom={vf || undefined}><Skeleton height={14} /></Table.Td>))}
              </Table.Tr>
            ))}
            {!loading && rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}><Text ta="center" c="sand.6" py="lg">No users match these filters.</Text></Table.Td>
              </Table.Tr>
            )}
            {!loading && rows.map((u) => {
              const isSelf = u.id === user?.id;
              return (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Text fw={500}>{u.displayName}{isSelf && <Text span c="sand.6" size="xs"> (you)</Text>}</Text>
                    {u.displayName !== u.email && <Text size="xs" c="sand.6">{u.email}</Text>}
                  </Table.Td>
                  <Table.Td visibleFrom="sm"><Badge variant="light" color="brand">{u.roleName ?? '\u2014'}</Badge></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={u.isActive ? 'brand' : 'red'}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </Table.Td>
                  <Table.Td visibleFrom="md"><Text size="sm" c="sand.6">{fmtLastLogin(u.lastLoginAt)}</Text></Table.Td>
                  <Table.Td ta="right">
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button
                        size="xs" variant="subtle"
                        onClick={() => { setRoleUser(u); setNewRoleId(u.roleId); }}
                      >
                        Change role
                      </Button>
                      {u.isActive ? (
                        <Button
                          size="xs" variant="subtle" color="red"
                          disabled={isSelf} onClick={() => setConfirmUser(u)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button size="xs" variant="subtle" onClick={() => void setActive(u, true)}>
                          Reactivate
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>}

      {/* Deactivate needs a confirm — it blocks the person's login. */}
      <Modal opened={!!confirmUser} onClose={() => setConfirmUser(null)} title="Deactivate user" centered>
        <Stack gap="md">
          <Text size="sm">
            Deactivate <b>{confirmUser?.displayName}</b>? They will no longer be able to log in. You can reactivate them later.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmUser(null)}>Cancel</Button>
            <Button color="red" loading={busy} onClick={() => confirmUser && void setActive(confirmUser, false)}>Deactivate</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={!!roleUser} onClose={() => setRoleUser(null)} title="Change role" centered>
        <Stack gap="md">
          <Text size="sm">Role for <b>{roleUser?.displayName}</b>:</Text>
          <Select
            data={roles.map((r) => ({ value: r.id, label: r.name }))}
            value={newRoleId} onChange={setNewRoleId} allowDeselect={false} searchable
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRoleUser(null)}>Cancel</Button>
            <Button loading={busy} disabled={!newRoleId || newRoleId === roleUser?.roleId} onClick={() => void saveRole()}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
