import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Badge, Button, Card, Group, Select, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconPlus, IconDownload } from '@tabler/icons-react';
import {
  getAdjustmentsRegister, downloadAdjustmentsRegisterPdf, type AdjustmentsRegister,
} from '../api/reports';
import { cancelPayrollAdjustment, ADJUSTMENT_STATUSES } from '../api/payrollAdjustments';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';

const STATUS_COLOR: Record<string, string> = { PENDING: 'amber', APPLIED: 'brand', CANCELLED: 'red' };

export function DeductionsPage() {
  const [register, setRegister] = useState<AdjustmentsRegister | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    void loadEmployeeOptions().then(setEmployees).catch(() => { /* filter still usable without names */ });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getAdjustmentsRegister({ employeeId: employeeId ?? undefined, status: status ?? undefined });
      setRegister(data);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view adjustments.'
        : 'Could not load adjustments. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, status]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadAdjustmentsRegisterPdf({ employeeId: employeeId ?? undefined, status: status ?? undefined });
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Download failed',
        message: e instanceof ApiError ? e.message : 'Could not download the adjustments PDF.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelPayrollAdjustment(id);
      notifications.show({ color: 'brand', icon: <IconCheck size={16} />, title: 'Adjustment cancelled', message: 'It will not be applied.' });
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not cancel',
        message: e instanceof ApiError ? e.message : 'Only a pending adjustment can be cancelled.',
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Deductions &amp; bonuses</Title>
          <Text c="sand.6" size="sm" mt={2}>
            One-off adjustments applied to a specific period, across all staff. Each has a recorded reason.
          </Text>
        </div>
        <Group>
          <Button
            variant="default" leftSection={<IconDownload size={16} />}
            onClick={() => void download()} loading={downloading}
          >
            PDF
          </Button>
          <Button component={RouterLink} to="/payroll/setup/deductions/new" leftSection={<IconPlus size={16} />}>
            New adjustment
          </Button>
        </Group>
      </Group>

      <Group>
        <Select
          label="Employee" placeholder="All employees" clearable searchable
          data={employees} value={employeeId} onChange={setEmployeeId} w={280}
        />
        <Select
          label="Status" placeholder="All statuses" clearable
          data={ADJUSTMENT_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
          value={status} onChange={setStatus} w={180}
        />
      </Group>

      {error && <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />}

      {!error && register && !loading && (
        <Card p="md" radius="md" withBorder>
          <Group gap="xl">
            <div>
              <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Bonuses</Text>
              <Text fw={700} size="xl">{kes(register.totals.totalBonuses)}</Text>
            </div>
            <div>
              <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Deductions</Text>
              <Text fw={700} size="xl">{kes(register.totals.totalDeductions)}</Text>
            </div>
            <div>
              <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Records</Text>
              <Text fw={700} size="xl">{register.totals.count}</Text>
            </div>
          </Group>
        </Card>
      )}

      {!error && <Card p={0} radius="md" withBorder>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Employee</Table.Th>
              <Table.Th visibleFrom="md">Type</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
              <Table.Th visibleFrom="md">Period</Table.Th>
              <Table.Th visibleFrom="lg">Reason</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loading && [0, 1, 2, 3].map((i) => (
              <Table.Tr key={i}>
                {(['', 'md', '', 'md', 'lg', '', ''] as const).map((vf, j) => (<Table.Td key={j} visibleFrom={vf || undefined}><Skeleton height={14} /></Table.Td>))}
              </Table.Tr>
            ))}
            {!loading && register?.rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text ta="center" c="sand.6" py="lg">No adjustments match these filters.</Text>
                </Table.Td>
              </Table.Tr>
            )}
            {!loading && register?.rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Text fw={500}>{r.employeeName || '\u2014'}</Text>
                  <Text size="xs" c="sand.6">{r.employeeNumber}</Text>
                </Table.Td>
                <Table.Td visibleFrom="md">
                  {r.type === 'BONUS' ? 'Bonus' : 'Deduction'}
                  {r.type === 'BONUS' && !r.isTaxable && <Text size="xs" c="sand.6">non-taxable</Text>}
                </Table.Td>
                <Table.Td ta="right">{kes(r.amount)}</Table.Td>
                <Table.Td visibleFrom="md">{String(r.targetPeriodMonth).padStart(2, '0')}/{r.targetPeriodYear}</Table.Td>
                <Table.Td visibleFrom="lg"><Text size="sm">{r.reason}</Text></Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[r.status] ?? 'sand'} variant="light">
                    {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">
                  {r.status === 'PENDING' && (
                    <Button size="xs" variant="subtle" color="red" onClick={() => void cancel(r.id)}>Cancel</Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>}
    </Stack>
  );
}
