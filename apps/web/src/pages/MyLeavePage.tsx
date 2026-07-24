import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, Center, Group, Skeleton, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCalendarOff, IconCheck, IconPlus, IconWallet, IconX,
} from '@tabler/icons-react';
import { getMyLeave, getMyShifts } from '../api/self-service';
import { cancelLeave, type LeaveBalance, type LeaveRequest } from '../api/leave';
import type { RosterEntry } from '../api/shifts';
import { ApiError } from '../api/client';
import { ErrorCard } from '../components/ErrorCard';
import { formatDate as fmtDate } from '../utils/date';
import { shiftColor } from '../utils/shift-color';

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(dateIso: string): string {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${weekday} ${d.getUTCDate()}`;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'amber', APPROVED: 'brand', REJECTED: 'red', CANCELLED: 'sand',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

function fmtRange(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function MyLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [myShifts, setMyShifts] = useState<RosterEntry[] | null>(null);
  const [shiftsError, setShiftsError] = useState(false);

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

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    void getMyShifts(today, addDays(today, 13))
      .then(setMyShifts)
      .catch(() => { setMyShifts([]); setShiftsError(true); });
  }, []);

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
          <Title order={1}>My leave</Title>
          <Text c="sand.6" mt={4}>Your balances and every request you&apos;ve made</Text>
        </div>
        <Button component={Link} to="/leave/apply" leftSection={<IconPlus size={16} />}>
          Apply for leave
        </Button>
      </Group>

      <Card p="lg" radius="md">
        <Text fw={600} mb="md">My roster — next 2 weeks</Text>
        {myShifts === null ? (
          <Group gap="xs">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} h={44} w={64} radius="sm" />)}
          </Group>
        ) : shiftsError ? (
          <Text size="sm" c="sand.6">Your roster could not load.</Text>
        ) : myShifts.length === 0 ? (
          <Text size="sm" c="sand.6">No shifts scheduled for you in the next two weeks.</Text>
        ) : (
          <Group gap="xs">
            {myShifts.map((s) => (
              <Card key={s.id} withBorder p="xs" radius="sm" ta="center" w={64}>
                <Text size="xs" c="sand.6">{dayLabel(s.date)}</Text>
                <Badge variant="light" size="sm" color={shiftColor(s.shiftCode)} mt={2}>{s.shiftCode}</Badge>
              </Card>
            ))}
          </Group>
        )}
      </Card>

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
          <ErrorCard message={error} onRetry={() => void load()} retrying={requests === null} />
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
