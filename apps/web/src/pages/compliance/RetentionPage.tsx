import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Card, Group, Modal, NumberInput, Skeleton, Stack, Table, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconFolderOpen, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  deleteRetentionPolicy, listRetentionPolicies, upsertRetentionPolicy, type RetentionPolicy,
} from '../../api/compliance';
import { ApiError } from '../../api/client';
import { ErrorCard } from '../../components/ErrorCard';
import { EmptyState } from '../../components/EmptyState';
import { formatDate as fmtDate } from '../../utils/date';

interface FormValues {
  recordType: string;
  retentionPeriodMonths: number | string;
  legalBasisNote: string;
}

function yearsLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? '' : 's'}`;
  return `${months} months`;
}

export function RetentionPage() {
  const [rows, setRows] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<RetentionPolicy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RetentionPolicy | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { recordType: '', retentionPeriodMonths: '', legalBasisNote: '' },
    validate: {
      recordType: (v) => (v.trim() ? null : 'Name the record type this policy covers'),
      retentionPeriodMonths: (v) => (Number(v) >= 1 ? null : 'Enter a retention period in months'),
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listRetentionPolicies());
    } catch {
      setError('Retention policies could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const openNew = () => {
    setEditing(null);
    form.setValues({ recordType: '', retentionPeriodMonths: '', legalBasisNote: '' });
    form.resetDirty();
    setFormOpen(true);
  };

  const openEdit = (r: RetentionPolicy) => {
    setEditing(r);
    form.setValues({
      recordType: r.recordType, retentionPeriodMonths: r.retentionPeriodMonths,
      legalBasisNote: r.legalBasisNote ?? '',
    });
    form.resetDirty();
    setFormOpen(true);
  };

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      await upsertRetentionPolicy({
        recordType: values.recordType.trim(),
        retentionPeriodMonths: Number(values.retentionPeriodMonths),
        legalBasisNote: values.legalBasisNote.trim() || undefined,
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: editing ? 'Policy updated' : 'Policy created', message: '',
      });
      setFormOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not save policy',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRetentionPolicy(deleteTarget.id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Policy removed', message: '' });
      setDeleteTarget(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not remove policy',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Retention policies</Title>
          <Text c="sand.6" mt={4}>How long each record type is kept, and why.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openNew}>New policy</Button>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Record type</Table.Th>
                    <Table.Th>Retention period</Table.Th>
                    <Table.Th>Legal basis</Table.Th>
                    <Table.Th>Updated</Table.Th>
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
                  {!loading && rows.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{r.recordType}</Table.Td>
                      <Table.Td>{yearsLabel(r.retentionPeriodMonths)}</Table.Td>
                      <Table.Td><Text size="sm" c="sand.6" lineClamp={1} maw={280}>{r.legalBasisNote || '—'}</Text></Table.Td>
                      <Table.Td>{fmtDate(r.updatedAt)}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Button size="compact-sm" variant="subtle" leftSection={<IconPencil size={13} />} onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button
                            size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                            onClick={() => setDeleteTarget(r)}
                          >
                            Remove
                          </Button>
                        </Group>
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
              <Card key={r.id} withBorder p="md" radius="sm" mb="sm">
                <Group justify="space-between" mb={4}>
                  <Text fw={600} size="sm">{r.recordType}</Text>
                  <Text size="xs" c="sand.6">{yearsLabel(r.retentionPeriodMonths)}</Text>
                </Group>
                <Text size="xs" c="sand.6" lineClamp={2} mb={6}>{r.legalBasisNote || '—'}</Text>
                <Group gap={4} wrap="nowrap">
                  <Button size="compact-sm" variant="subtle" leftSection={<IconPencil size={13} />} onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Button
                    size="compact-sm" variant="subtle" color="red" leftSection={<IconTrash size={13} />}
                    onClick={() => setDeleteTarget(r)}
                  >
                    Remove
                  </Button>
                </Group>
              </Card>
            ))}
          </Stack>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconFolderOpen} title="No retention policies yet" description="Define how long each type of record is kept." actionLabel="New policy" onAction={openNew} />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit retention policy' : 'New retention policy'} centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <TextInput
              label="Record type" withAsterisk placeholder="e.g. Payslips, Contracts, CCTV footage"
              disabled={!!editing}
              description={editing ? 'The record type can’t be changed — remove and recreate the policy instead.' : undefined}
              {...form.getInputProps('recordType')}
            />
            <NumberInput
              label="Retention period (months)" withAsterisk min={1} max={1200} allowDecimal={false}
              {...form.getInputProps('retentionPeriodMonths')}
            />
            <Textarea
              label="Legal basis" autosize minRows={2}
              placeholder="Why this period (e.g. Employment Act limitation period)"
              {...form.getInputProps('legalBasisNote')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create policy'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove retention policy" centered>
        <Stack gap="md">
          <Text size="sm" c="sand.7">
            Remove the policy for <strong>{deleteTarget?.recordType}</strong>? This does not delete any records —
            only the documented retention rule for this type.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="sand" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" loading={deleting} onClick={() => void doDelete()}>Remove</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
