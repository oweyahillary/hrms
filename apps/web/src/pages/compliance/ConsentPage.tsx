import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Box, Button, Card, Group, Modal, Select, Skeleton, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPlus, IconUserSearch } from '@tabler/icons-react';
import {
  grantConsent, listConsentsForEmployee, withdrawConsent, LAWFUL_BASES,
  type ConsentRecord, type LawfulBasis,
} from '../../api/compliance';
import { loadEmployeeOptions, type EmployeeOption } from '../../api/employee-options';
import { ApiError } from '../../api/client';
import { ErrorCard } from '../../components/ErrorCard';
import { EmptyState } from '../../components/EmptyState';
import { formatDate as fmtDate } from '../../utils/date';

const BASIS_LABEL: Record<LawfulBasis, string> = {
  CONSENT: 'Consent', CONTRACT: 'Contract', LEGAL_OBLIGATION: 'Legal obligation', LEGITIMATE_INTEREST: 'Legitimate interest',
};

interface FormValues {
  purpose: string;
  lawfulBasis: LawfulBasis;
}

export function ConsentPage() {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [rows, setRows] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const [grantOpen, setGrantOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { purpose: '', lawfulBasis: 'CONSENT' },
    validate: { purpose: (v) => (v.trim() ? null : 'Describe what this consent covers') },
  });

  useEffect(() => {
    void loadEmployeeOptions().then(setEmployees).catch(() => { /* picker just stays empty */ });
  }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true); setError(null);
    try {
      setRows(await listConsentsForEmployee(employeeId));
    } catch {
      setError('Consent records could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const submitGrant = async (values: FormValues) => {
    if (!employeeId) return;
    setSaving(true);
    try {
      await grantConsent(employeeId, { purpose: values.purpose.trim(), lawfulBasis: values.lawfulBasis });
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Consent recorded', message: '' });
      setGrantOpen(false);
      form.reset();
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not record consent',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const doWithdraw = async (id: string) => {
    setWithdrawingId(id);
    try {
      await withdrawConsent(id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Consent withdrawn', message: '' });
      setReloadKey((k) => k + 1);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not withdraw',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>Consent records</Title>
          <Text c="sand.6" mt={4}>Per-employee — choose someone to see what they&apos;ve consented to.</Text>
        </div>
        {employeeId && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setGrantOpen(true)}>
            Record consent
          </Button>
        )}
      </Group>

      <Select
        label="Employee" placeholder="Search by name or number" searchable clearable
        data={employees} value={employeeId} onChange={setEmployeeId} w={{ base: '100%', sm: 360 }}
      />

      {!employeeId && (
        <Card p="md" radius="md">
          <EmptyState icon={IconUserSearch} title="Choose an employee" description="Pick someone above to see their consent records." />
        </Card>
      )}

      {employeeId && error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {employeeId && !error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Purpose</Table.Th>
                    <Table.Th>Lawful basis</Table.Th>
                    <Table.Th>Granted</Table.Th>
                    <Table.Th>Status</Table.Th>
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
                      <Table.Td>{r.purpose}</Table.Td>
                      <Table.Td>{BASIS_LABEL[r.lawfulBasis]}</Table.Td>
                      <Table.Td>{fmtDate(r.grantedAt)}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={r.active ? 'brand' : 'sand'}>
                          {r.active ? 'Granted' : `Withdrawn ${fmtDate(r.withdrawnAt)}`}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {r.active && (
                          <Button
                            size="compact-sm" variant="subtle" color="red"
                            loading={withdrawingId === r.id}
                            onClick={() => void doWithdraw(r.id)}
                          >
                            Withdraw
                          </Button>
                        )}
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
                  <Text fw={600} size="sm">{r.purpose}</Text>
                  <Badge variant="light" size="sm" color={r.active ? 'brand' : 'sand'}>
                    {r.active ? 'Granted' : 'Withdrawn'}
                  </Badge>
                </Group>
                <Text size="xs" c="sand.6" mb={6}>{BASIS_LABEL[r.lawfulBasis]} · Granted {fmtDate(r.grantedAt)}</Text>
                {r.active && (
                  <Button
                    size="compact-sm" variant="subtle" color="red"
                    loading={withdrawingId === r.id}
                    onClick={() => void doWithdraw(r.id)}
                  >
                    Withdraw
                  </Button>
                )}
              </Card>
            ))}
          </Stack>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconUserSearch} title="No consent records" description="Nothing has been recorded for this employee yet." />
            </Box>
          )}
        </Card>
      )}

      <Modal opened={grantOpen} onClose={() => setGrantOpen(false)} title="Record consent" centered>
        <form onSubmit={form.onSubmit((v) => void submitGrant(v))}>
          <Stack gap="md">
            <TextInput
              label="Purpose" withAsterisk placeholder="e.g. Sharing payroll data with the pension provider"
              {...form.getInputProps('purpose')}
            />
            <Select
              label="Lawful basis" withAsterisk allowDeselect={false}
              data={LAWFUL_BASES.map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
              value={form.values.lawfulBasis}
              onChange={(v) => form.setFieldValue('lawfulBasis', (v as LawfulBasis) ?? 'CONSENT')}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setGrantOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Record</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
