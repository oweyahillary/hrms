import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Card, Group, Skeleton, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconClockPlus } from '@tabler/icons-react';
import { getMyOvertime, type OvertimeEntry, type OvertimeCategory, type OvertimeStatus } from '../api/overtime';
import { ErrorCard } from '../components/ErrorCard';
import { EmptyState } from '../components/EmptyState';
import { formatDate } from '../utils/date';
import { kes } from '../utils/money';

const CATEGORY_LABEL: Record<OvertimeCategory, string> = { NORMAL_DAY: 'Normal day', REST_DAY: 'Rest day', HOLIDAY: 'Holiday' };
const STATUS_LABEL: Record<OvertimeStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
const STATUS_COLOR: Record<OvertimeStatus, string> = { PENDING: 'amber', APPROVED: 'brand', REJECTED: 'red' };

function firstOfMonthIso(): string { return `${new Date().toISOString().slice(0, 7)}-01`; }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

export function MyOvertimePage() {
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await getMyOvertime(from, to));
    } catch {
      setError('Your overtime could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const approvedTotal = rows.filter((r) => r.status === 'APPROVED' && r.amount !== null).reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={1}>My overtime</Title>
          <Text c="sand.6" mt={4}>Entries derived from your attendance, or recorded manually by HR.</Text>
        </div>
        <Group>
          <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value || firstOfMonthIso())} w={160} />
          <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value || todayIso())} w={160} />
        </Group>
      </Group>

      {error && <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} retrying={loading} />}

      {!error && !loading && rows.length > 0 && (
        <Card p="md" radius="md">
          <Text size="sm" c="sand.6">Approved this range</Text>
          <Text size="xl" fw={700}>{kes(approvedTotal)}</Text>
        </Card>
      )}

      {!error && (
        <Card p={0} radius="md">
          <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Hours</Table.Th>
                    <Table.Th>Amount</Table.Th>
                    <Table.Th>Status</Table.Th>
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
                  {!loading && rows.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{formatDate(r.date)}</Table.Td>
                      <Table.Td>{CATEGORY_LABEL[r.category]}</Table.Td>
                      <Table.Td>{r.hours}h</Table.Td>
                      <Table.Td>{r.amount === null ? <Text size="sm" c="sand.5">—</Text> : kes(r.amount)}</Table.Td>
                      <Table.Td><Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Stack hiddenFrom="sm" gap={0} p="md">
            {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={70} radius="sm" mb="sm" />)}
            {!loading && rows.map((r) => (
              <Card key={r.id} withBorder p="md" radius="sm" mb="sm">
                <Group justify="space-between" mb={4}>
                  <Text fw={600} size="sm">{formatDate(r.date)}</Text>
                  <Badge variant="light" size="sm" color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </Group>
                <Text size="xs" c="sand.6">{CATEGORY_LABEL[r.category]} · {r.hours}h{r.amount !== null ? ` · ${kes(r.amount)}` : ''}</Text>
              </Card>
            ))}
          </Stack>

          {!loading && rows.length === 0 && (
            <Box p="md">
              <EmptyState icon={IconClockPlus} title="No overtime in this range" description="Nothing recorded for the selected dates." />
            </Box>
          )}
        </Card>
      )}
    </Stack>
  );
}
