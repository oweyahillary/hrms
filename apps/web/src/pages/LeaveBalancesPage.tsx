import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, Card, Center, Group, Modal, NumberInput, Select, Skeleton, Stack,
  Table, Text, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowLeft, IconCheck, IconPlayerPlay, IconUserSearch, IconWallet,
} from '@tabler/icons-react';
import {
  getLeaveBalances, getLeaveTypes, runAccrual, upsertLeaveBalance,
  type LeaveBalance, type LeaveType,
} from '../api/leave';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../auth/permissions';
import { ErrorCard } from '../components/ErrorCard';

const YEAR_NOW = new Date().getUTCFullYear();
const YEARS = [YEAR_NOW - 2, YEAR_NOW - 1, YEAR_NOW, YEAR_NOW + 1].map((y) => ({
  value: String(y), label: String(y),
}));

export function LeaveBalancesPage() {
  const { user } = useAuth();
  const isHr = hasPermission(user?.permissions, 'leave.manage');

  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(String(YEAR_NOW));
  const [rows, setRows] = useState<LeaveBalance[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editType, setEditType] = useState<string | null>(null);
  const [accrued, setAccrued] = useState<number | string>(0);
  const [carried, setCarried] = useState<number | string>(0);
  const [saving, setSaving] = useState(false);
  const [accruing, setAccruing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [emps, tps] = await Promise.all([
          listEmployees({ status: 'ACTIVE', pageSize: 100, sort: 'name', order: 'asc' }),
          getLeaveTypes(),
        ]);
        if (cancelled) return;
        setEmployees(emps.data);
        setTypes(tps);
      } catch {
        if (!cancelled) setError('Could not load employees and leave types.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!employeeId || !year) { setRows(null); return; }
    setLoading(true);
    try {
      setRows(await getLeaveBalances(employeeId, Number(year)));
      setError(null);
    } catch (e) {
      setRows([]);
      setError(e instanceof ApiError && e.status === 403
        ? 'Your role cannot view leave balances.'
        : 'Balances could not load.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, year]);

  useEffect(() => { void load(); }, [load]);

  const openEdit = (b?: LeaveBalance) => {
    setEditType(b?.leaveTypeId ?? null);
    setAccrued(b?.accruedDays ?? 0);
    setCarried(b?.carriedOverDays ?? 0);
    setEditOpen(true);
  };

  const save = async () => {
    if (!employeeId || !year || !editType) return;
    setSaving(true);
    try {
      await upsertLeaveBalance({
        employeeId, leaveTypeId: editType, year: Number(year),
        accruedDays: Number(accrued), carriedOverDays: Number(carried),
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Balance saved', message: 'The employee can now book against it.',
      });
      setEditOpen(false);
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', title: 'Could not save balance',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const accrueNow = async () => {
    setAccruing(true);
    try {
      const r = await runAccrual(Number(year), new Date().getUTCMonth() + 1);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Accrual run',
        message: `${r.created} created, ${r.updated} updated, ${r.unchanged} already correct.`,
      });
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', title: 'Could not run accrual',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setAccruing(false);
    }
  };

  const autoTypes = types.filter((t) => t.accrualMethod !== 'NONE' && (t.annualDays ?? 0) > 0);

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/leave" size="sm" c="sand.6">
        <Group gap={4}><IconArrowLeft size={14} /> Back to leave</Group>
      </Anchor>

      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>Leave balances</Title>
          <Text c="sand.6" mt={4}>What each person has earned, carried over and used</Text>
        </div>
        {isHr && (
          <Button
            variant="light" leftSection={<IconPlayerPlay size={16} />}
            loading={accruing} onClick={() => void accrueNow()}
            disabled={autoTypes.length === 0}
          >
            Run accrual for {year}
          </Button>
        )}
      </Group>

      {types.length === 0 && (
        <Alert color="amber" variant="light" icon={<IconAlertTriangle size={16} />} title="No leave types yet">
          Balances hang off leave types. <Anchor component={Link} to="/leave/types">Set up a leave type</Anchor> first.
        </Alert>
      )}

      {types.length > 0 && autoTypes.length === 0 && (
        <Alert color="sand" variant="light" title="Nothing accrues automatically">
          No leave type has an accrual method set, so balances won&apos;t build up on their own —
          you&apos;ll be setting each one by hand. Give a type an annual entitlement on the{' '}
          <Anchor component={Link} to="/leave/types">leave types</Anchor> screen to change that.
        </Alert>
      )}

      <Card p="lg" radius="md">
        <Group mb="md" wrap="wrap" gap="sm">
          <Select
            label="Employee" placeholder="Choose a person" searchable w={320}
            data={employees.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeNumber}` }))}
            value={employeeId} onChange={setEmployeeId}
          />
          <Select label="Year" data={YEARS} value={year} onChange={setYear} w={110} allowDeselect={false} />
          {isHr && employeeId && (
            <Button variant="light" mt={25} onClick={() => openEdit()} disabled={types.length === 0}>
              Set a balance
            </Button>
          )}
        </Group>

        {error ? (
          <ErrorCard message={error} onRetry={() => void load()} retrying={loading} />
        ) : !employeeId ? (
          <Center py={48}>
            <Stack gap={6} align="center">
              <IconUserSearch size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
              <Text size="sm" c="sand.6" mt={4}>Choose an employee to see their balances.</Text>
            </Stack>
          </Center>
        ) : (
          <>
            <Table.ScrollContainer minWidth={620}>
              <Table verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Leave type</Table.Th>
                    <Table.Th w={90}>Accrued</Table.Th>
                    <Table.Th w={110}>Carried over</Table.Th>
                    <Table.Th w={80}>Used</Table.Th>
                    <Table.Th w={110}>Available</Table.Th>
                    {isHr && <Table.Th w={80} />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {loading && Array.from({ length: 3 }, (_, i) => (
                    <Table.Tr key={`s${i}`}>
                      <Table.Td colSpan={isHr ? 6 : 5}><Skeleton h={14} radius="sm" /></Table.Td>
                    </Table.Tr>
                  ))}
                  {!loading && rows?.map((b) => (
                    <Table.Tr key={b.id}>
                      <Table.Td>
                        <Text size="sm" fw={600}>{b.leaveTypeName ?? '—'}</Text>
                        {b.carryOverExpiresOn && b.expiringDays > 0 && (
                          <Text size="xs" c="amber.7">
                            {b.expiringDays} day{b.expiringDays === 1 ? '' : 's'} expire on {b.carryOverExpiresOn}
                          </Text>
                        )}
                        {b.expiredDays > 0 && (
                          <Text size="xs" c="sand.6">{b.expiredDays} lapsed unused</Text>
                        )}
                      </Table.Td>
                      <Table.Td><Text size="sm">{b.accruedDays}</Text></Table.Td>
                      <Table.Td><Text size="sm">{b.carriedOverDays}</Text></Table.Td>
                      <Table.Td><Text size="sm">{b.usedDays}</Text></Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={b.availableDays > 0 ? 'brand' : 'sand'}>
                          {b.availableDays}
                        </Badge>
                      </Table.Td>
                      {isHr && (
                        <Table.Td>
                          <Button size="compact-sm" variant="subtle" onClick={() => openEdit(b)}>Edit</Button>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>

            {!loading && rows?.length === 0 && (
              <Center py={40}>
                <Stack gap={6} align="center">
                  <IconWallet size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
                  <Text fw={600} mt={4}>No balances for {year}</Text>
                  <Text size="sm" c="sand.6" maw={430} ta="center">
                    This person has nothing to book against yet. Run accrual to grant what they&apos;ve
                    earned, or set a balance by hand.
                  </Text>
                </Stack>
              </Center>
            )}
          </>
        )}
      </Card>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Set a leave balance" centered>
        <Stack gap="md">
          <Select
            label="Leave type" placeholder="Choose a type" searchable withAsterisk
            data={types.map((t) => ({ value: t.id, label: t.name }))}
            value={editType} onChange={setEditType}
          />
          <TextInput label="Year" value={year ?? ''} disabled />
          <NumberInput
            label="Accrued days" min={0} step={0.5} decimalScale={2} allowNegative={false}
            description="What they have earned this year"
            value={accrued} onChange={setAccrued}
          />
          <NumberInput
            label="Carried over days" min={0} step={0.5} decimalScale={2} allowNegative={false}
            description="Brought in from last year"
            value={carried} onChange={setCarried}
          />
          <Text size="xs" c="sand.6">
            Days used can&apos;t be set here — that figure only moves when a leave request is
            approved, so it always matches the record.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} disabled={!editType} onClick={() => void save()}>Save balance</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
