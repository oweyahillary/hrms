import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Button, Card, Checkbox, Group, Modal, Stack, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconPlus, IconShieldLock, IconTrash } from '@tabler/icons-react';
import {
  createRole, deleteRole, getPermissionCatalogue, listAdminRoles, updateRole,
  type AdminRole, type PermissionDef,
} from '../api/users';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';

interface FormValues {
  name: string;
  permissions: string[];
}

export function SettingsRolesPage() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalogue, setCatalogue] = useState<PermissionDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminRole | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { name: '', permissions: [] },
    validate: { name: (v) => (v.trim() ? null : 'Name is required') },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, c] = await Promise.all([listAdminRoles(), getPermissionCatalogue()]);
      setRoles(r);
      setCatalogue(c);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to manage roles.'
        : 'Roles could not load. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const openNew = () => {
    setEditing(null);
    form.setValues({ name: '', permissions: [] });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (r: AdminRole) => {
    setEditing(r);
    form.setValues({ name: r.name, permissions: r.permissions });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const submit = async (values: FormValues) => {
    setSaving(true); setFormError(null);
    try {
      if (editing) {
        await updateRole(editing.id, { name: values.name.trim(), permissions: values.permissions });
      } else {
        await createRole({ name: values.name.trim(), permissions: values.permissions });
      }
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: editing ? 'Role updated' : 'Role created', message: '',
      });
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save this role.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteRole(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Role removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not remove this role.');
    } finally {
      setDeleting(false);
    }
  };

  const deleteDisabledReason = (r: AdminRole): string | null => {
    if (r.isSeeded) return "Built-in roles can't be deleted — their permissions can still be edited.";
    if (r.userCount > 0) return `${r.userCount} user(s) still hold this role — reassign them first.`;
    return null;
  };

  return (
    <Stack gap="lg" maw={880}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Roles</Title>
          <Text c="sand.6" mt={4}>What each role can do — a custom role can be granted exactly what it needs, nothing more.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>New role</Button>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && !loading && roles.length === 0 && (
        <Card p="lg" radius="md"><EmptyState icon={IconShieldLock} title="No roles yet" /></Card>
      )}

      {!error && loading && (
        <Stack gap="sm">
          {[0, 1, 2].map((i) => <Card key={i} p="lg" radius="md" h={72} />)}
        </Stack>
      )}

      {!error && !loading && roles.map((r) => {
        const disabledReason = deleteDisabledReason(r);
        return (
          <Card key={r.id} p="lg" radius="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <div>
                <Group gap={8}>
                  <Text fw={600}>{r.name}</Text>
                  {r.isSeeded && <Badge variant="light" size="sm" color="sand">Built-in</Badge>}
                  <Badge variant="light" size="sm" color="brand">{r.userCount} user{r.userCount === 1 ? '' : 's'}</Badge>
                </Group>
                <Text size="sm" c="sand.6" mt={4}>
                  {r.permissions.length === 0
                    ? 'No permissions granted — self-service access only.'
                    : catalogue.filter((p) => r.permissions.includes(p.key)).map((p) => p.label).join(', ')}
                </Text>
              </div>
              <Group gap="xs">
                <Button size="compact-sm" variant="subtle" leftSection={<IconPencil size={13} />} onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Tooltip label={disabledReason} disabled={!disabledReason}>
                  <Button
                    size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                    disabled={!!disabledReason}
                    onClick={() => { setDeleteError(null); setDeleteTarget(r); }}
                  >
                    Delete
                  </Button>
                </Tooltip>
              </Group>
            </Group>
          </Card>
        );
      })}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit role' : 'New role'} centered size="md">
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <TextInput
              label="Name" withAsterisk placeholder="Payroll Clerk"
              disabled={editing?.name === 'Admin'}
              description={editing?.name === 'Admin' ? "The Admin role can't be renamed." : undefined}
              {...form.getInputProps('name')}
            />
            <Checkbox.Group
              label="Permissions"
              value={form.values.permissions}
              onChange={(v) => form.setFieldValue('permissions', v)}
            >
              <Stack gap="xs" mt="xs">
                {catalogue.map((p) => (
                  <Checkbox key={p.key} value={p.key} label={p.label} description={p.description} />
                ))}
              </Stack>
            </Checkbox.Group>
            {formError && <Text size="sm" c="red">{formError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create role'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete role" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Delete <strong>{deleteTarget?.name}</strong>? This can&apos;t be undone.
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
