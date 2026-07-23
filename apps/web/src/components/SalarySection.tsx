import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Group, Modal, NumberInput, Select, SimpleGrid, Skeleton, Stack, Table,
  Text, Textarea, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPlus, IconReportMoney } from '@tabler/icons-react';
import {
  getEffectiveSalaryStructure, listSalaryStructures, createSalaryStructure, type SalaryStructure,
} from '../api/salary';
import { loadUserOptions, type UserOption } from '../api/users';
import { ApiError } from '../api/client';
import { kes } from '../utils/money';

interface FormValues {
  basicSalary: number | string;
  effectiveDate: string;
  reason: string;
  approvedById: string;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="sand.6" tt="uppercase" fw={600} style={{ letterSpacing: '0.04em' }}>{label}</Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

export function SalarySection({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const [effective, setEffective] = useState<SalaryStructure | null>(null);
  const [history, setHistory] = useState<SalaryStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { basicSalary: '', effectiveDate: new Date().toISOString().slice(0, 10), reason: '', approvedById: '' },
    validate: {
      basicSalary: (v) => (Number(v) > 0 ? null : 'Enter the new basic salary'),
      effectiveDate: (v) => (v ? null : 'Pick an effective date'),
      reason: (v) => (v.trim() ? null : 'A reason is required'),
    },
  });

  useEffect(() => {
    void loadUserOptions().then(setUsers).catch(() => { /* approver picker just stays empty */ });
  }, []);

  const approverName = (id: string | null): string =>
    id ? (users.find((u) => u.value === id)?.label ?? 'Recorded') : '\u2014';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [eff, hist] = await Promise.all([
        getEffectiveSalaryStructure(employeeId),
        listSalaryStructures(employeeId),
      ]);
      setEffective(eff.structure);
      setHistory(hist);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view salary details.'
        : 'Could not load salary information.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  const currentBasic = effective?.basicSalary ?? null;
  // Live delta vs the current basic, recomputed as the field changes.
  const delta = useMemo(() => {
    if (currentBasic == null || currentBasic === 0 || form.values.basicSalary === '') return null;
    const amount = (Number(form.values.basicSalary) || 0) - currentBasic;
    return { amount, pct: (amount / currentBasic) * 100 };
  }, [currentBasic, form.values.basicSalary]);

  const openModal = () => {
    form.setValues({
      basicSalary: currentBasic ?? '',
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: '',
      approvedById: '',
    });
    form.resetDirty();
    setOpen(true);
  };

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      // approvedById is optional and deliberately NOT defaulted to the current
      // user — self-approval is meaningless. It's sent only when the admin picks
      // a distinct approver from the user directory (GET /users).
      await createSalaryStructure(employeeId, {
        basicSalary: Number(values.basicSalary),
        effectiveDate: values.effectiveDate,
        reason: values.reason.trim(),
        approvedById: values.approvedById || undefined,
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Salary revision saved',
        message: 'The new structure is now the effective one.',
      });
      setOpen(false); form.reset();
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not save revision',
        message: e instanceof ApiError ? e.message : 'Something went wrong saving the revision.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card p="lg" radius="md">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs">
          <ThemeIcon size={28} radius="md" variant="light" color="brand">
            <IconReportMoney size={16} stroke={1.7} />
          </ThemeIcon>
          <Title order={3}>Salary</Title>
        </Group>
        {canEdit && (
          <Button size="compact-sm" leftSection={<IconPlus size={14} />} onClick={openModal} disabled={loading}>
            New revision
          </Button>
        )}
      </Group>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="md">{error}</Alert>}

      {loading && <Skeleton h={90} radius="sm" />}

      {!loading && !error && (
        <>
          {effective ? (
            <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg">
              <Stat label="Basic salary" value={kes(effective.basicSalary)} />
              <Stat label="Allowances" value={kes(effective.derived.allowancesTotal)} />
              <Stat label="Gross" value={kes(effective.derived.gross)} />
              <Stat label="Effective since" value={effective.effectiveDate} />
            </SimpleGrid>
          ) : (
            <Text c="sand.6" mb="lg">
              No salary structure on record yet.{canEdit ? ' Add the first revision to set one.' : ''}
            </Text>
          )}

          <Text size="xs" c="sand.6" tt="uppercase" fw={600} mb="xs" style={{ letterSpacing: '0.04em' }}>
            Revision history
          </Text>
          {history.length === 0 ? (
            <Text c="sand.6" size="sm">No revisions recorded.</Text>
          ) : (
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Effective date</Table.Th>
                  <Table.Th ta="right">Basic salary</Table.Th>
                  <Table.Th>Reason</Table.Th>
                  <Table.Th>Approved by</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((s) => (
                  <Table.Tr key={s.id}>
                    <Table.Td>{s.effectiveDate}</Table.Td>
                    <Table.Td ta="right">{kes(s.basicSalary)}</Table.Td>
                    <Table.Td><Text size="sm">{s.reason || '\u2014'}</Text></Table.Td>
                    <Table.Td><Text size="sm" c="sand.6">{approverName(s.approvedById)}</Text></Table.Td>
                    <Table.Td>
                      {effective && s.id === effective.id && <Badge color="brand" variant="light">Current</Badge>}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}

      <Modal opened={open} onClose={() => setOpen(false)} title="New salary revision" centered>
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Stack gap="md">
            <NumberInput
              label="Basic salary (KES)" withAsterisk min={1} thousandSeparator=","
              {...form.getInputProps('basicSalary')}
            />
            {delta && (
              <Text size="sm" c={delta.amount > 0 ? 'teal' : delta.amount < 0 ? 'red' : 'sand.6'}>
                {delta.amount === 0
                  ? 'No change from the current basic salary.'
                  : `${delta.amount > 0 ? '+' : '-'}${kes(Math.abs(delta.amount))} `
                    + `(${delta.amount > 0 ? '+' : '-'}${Math.abs(delta.pct).toFixed(1)}%) vs current basic`}
              </Text>
            )}
            <TextInput label="Effective date" type="date" withAsterisk {...form.getInputProps('effectiveDate')} />
            <Textarea
              label="Reason" withAsterisk autosize minRows={2}
              placeholder="Why this revision (e.g. annual review, promotion)"
              {...form.getInputProps('reason')}
            />
            <Select
              label="Approved by" placeholder="Not recorded" clearable searchable
              description="Optional. The person who approved this revision, if different from you."
              data={users} {...form.getInputProps('approvedById')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Save revision</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}
