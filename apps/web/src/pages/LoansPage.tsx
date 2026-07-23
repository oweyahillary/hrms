import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Select, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconPlus, IconDownload } from '@tabler/icons-react';
import {
  getLoanBook, downloadLoanBookPdf, type LoanBook,
} from '../api/reports';
import { LOAN_STATUSES } from '../api/loans';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { kes } from '../utils/money';

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'brand', COMPLETED: 'sand', CANCELLED: 'red' };

export function LoansPage() {
  const [book, setBook] = useState<LoanBook | null>(null);
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
      const data = await getLoanBook({ employeeId: employeeId ?? undefined, status: status ?? undefined });
      setBook(data);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view the loan book.'
        : 'Could not load loans. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, status]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadLoanBookPdf({ employeeId: employeeId ?? undefined, status: status ?? undefined });
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Download failed',
        message: e instanceof ApiError ? e.message : 'Could not download the loan book PDF.',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Loans &amp; advances</Title>
          <Text c="sand.6" size="sm" mt={2}>
            Every staff loan and salary advance, with balance, installments remaining and next amount due.
          </Text>
        </div>
        <Group>
          <Button
            variant="default" leftSection={<IconDownload size={16} />}
            onClick={() => void download()} loading={downloading}
          >
            PDF
          </Button>
          <Button component={RouterLink} to="/payroll/setup/loans/new" leftSection={<IconPlus size={16} />}>
            New loan / advance
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
          data={LOAN_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
          value={status} onChange={setStatus} w={180}
        />
      </Group>

      {error && <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />}

      {!error && book && !loading && (
        <Card p="md" radius="md" withBorder>
          <Group gap="xl">
            <div>
              <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Outstanding exposure</Text>
              <Text fw={700} size="xl">{kes(book.totals.totalOutstanding)}</Text>
            </div>
            <div>
              <Text size="xs" c="sand.6" tt="uppercase" fw={600}>Records</Text>
              <Text fw={700} size="xl">{book.totals.count}</Text>
            </div>
          </Group>
        </Card>
      )}

      {!error && <Box visibleFrom="sm">
        <Card p={0} radius="md" withBorder>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Employee</Table.Th>
                <Table.Th visibleFrom="md">Type</Table.Th>
                <Table.Th ta="right" visibleFrom="lg">Principal</Table.Th>
                <Table.Th ta="right" visibleFrom="sm">Balance</Table.Th>
                <Table.Th ta="right" visibleFrom="lg">Inst. left</Table.Th>
                <Table.Th ta="right" visibleFrom="md">Next due</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading && [0, 1, 2, 3].map((i) => (
                <Table.Tr key={i}>
                  {(['', 'md', 'lg', 'sm', 'lg', 'md', ''] as const).map((vf, j) => (
                    <Table.Td key={j} visibleFrom={vf || undefined}><Skeleton height={14} /></Table.Td>
                  ))}
                </Table.Tr>
              ))}
              {!loading && book?.rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text ta="center" c="sand.6" py="lg">No loans or advances match these filters.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {!loading && book?.rows.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text fw={500}>{r.employeeName || '\u2014'}</Text>
                    <Text size="xs" c="sand.6">{r.employeeNumber}</Text>
                  </Table.Td>
                  <Table.Td visibleFrom="md">{r.type === 'ADVANCE' ? 'Advance' : 'Loan'}</Table.Td>
                  <Table.Td ta="right" visibleFrom="lg">{kes(r.principal)}</Table.Td>
                  <Table.Td ta="right" visibleFrom="sm">{kes(r.balance)}</Table.Td>
                  <Table.Td ta="right" visibleFrom="lg">{r.installmentsRemaining}</Table.Td>
                  <Table.Td ta="right" visibleFrom="md">{kes(r.nextDueAmount)}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[r.status] ?? 'sand'} variant="light">
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Box>}

      {/* Below sm: one card per loan instead of a table with most columns hidden. */}
      {!error && (
        <Stack hiddenFrom="sm" gap="sm">
          {loading && [0, 1, 2].map((i) => (
            <Card key={`ms${i}`} p="md" radius="md"><Skeleton h={14} w="50%" radius="sm" /></Card>
          ))}
          {!loading && book?.rows.length === 0 && (
            <Text ta="center" c="sand.6" py="lg">No loans or advances match these filters.</Text>
          )}
          {!loading && book?.rows.map((r) => (
            <Card key={r.id} p="md" radius="md">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={500} size="sm">{r.employeeName || '\u2014'}</Text>
                  <Text size="xs" c="sand.6">{r.employeeNumber} \u00b7 {r.type === 'ADVANCE' ? 'Advance' : 'Loan'}</Text>
                </div>
                <Badge color={STATUS_COLOR[r.status] ?? 'sand'} variant="light">
                  {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                </Badge>
              </Group>
              <Group gap="lg" mt="sm">
                <div>
                  <Text size="xs" c="sand.6">Balance</Text>
                  <Text size="sm" fw={600}>{kes(r.balance)}</Text>
                </div>
                <div>
                  <Text size="xs" c="sand.6">Next due</Text>
                  <Text size="sm" fw={600}>{kes(r.nextDueAmount)}</Text>
                </div>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
