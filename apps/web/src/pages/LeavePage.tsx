import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar, Badge, Button, Card, Center, Group, Select, Skeleton, Stack, Table, Tabs, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCalendarStats, IconCheck, IconInboxOff, IconInbox, IconList, IconPlus, IconX,
} from '@tabler/icons-react';
import {
  approveLeave, leaveInbox, listLeaveRequests, rejectLeave,
  LEAVE_STATUSES, type LeaveRequest,
} from '../api/leave';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../auth/permissions';
import { ErrorCard } from '../components/ErrorCard';
import { formatDate as fmtDate } from '../utils/date';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'amber', APPROVED: 'brand', REJECTED: 'red', CANCELLED: 'sand',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

const STATUS_OPTIONS = LEAVE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }));

function fmtRange(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10) ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function RequestRows({
  rows, loading, busyId, onApprove, onReject, showActions,
}: {
  rows: LeaveRequest[]; loading: boolean; busyId: string | null;
  onApprove: (r: LeaveRequest) => void; onReject: (r: LeaveRequest) => void;
  showActions: boolean;
}) {
  if (loading) {
    return (
      <>
        {Array.from({ length: 4 }, (_, i) => (
          <Table.Tr key={`s${i}`}>
            <Table.Td><Skeleton h={14} radius="sm" /></Table.Td>
            <Table.Td visibleFrom="sm"><Skeleton h={14} radius="sm" /></Table.Td>
            <Table.Td><Skeleton h={14} radius="sm" /></Table.Td>
            <Table.Td visibleFrom="md"><Skeleton h={14} w={40} radius="sm" /></Table.Td>
            <Table.Td><Skeleton h={14} w={64} radius="sm" /></Table.Td>
            {showActions && <Table.Td><Skeleton h={14} w={80} radius="sm" /></Table.Td>}
          </Table.Tr>
        ))}
      </>
    );
  }

  return (
    <>
      {rows.map((r) => (
        <Table.Tr key={r.id}>
          <Table.Td>
            <Group gap="sm" wrap="nowrap">
              <Avatar radius="xl" size={28} color="brand" variant="light">
                {(r.employeeName ?? '?').trim().charAt(0).toUpperCase()}
              </Avatar>
              <div>
                <Text size="sm" fw={600}>{r.employeeName ?? 'Unknown'}</Text>
                {r.employeeNumber && <Text size="xs" c="sand.6" ff="monospace">{r.employeeNumber}</Text>}
              </div>
            </Group>
          </Table.Td>
          <Table.Td visibleFrom="sm"><Text size="sm">{r.leaveTypeName ?? '—'}</Text></Table.Td>
          <Table.Td>
            <Text size="sm">{fmtRange(r.startDate, r.endDate)}</Text>
            {r.reason && (
              <Text size="xs" c="sand.6" lineClamp={1} maw={220}>{r.reason}</Text>
            )}
          </Table.Td>
          <Table.Td visibleFrom="md"><Text size="sm">{r.daysRequested}</Text></Table.Td>
          <Table.Td>
            <Badge variant="light" size="sm" color={STATUS_COLOR[r.status] ?? 'sand'}>
              {STATUS_LABEL[r.status] ?? r.status}
            </Badge>
          </Table.Td>
          {showActions && (
            <Table.Td>
              {r.status === 'PENDING' ? (
                <Group gap={6} wrap="nowrap">
                  <Button
                    size="compact-sm" variant="light" loading={busyId === r.id}
                    leftSection={<IconCheck size={14} />} onClick={() => onApprove(r)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="compact-sm" variant="subtle" color="red" disabled={busyId === r.id}
                    leftSection={<IconX size={14} />} onClick={() => onReject(r)}
                  >
                    Reject
                  </Button>
                </Group>
              ) : (
                <Text size="xs" c="sand.6">—</Text>
              )}
            </Table.Td>
          )}
        </Table.Tr>
      ))}
    </>
  );
}

export function LeavePage() {
  const { user } = useAuth();
  const isHr = hasPermission(user?.permissions, 'leave.manage');

  const [tab, setTab] = useState<string | null>('inbox');
  const [status, setStatus] = useState<string | null>(null);

  const [all, setAll] = useState<LeaveRequest[]>([]);
  const [inbox, setInbox] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, mine] = await Promise.all([
        listLeaveRequests(status ? { status } : {}),
        leaveInbox(),
      ]);
      setAll(rows);
      setInbox(mine);
      setError(null);
    } catch (e) {
      setAll([]); setInbox([]);
      setError(e instanceof ApiError && e.status === 403
        ? 'Your role cannot view leave requests.'
        : 'Leave requests could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const act = async (r: LeaveRequest, kind: 'approve' | 'reject') => {
    setBusyId(r.id);
    try {
      const updated = kind === 'approve' ? await approveLeave(r.id) : await rejectLeave(r.id);
      notifications.show({
        color: kind === 'approve' ? 'brand' : 'sand',
        icon: kind === 'approve' ? <IconCheck size={16} /> : <IconX size={16} />,
        title: kind === 'approve' ? 'Approved' : 'Rejected',
        message: `${r.employeeName ?? 'Request'} · ${STATUS_LABEL[updated.status] ?? updated.status}`,
      });
      // Approving can hand the request to the next approver, so reload both
      // lists rather than guessing the new state locally.
      await load();
    } catch (e) {
      notifications.show({
        color: 'red',
        title: kind === 'approve' ? 'Could not approve' : 'Could not reject',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = useMemo(() => inbox.length, [inbox]);

  const header = (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Employee</Table.Th>
        <Table.Th visibleFrom="sm">Type</Table.Th>
        <Table.Th>Dates</Table.Th>
        <Table.Th visibleFrom="md" w={70}>Days</Table.Th>
        <Table.Th w={110}>Status</Table.Th>
        {tab === 'inbox' && <Table.Th w={190}>Action</Table.Th>}
      </Table.Tr>
    </Table.Thead>
  );

  const rows = tab === 'inbox' ? inbox : all;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>Leave</Title>
          <Text c="sand.6" mt={4}>
            {isHr ? 'Requests across the organisation, and the ones waiting on you' : 'Your leave requests'}
          </Text>
        </div>
        <Button component={Link} to="/leave/apply" leftSection={<IconPlus size={16} />}>
          Apply for leave
        </Button>
      </Group>

      <Card p="lg" radius="md">
        <Group justify="space-between" align="center" mb="md" wrap="wrap" gap="sm">
          <Tabs value={tab} onChange={setTab} variant="pills">
            <Tabs.List>
              <Tabs.Tab
                value="inbox"
                leftSection={<IconInbox size={15} />}
                rightSection={pendingCount > 0
                  ? <Badge size="xs" circle variant="filled" color="amber">{pendingCount}</Badge>
                  : null}
              >
                Awaiting me
              </Tabs.Tab>
              <Tabs.Tab value="all" leftSection={<IconList size={15} />}>
                {isHr ? 'All requests' : 'My requests'}
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {tab === 'all' && (
            <Select
              placeholder="Any status" data={STATUS_OPTIONS} value={status}
              onChange={setStatus} clearable w={160} aria-label="Filter by status"
            />
          )}
        </Group>

        {error ? (
          <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />
        ) : (
          <>
            <Table.ScrollContainer minWidth={560}>
              <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover={!loading}>
                {header}
                <Table.Tbody>
                  <RequestRows
                    rows={rows} loading={loading} busyId={busyId}
                    onApprove={(r) => void act(r, 'approve')}
                    onReject={(r) => void act(r, 'reject')}
                    showActions={tab === 'inbox'}
                  />
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {!loading && rows.length === 0 && (
              <Center py={48}>
                <Stack gap={6} align="center">
                  {tab === 'inbox'
                    ? <IconInboxOff size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
                    : <IconCalendarStats size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />}
                  <Text fw={600} mt={4}>{tab === 'inbox' ? 'Nothing waiting on you' : 'No requests'}</Text>
                  <Text size="sm" c="sand.6" maw={380} ta="center">
                    {tab === 'inbox'
                      ? 'Leave requests that need your approval will appear here.'
                      : status
                        ? 'No requests with that status. Clear the filter to see them all.'
                        : 'Apply for leave to get started.'}
                  </Text>
                  {tab === 'all' && !status && (
                    <Button
                      component={Link} to="/leave/apply" variant="light" mt="sm"
                      leftSection={<IconPlus size={16} />}
                    >
                      Apply for leave
                    </Button>
                  )}
                </Stack>
              </Center>
            )}
          </>
        )}
      </Card>

    </Stack>
  );
}
