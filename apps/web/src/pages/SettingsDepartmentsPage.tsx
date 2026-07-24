import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Group, Modal, Select, Skeleton, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPencil, IconPlus, IconSitemap, IconTrash } from '@tabler/icons-react';
import {
  createDepartment, deleteDepartment, descendantIds, flattenDepartmentTree, listDepartmentsAdmin, updateDepartment,
  type AdminDepartment, type DepartmentTreeNode,
} from '../api/departments';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';

interface FormValues {
  name: string;
  parentDepartmentId: string;
  headEmployeeId: string;
}

const EMPTY_VALUES: FormValues = { name: '', parentDepartmentId: '', headEmployeeId: '' };

export function SettingsDepartmentsPage() {
  const [tree, setTree] = useState<DepartmentTreeNode[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<AdminDepartment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminDepartment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: EMPTY_VALUES,
    validate: { name: (v) => (v.trim() ? null : 'Name is required') },
  });

  const employeeName = useCallback(
    (id: string | null) => (id ? employees.find((e) => e.value === id)?.label ?? '—' : '—'),
    [employees],
  );

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Independent of the tree itself: employees are only used for the
      // "head" picker (employeeName() already falls back to '—' for an id
      // it doesn't have), so a role with org_structure.manage but not
      // employees.view still sees the department tree.
      const [rows, emps] = await Promise.all([
        listDepartmentsAdmin(true),
        loadEmployeeOptions().catch(() => [] as EmployeeOption[]),
      ]);
      setTree(flattenDepartmentTree(rows));
      setEmployees(emps);
    } catch {
      setError('Departments could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const openNew = () => {
    setEditing(null);
    form.setValues(EMPTY_VALUES);
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (d: AdminDepartment) => {
    setEditing(d);
    form.setValues({
      name: d.name,
      parentDepartmentId: d.parentDepartmentId ?? '',
      headEmployeeId: d.headEmployeeId ?? '',
    });
    form.resetDirty();
    setFormError(null);
    setFormOpen(true);
  };

  // Can't move a department under itself or one of its own descendants.
  const parentOptions = tree
    .filter((d) => !editing || (d.id !== editing.id && !descendantIds(tree, editing.id).has(d.id)))
    .map((d) => ({ value: d.id, label: '—'.repeat(d.depth) + (d.depth ? ' ' : '') + d.name }));

  const submit = async (values: FormValues) => {
    setSaving(true); setFormError(null);
    try {
      if (editing) {
        await updateDepartment(editing.id, {
          name: values.name.trim(),
          parentDepartmentId: values.parentDepartmentId || null,
          headEmployeeId: values.headEmployeeId || null,
        });
      } else {
        await createDepartment({
          name: values.name.trim(),
          parentDepartmentId: values.parentDepartmentId || undefined,
          headEmployeeId: values.headEmployeeId || null,
        });
      }
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: editing ? 'Department updated' : 'Department created', message: '',
      });
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save this department.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (d: AdminDepartment) => {
    setTogglingId(d.id);
    try {
      await updateDepartment(d.id, { active: !d.active });
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
      await deleteDepartment(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Department removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not remove this department.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack gap="lg" maw={960}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Departments</Title>
          <Text c="sand.6" mt={4}>Your organisation&apos;s structure — create sub-departments and assign heads.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>New department</Button>
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
                    <Table.Th>Head</Table.Th>
                    <Table.Th>Employees</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th />
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
                  {!loading && tree.map((d) => (
                    <Table.Tr key={d.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap" pl={d.depth * 20}>
                          {d.depth > 0 && <IconSitemap size={13} color="var(--mantine-color-sand-4)" />}
                          <Text fw={500}>{d.name}</Text>
                        </Group>
                      </Table.Td>
                      <Table.Td><Text size="sm" c="sand.6">{employeeName(d.headEmployeeId)}</Text></Table.Td>
                      <Table.Td>{d.employeeCount}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={d.active ? 'brand' : 'sand'}>
                          {d.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button size="compact-sm" variant="subtle" leftSection={<IconPencil size={13} />} onClick={() => openEdit(d)}>
                            Edit
                          </Button>
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

          {!loading && tree.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconSitemap} title="No departments yet" description="Create the first department in your structure." actionLabel="New department" onAction={openNew} />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit department' : 'New department'} centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <TextInput label="Name" withAsterisk placeholder="Finance" {...form.getInputProps('name')} />
            <Select
              label="Parent department" placeholder="None — top level" clearable searchable
              data={parentOptions}
              {...form.getInputProps('parentDepartmentId')}
            />
            <Select
              label="Head" description="Approves this department's leave requests" placeholder="None" clearable searchable
              data={employees}
              {...form.getInputProps('headEmployeeId')}
            />
            {formError && <Text size="sm" c="red">{formError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create department'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete department" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Delete <strong>{deleteTarget?.name}</strong>? This only works if no employees are assigned to it and
            it has no sub-departments — otherwise deactivate it instead.
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
