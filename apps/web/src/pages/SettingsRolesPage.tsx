import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Card, Checkbox, Group, Modal, Select, Stack, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconPlus, IconShieldLock, IconTrash } from '@tabler/icons-react';
import {
  createRole, deleteRole, getPermissionCatalogue, getRoleTemplates, listAdminRoles, updateRole,
  type AdminRole, type PermissionDef, type RoleTemplate,
} from '../api/users';
import type { GrantedPermission, Scope } from '../auth/permissions';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';

/**
 * Mirrors auth/permissions.ts's IMPLIES_VIEW — a UI-only convenience so
 * ticking "Approve leave" also ticks "View leave requests". The backend
 * stores exactly what's ticked here; nothing is inferred at check time there.
 */
const IMPLIES_VIEW: Readonly<Record<string, string>> = {
  'leave.approve': 'leave.view', 'leave.manage': 'leave.view',
  'overtime.approve': 'overtime.view', 'overtime.manage': 'overtime.view',
  'attendance.manage': 'attendance.view',
  'shifts.manage': 'shifts.view',
  'employees.write': 'employees.view',
  'compliance.manage': 'compliance.view',
  'payroll.run': 'payroll.view', 'payroll.manage': 'payroll.view',
};

const SCOPE_OPTIONS = [
  { value: 'ALL', label: 'Whole organisation' },
  { value: 'OWN_DEPARTMENT', label: 'Own department only' },
];

interface FormValues {
  name: string;
  permissions: GrantedPermission[];
}

export function SettingsRolesPage() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [catalogue, setCatalogue] = useState<PermissionDef[]>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
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
      const [r, c, t] = await Promise.all([listAdminRoles(), getPermissionCatalogue(), getRoleTemplates()]);
      setRoles(r);
      setCatalogue(c);
      setTemplates(t);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to manage roles.'
        : 'Roles could not load. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  /** Catalogue grouped by resource, in the order resources first appear (no separate ordering config to keep in sync). */
  const resourceGroups = useMemo(() => {
    const order: string[] = [];
    for (const p of catalogue) if (!order.includes(p.resource)) order.push(p.resource);
    return order.map((resource) => ({ resource, items: catalogue.filter((p) => p.resource === resource) }));
  }, [catalogue]);

  const openNew = () => {
    setEditing(null);
    setTemplateName(null);
    form.setValues({ name: '', permissions: [] });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (r: AdminRole) => {
    setEditing(r);
    setTemplateName(null);
    form.setValues({ name: r.name, permissions: r.permissions });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const applyTemplate = (name: string | null) => {
    setTemplateName(name);
    const tpl = templates.find((t) => t.name === name);
    if (!tpl) return;
    form.setFieldValue('permissions', tpl.permissions.map((p) => ({ ...p })));
    if (!form.values.name.trim()) form.setFieldValue('name', tpl.name);
  };

  const isChecked = (key: string) => form.values.permissions.some((p) => p.key === key);
  const scopeOf = (key: string): Scope => form.values.permissions.find((p) => p.key === key)?.scope ?? 'ALL';

  const toggleKey = (def: PermissionDef, checked: boolean) => {
    let next = form.values.permissions.filter((p) => p.key !== def.key);
    if (checked) {
      next = [...next, { key: def.key, scope: 'ALL' as Scope }];
      const impliedKey = IMPLIES_VIEW[def.key];
      if (impliedKey && !next.some((p) => p.key === impliedKey)) {
        next = [...next, { key: impliedKey, scope: 'ALL' as Scope }];
      }
    }
    form.setFieldValue('permissions', next);
  };

  const setScope = (key: string, scope: Scope) => {
    form.setFieldValue('permissions', form.values.permissions.map((p) => (p.key === key ? { ...p, scope } : p)));
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

  const summaryFor = (r: AdminRole): string => {
    if (r.permissions.length === 0) return 'No permissions granted — self-service access only.';
    return r.permissions
      .map((gp) => {
        const def = catalogue.find((p) => p.key === gp.key);
        if (!def) return null;
        return def.scopeable && gp.scope === 'OWN_DEPARTMENT' ? `${def.label} (own department)` : def.label;
      })
      .filter((s): s is string => !!s)
      .join(', ');
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
                <Text size="sm" c="sand.6" mt={4}>{summaryFor(r)}</Text>
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

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit role' : 'New role'} centered size="lg">
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            {!editing && templates.length > 0 && (
              <Select
                label="Start from a template" placeholder="Choose a job function (optional)" clearable
                data={templates.map((t) => ({ value: t.name, label: t.name }))}
                value={templateName}
                onChange={applyTemplate}
                description={templates.find((t) => t.name === templateName)?.description}
              />
            )}
            <TextInput
              label="Name" withAsterisk placeholder="Payroll Clerk"
              disabled={editing?.name === 'Admin'}
              description={editing?.name === 'Admin' ? "The Admin role can't be renamed." : undefined}
              {...form.getInputProps('name')}
            />
            <Stack gap="sm">
              <Text size="sm" fw={600}>Permissions</Text>
              {resourceGroups.map(({ resource, items }) => (
                <Card key={resource} p="md" radius="md" withBorder bg="sand.0">
                  <Text size="sm" fw={600} mb="xs">{resource}</Text>
                  <Stack gap="xs">
                    {items.map((p) => {
                      const checked = isChecked(p.key);
                      return (
                        <Group key={p.key} justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                          <Checkbox
                            checked={checked}
                            onChange={(e) => toggleKey(p, e.currentTarget.checked)}
                            label={p.label}
                            description={p.description}
                            maw={460}
                          />
                          {checked && p.scopeable && (
                            <Select
                              w={190} size="xs" allowDeselect={false}
                              data={SCOPE_OPTIONS}
                              value={scopeOf(p.key)}
                              onChange={(v) => setScope(p.key, (v as Scope) ?? 'ALL')}
                              aria-label={`Scope for ${p.label}`}
                            />
                          )}
                        </Group>
                      );
                    })}
                  </Stack>
                </Card>
              ))}
            </Stack>
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
