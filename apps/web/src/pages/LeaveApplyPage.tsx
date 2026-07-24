import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Badge, Button, Card, Grid, Group, MultiSelect, Select, Stack, Text, Textarea,
  TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowLeft, IconCheck, IconInfoCircle, IconUserCheck,
} from '@tabler/icons-react';
import {
  createLeaveRequest, getApprovers, getApproversFor, getLeaveBalances, getLeaveTypes,
  getPublicHolidays, type Approver, type ApproversFor, type LeaveBalance, type LeaveType,
} from '../api/leave';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { getMyProfile } from '../api/self-service';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../auth/permissions';
import { countWorkingDays, parseDateInput } from '../validation/leave-days';

interface FormValues {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  approverUserIds: string[];
}

export function LeaveApplyPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHr = hasPermission(user?.permissions, 'leave.manage');

  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [chain, setChain] = useState<ApproversFor | null>(null);
  const [pickable, setPickable] = useState<Approver[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      employeeId: '', leaveTypeId: '', startDate: '', endDate: '', reason: '', approverUserIds: [],
    },
    validateInputOnBlur: true,
    validate: {
      employeeId: (v) => (v ? null : 'Choose an employee'),
      leaveTypeId: (v) => (v ? null : 'Choose a leave type'),
      startDate: (v) => (v ? null : 'Pick a start date'),
      endDate: (v, values) => {
        if (!v) return 'Pick an end date';
        if (values.startDate && v < values.startDate) return 'The end date is before the start date';
        return null;
      },
      approverUserIds: (v, values) =>
        (chain?.employeeMayChoose && values.employeeId && v.length === 0)
          ? 'Choose at least one approver' : null,
    },
  });

  const { employeeId, leaveTypeId, startDate, endDate } = form.values;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Non-HR applicants have no employee picker (below), so there's
        // nothing else to ever set form.values.employeeId — without this,
        // the field stays '' forever and the form can never validate.
        // The picker itself is independent of leave types loading: a
        // leave.manage holder without employees.view (narrower than any
        // shipped template) still gets a working form, just an empty picker.
        const [emps, tps, mine] = await Promise.all([
          isHr
            ? listEmployees({ status: 'ACTIVE', pageSize: 100, sort: 'name', order: 'asc' }).catch(() => ({ data: [] as EmployeeListRow[] }))
            : Promise.resolve({ data: [] as EmployeeListRow[] }),
          getLeaveTypes(),
          isHr ? Promise.resolve(null) : getMyProfile(),
        ]);
        if (cancelled) return;
        setEmployees(emps.data);
        setTypes(tps);
        if (mine) form.setFieldValue('employeeId', mine.id);
      } catch (e) {
        if (!cancelled) {
          setFormError(e instanceof ApiError && e.status === 403
            ? 'Your role cannot apply for leave here.'
            : 'The form could not load. Check your connection and try again.');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHr]);

  // Who approves is a property of the EMPLOYEE and the org's policy — not
  // something the applicant picks. Resolve it as soon as we know who it's for.
  useEffect(() => {
    if (!employeeId) { setChain(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const c = await getApproversFor(employeeId);
        if (cancelled) return;
        setChain(c);
        // Only fetch the picker list if this org actually allows choosing.
        if (c.employeeMayChoose && pickable.length === 0) {
          const list = await getApprovers();
          if (!cancelled) setPickable(list);
        }
      } catch {
        if (!cancelled) setChain(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    const d = parseDateInput(startDate);
    if (!d) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getPublicHolidays(d.getUTCFullYear());
        if (!cancelled) setHolidays(new Set(rows.map((h) => h.date.slice(0, 10))));
      } catch {
        // Non-fatal: the preview may over-count, but the SERVER recomputes with
        // the true holiday list and its number is the one that's stored.
      }
    })();
    return () => { cancelled = true; };
  }, [startDate]);

  // Balances load on the EMPLOYEE, not on the dates — so picking a leave type
  // shows the balance straight away rather than waiting for a start date.
  const balanceYear = useMemo(
    () => parseDateInput(startDate)?.getUTCFullYear() ?? new Date().getUTCFullYear(),
    [startDate],
  );
  useEffect(() => {
    if (!employeeId) { setBalances(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getLeaveBalances(employeeId, balanceYear);
        if (!cancelled) setBalances(rows);
      } catch {
        if (!cancelled) setBalances([]);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId, balanceYear]);

  const workingDays = useMemo(() => {
    const s = parseDateInput(startDate);
    const e = parseDateInput(endDate);
    if (!s || !e) return null;
    return countWorkingDays(s, e, holidays);
  }, [startDate, endDate, holidays]);

  const balance = useMemo(
    () => balances?.find((b) => b.leaveTypeId === leaveTypeId) ?? null,
    [balances, leaveTypeId],
  );
  /** Loaded, but this employee has no balance row for this type. */
  const noBalanceRow = Boolean(employeeId && leaveTypeId && balances !== null && !balance);
  const tooMany = balance != null && workingDays != null && workingDays > balance.availableDays;

  const submit = async (v: FormValues) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await createLeaveRequest({
        employeeId: v.employeeId,
        leaveTypeId: v.leaveTypeId,
        startDate: v.startDate,
        endDate: v.endDate,
        reason: v.reason.trim() || undefined,
        ...(chain?.employeeMayChoose ? { approverUserIds: v.approverUserIds } : {}),
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Leave requested', message: 'It is now waiting for approval.',
      });
      navigate('/leave');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'The request could not be submitted. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const back = (
    <Anchor component={Link} to="/leave" size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to leave</Group>
    </Anchor>
  );

  const employeeOptions = employees.map((e) => ({
    value: e.id, label: `${e.fullName} · ${e.employeeNumber}`,
  }));
  const typeOptions = types.map((t) => ({ value: t.id, label: t.name }));

  const summary = (
    <Card p="md" radius="md" withBorder bg="sand.0">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs">
          <IconInfoCircle size={16} />
          <Text size="sm">
            {workingDays != null
              ? <>This request is <Text span fw={700}>{workingDays} working day{workingDays === 1 ? '' : 's'}</Text></>
              : 'Pick both dates to see the number of working days'}
          </Text>
        </Group>

        {balance && (
          <Group gap="xs">
            <Badge variant="light" color={tooMany ? 'red' : 'brand'} size="lg">
              {balance.availableDays} day{balance.availableDays === 1 ? '' : 's'} available
            </Badge>
            {balance.expiringDays > 0 && balance.carryOverExpiresOn && (
              <Badge variant="light" color="amber">
                {balance.expiringDays} expire on {balance.carryOverExpiresOn}
              </Badge>
            )}
          </Group>
        )}
      </Group>

      {balance && (
        <Text size="xs" c="sand.6" mt={6}>
          {balance.accruedDays} accrued
          {balance.carriedOverDays > 0 ? ` · ${balance.carriedOverDays} carried over` : ''}
          {' · '}{balance.usedDays} used{' · '}{balanceYear}
        </Text>
      )}

      {/* Silence here would read as "zero days" — say what's actually true. */}
      {noBalanceRow && (
        <Text size="sm" c="amber.7" mt={6}>
          No {balanceYear} balance is set up for this leave type, so there are no days to draw on.
          HR needs to add one before this can be approved.
        </Text>
      )}
      {!employeeId && (
        <Text size="xs" c="sand.6" mt={6}>Choose an employee to see their balance.</Text>
      )}
      {employeeId && !leaveTypeId && (
        <Text size="xs" c="sand.6" mt={6}>Choose a leave type to see the balance.</Text>
      )}

      {workingDays === 0 && (
        <Text size="sm" c="red" mt={6}>
          Those dates contain no working days — they may all be weekends or public holidays.
        </Text>
      )}
      {tooMany && (
        <Text size="sm" c="red" mt={6}>
          That is more than the {balance?.availableDays} day(s) available.
        </Text>
      )}
    </Card>
  );

  return (
    <Stack gap="lg">
      {back}

      <div>
        <Title order={1}>Apply for leave</Title>
        <Text c="sand.6" mt={4}>Weekends and public holidays don&apos;t count against the balance</Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v))}>
        <Stack gap="md">
          {formError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{formError}</Alert>
          )}

          <Card p="lg" radius="md">
            <Grid gutter="md">
              {isHr && (
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Select
                    label="Employee" data={employeeOptions} placeholder="Choose a person"
                    searchable withAsterisk {...form.getInputProps('employeeId')}
                  />
                </Grid.Col>
              )}
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Leave type" data={typeOptions} placeholder="Choose a type"
                  searchable withAsterisk {...form.getInputProps('leaveTypeId')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="First day" type="date" withAsterisk {...form.getInputProps('startDate')} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput label="Last day" type="date" withAsterisk {...form.getInputProps('endDate')} />
              </Grid.Col>

              {/* Directly under the dates: the cost and the balance belong where
                  the decision is made, not at the bottom of the page. */}
              <Grid.Col span={12}>{summary}</Grid.Col>

              <Grid.Col span={12}>
                <Textarea
                  label="Reason" autosize minRows={2} maxLength={500}
                  placeholder="Optional — a short note for whoever approves this"
                  {...form.getInputProps('reason')}
                />
              </Grid.Col>
            </Grid>
          </Card>

          <Card p="lg" radius="md">
            <Group gap="xs" mb={4}>
              <IconUserCheck size={18} />
              <Title order={4}>Who approves this</Title>
            </Group>

            {!employeeId && (
              <Text size="sm" c="sand.6">Choose an employee and this is worked out automatically.</Text>
            )}

            {employeeId && chain?.employeeMayChoose && (
              <>
                <Text size="sm" c="sand.6" mb="sm">
                  This organisation lets employees choose their own approvers.
                </Text>
                <MultiSelect
                  data={pickable.map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))}
                  searchable withAsterisk description="They approve in the order listed"
                  placeholder={pickable.length ? 'Choose who approves this' : 'No approvers available'}
                  {...form.getInputProps('approverUserIds')}
                />
              </>
            )}

            {employeeId && chain && !chain.employeeMayChoose && (
              <>
                <Text size="sm" c="sand.7">{chain.explanation}</Text>
                {chain.unresolved ? (
                  <Alert
                    color="amber" variant="light" mt="sm" icon={<IconAlertTriangle size={16} />}
                    title="No approver is set up"
                  >
                    Nobody can approve this yet. An administrator needs to choose an HR approver in
                    Settings, or give this department a head who has a login.
                  </Alert>
                ) : (
                  <Stack gap={6} mt="sm">
                    {chain.approvers.map((a) => (
                      <Group key={a.userId} gap="xs">
                        <Badge variant="light" color="sand" size="sm">Step {a.step}</Badge>
                        <Text size="sm" fw={600}>{a.name}</Text>
                        <Text size="sm" c="sand.6">· {a.role}</Text>
                      </Group>
                    ))}
                  </Stack>
                )}
              </>
            )}
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" component={Link} to="/leave">Cancel</Button>
            <Button type="submit" loading={submitting} disabled={chain?.unresolved === true}>
              Submit request
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
