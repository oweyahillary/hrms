import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Center, Group, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconPlus, IconReportMoney, IconArrowUpRight } from '@tabler/icons-react';
import { listPayrollRuns, type PayrollRunListItem, type PayrollRunStatus, type PayrollRunType } from '../api/payroll';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hasAnyPermission } from '../auth/permissions';
import { ErrorCard } from '../components/ErrorCard';

const STATUS_COLOR: Record<PayrollRunStatus, string> = {
  DRAFT: 'amber', PROCESSING: 'amber', FINALIZED: 'brand', PAID: 'sand',
};
const STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: 'Draft', PROCESSING: 'Processing', FINALIZED: 'Finalized', PAID: 'Paid',
};
const TYPE_COLOR: Record<PayrollRunType, string> = { REGULAR: 'sand', ADJUSTMENT: 'amber' };
const TYPE_LABEL: Record<PayrollRunType, string> = { REGULAR: 'Regular', ADJUSTMENT: 'Correction' };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PayrollRunsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Matches the API's list gate (@AnyPermission on payroll.view/run/finalize)
  // — a view-only or finalize-only holder still needs to see the list.
  const allowed = hasAnyPermission(user?.permissions, ['payroll.view', 'payroll.run', 'payroll.finalize']);

  const [runs, setRuns] = useState<PayrollRunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await listPayrollRuns();
        if (cancelled) return;
        setRuns(rows);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Payroll runs could not load. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [allowed, reloadKey]);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>Payroll</Title>
          <Text c="sand.6" mt={4}>Payroll runs, payslips and statutory deductions</Text>
        </div>
        <Button component={Link} to="/payroll/new" leftSection={<IconPlus size={16} />}>
          New run
        </Button>
      </Group>

      <Card p="lg" radius="md">
        {error ? (
          <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />
        ) : (
          <>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover={!loading}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Period</Table.Th>
                    <Table.Th visibleFrom="sm">Type</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th visibleFrom="md" w={100}>Payslips</Table.Th>
                    <Table.Th visibleFrom="sm">Run date</Table.Th>
                    <Table.Th w={40} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading ? (
                    Array.from({ length: 4 }, (_, i) => (
                      <Table.Tr key={`s${i}`}>
                        <Table.Td><Skeleton h={14} radius="sm" /></Table.Td>
                        <Table.Td visibleFrom="sm"><Skeleton h={14} radius="sm" /></Table.Td>
                        <Table.Td><Skeleton h={14} w={80} radius="sm" /></Table.Td>
                        <Table.Td visibleFrom="md"><Skeleton h={14} w={40} radius="sm" /></Table.Td>
                        <Table.Td visibleFrom="sm"><Skeleton h={14} radius="sm" /></Table.Td>
                        <Table.Td />
                      </Table.Tr>
                    ))
                  ) : (
                    runs.map((r) => (
                      <Table.Tr
                        key={r.id} onClick={() => navigate(`/payroll/${r.id}`)}
                        style={{ cursor: 'pointer' }}
                      >
                        <Table.Td>
                          <Text size="sm" fw={600}>{MONTHS[r.periodMonth - 1]} {r.periodYear}</Text>
                          {r.correctsRunId && (
                            <Text size="xs" c="sand.6">Corrects a finalized run</Text>
                          )}
                        </Table.Td>
                        <Table.Td visibleFrom="sm">
                          <Badge variant="light" size="sm" color={TYPE_COLOR[r.runType]}>
                            {TYPE_LABEL[r.runType]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>
                            {STATUS_LABEL[r.status]}
                          </Badge>
                        </Table.Td>
                        <Table.Td visibleFrom="md"><Text size="sm">{r.payslipCount}</Text></Table.Td>
                        <Table.Td visibleFrom="sm"><Text size="sm" c="sand.6">{fmtDateTime(r.runDate)}</Text></Table.Td>
                        <Table.Td><IconArrowUpRight size={15} color="var(--mantine-color-sand-4)" /></Table.Td>
                      </Table.Tr>
                    ))
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {!loading && runs.length === 0 && (
              <Center py={48}>
                <Stack gap={6} align="center">
                  <IconReportMoney size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
                  <Text fw={600} mt={4}>No payroll runs yet</Text>
                  <Text size="sm" c="sand.6" maw={380} ta="center">
                    Run payroll for a period once your employees have salary structures set up.
                  </Text>
                  <Button component={Link} to="/payroll/new" variant="light" mt="sm" leftSection={<IconPlus size={16} />}>
                    New run
                  </Button>
                </Stack>
              </Center>
            )}
          </>
        )}
      </Card>
    </Stack>
  );
}
