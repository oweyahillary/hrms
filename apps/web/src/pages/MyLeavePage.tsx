import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, Center, Group, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCalendarOff, IconCheck, IconPlus, IconWallet, IconX,
} from '@tabler/icons-react';
import { getMyLeave } from '../api/self-service';
import { cancelLeave, type LeaveBalance, type LeaveRequest } from '../api/leave';
import { ApiError } from '../api/client';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'amber', APPROVED: 'brand', REJECTED: 'red', CANCELLED: 'sand',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

/** Dates are @db.Date at UTC midnight — format in UTC or they shift a day. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtRange(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function MyLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getMyLeave();
      setRequests(data.requests);
      setBalances(data.balances);
      setError(null);
    } catch {
      setRequests([]); setBalances([]);
      setError('Could not load your leave. Please try again.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cancel = async (r: LeaveRequest) => {
    setBusyId(r.id);
    try {
      await cancelLeave(r.id);
      notifications.show({
        color: 'sand', icon: <IconCheck size={16} />,
        title: 'Request cancelled', message: `${fmtRange(r.startDate, r.endDate)} is no longer pending.`,
      });
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', title: 'Could not cancel',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>My Leave</Title>
          <Text c="sand.6" mt={4}>Your balances and every request you&apos;ve made</Text>
        </div>
        <Button component={Link} to="/leave/apply" leftSection={<IconPlus size={16} />}>
          Apply for leave
        </Button>
      </Group>

      <Card p="lg" radius="md">
        <Text fw={600} mb="md">Balances</Text>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Leave type</Table.Th>
                <Table.Th w={70}>Year</Table.Th>
                <Table.Th w={90}>Accrued</Table.Th>
                <Table.Th w={110}>Carried over</Table.Th>
                <Table.Th w={80}>Used</Table.Th>
                <Table.Th w={110}>Available</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {balances === null && Array.from({ length: 2 }, (_, i) => (
                <Table.Tr key={`s${i}`}><Table.Td colSpan={6}><Skeleton h={14} radius="sm" /></Table.Td></Table.Tr>
              ))}
              {balances?.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{b.leaveTypeName ?? '—'}</Text>
                    {b.carryOverExpiresOn && b.expiringDays > 0 && (
                      <Text size="xs" c="amber.7">
                        {b.expiringDays} day{b.expiringDays === 1 ? '' : 's'} expire on {b.carryOverExpiresOn}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td><Text size="sm">{b.year}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.accruedDays}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.carriedOverDays}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.usedDays}</Text></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={b.availableDays > 0 ? 'brand' : 'sand'}>
                      {b.availableDays}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {balances?.length === 0 && (
          <Center py={32}>
            <Stack gap={6} align="center">
              <IconWallet size={26} stroke={1.5} color="var(--mantine-color-sand-4)" />
              <Text size="sm" c="sand.6">No balances set up yet. HR can set one for you.</Text>
            </Stack>
          </Center>
        )}
      </Card>

      <Card p="lg" radius="md">
        <Text fw={600} mb="md">My requests</Text>

        {error ? (
          <Center py={48}><Text size="sm" c="sand.7" maw={420} ta="center">{error}</Text></Center>
        ) : (
          <>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Dates</Table.Th>
                    <Table.Th visibleFrom="sm" w={70}>Days</Table.Th>
                    <Table.Th w={110}>Status</Table.Th>
                    <Table.Th w={100} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {requests === null && Array.from({ length: 3 }, (_, i) => (
                    <Table.Tr key={`s${i}`}><Table.Td colSpan={5}><Skeleton h={14} radius="sm" /></Table.Td></Table.Tr>
                  ))}
                  {requests?.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td><Text size="sm">{r.leaveTypeName ?? '—'}</Text></Table.Td>
                      <Table.Td>
                        <Text size="sm">{fmtRange(r.startDate, r.endDate)}</Text>
                        {r.reason && <Text size="xs" c="sand.6" lineClamp={1} maw={220}>{r.reason}</Text>}
                      </Table.Td>
                      <Table.Td visibleFrom="sm"><Text size="sm">{r.daysRequested}</Text></Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={STATUS_COLOR[r.status] ?? 'sand'}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {r.status === 'PENDING' && (
                          <Button
                            size="compact-sm" variant="subtle" color="red" loading={busyId === r.id}
                            leftSection={<IconX size={14} />} onClick={() => void cancel(r)}
                          >
                            Cancel
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {requests?.length === 0 && (
              <Center py={48}>
                <Stack gap={6} align="center">
                  <IconCalendarOff size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
                  <Text fw={600} mt={4}>No requests yet</Text>
                  <Text size="sm" c="sand.6" maw={380} ta="center">Apply for leave to get started.</Text>
                  <Button component={Link} to="/leave/apply" variant="light" mt="sm" leftSection={<IconPlus size={16} />}>
                    Apply for leave
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
