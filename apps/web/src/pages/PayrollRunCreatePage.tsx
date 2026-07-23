import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Grid, Group, List, MultiSelect, Select, Stack, Switch, Text,
  TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { createPayrollRun, type SkippedEmployee } from '../api/payroll';
import { listEmployees, type EmployeeListRow } from '../api/employees';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

interface FormValues {
  periodMonth: string;
  periodYear: string;
  employeeIds: string[];
  roundNetToShilling: boolean;
}

export function PayrollRunCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowed = canManageEmployees(user?.role);

  const now = new Date();
  const [employees, setEmployees] = useState<EmployeeListRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedEmployee[] | null>(null);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: {
      periodMonth: String(now.getUTCMonth() + 1),
      periodYear: String(now.getUTCFullYear()),
      employeeIds: [],
      roundNetToShilling: false,
    },
    validate: {
      periodMonth: (v) => (v ? null : 'Pick a month'),
      periodYear: (v) => (/^\d{4}$/.test(v) ? null : 'Enter a four-digit year'),
    },
  });

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void (async () => {
      try {
        // A run covers ACTIVE and ON_LEAVE employees — the same set the API
        // targets by default when no employeeIds are sent. Two calls because
        // the list endpoint only accepts a single status filter.
        const [active, onLeave] = await Promise.all([
          listEmployees({ status: 'ACTIVE', pageSize: 100, sort: 'name', order: 'asc' }),
          listEmployees({ status: 'ON_LEAVE', pageSize: 100, sort: 'name', order: 'asc' }),
        ]);
        if (cancelled) return;
        setEmployees([...active.data, ...onLeave.data]);
      } catch {
        // Non-fatal — the multi-select just stays empty and the run defaults
        // to "everyone eligible" if the picker can't be populated.
      }
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const submit = async (v: FormValues) => {
    setSubmitting(true);
    setFormError(null);
    setSkipped(null);
    try {
      const run = await createPayrollRun({
        periodMonth: Number(v.periodMonth),
        periodYear: Number(v.periodYear),
        employeeIds: v.employeeIds.length ? v.employeeIds : undefined,
        roundNetToShilling: v.roundNetToShilling,
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Payroll run created',
        message: `${MONTHS[run.periodMonth - 1]} ${run.periodYear} · ${run.payslipCount} payslip(s)`,
      });
      navigate(`/payroll/${run.id}`, { state: { skipped: run.skipped ?? [] } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.body && typeof e.body === 'object' && 'skipped' in e.body) {
        setSkipped((e.body as { skipped: SkippedEmployee[] }).skipped);
        setFormError(e.message);
      } else if (e instanceof ApiError) {
        setFormError(e.message);
      } else {
        setFormError('The payroll run could not be created. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const back = (
    <Anchor component={Link} to="/payroll" size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to payroll</Group>
    </Anchor>
  );

  const employeeOptions = employees.map((e) => ({
    value: e.id, label: `${e.fullName} · ${e.employeeNumber}`,
  }));

  return (
    <Stack gap="lg">
      {back}

      <div>
        <Title order={1}>New payroll run</Title>
        <Text c="sand.6" mt={4}>
          Computes PAYE, NSSF, SHIF and AHL for the period. Nothing is paid or finalized yet.
        </Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v))}>
        <Stack gap="md">
          {formError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title={skipped ? 'No payslips could be computed' : undefined}>
              <Text size="sm">{formError}</Text>
              {skipped && skipped.length > 0 && (
                <List size="sm" mt="xs">
                  {skipped.map((s) => (
                    <List.Item key={s.employeeId}>{s.employeeNumber} — {s.reason}</List.Item>
                  ))}
                </List>
              )}
            </Alert>
          )}

          <Card p="lg" radius="md">
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Month" data={MONTH_OPTIONS} withAsterisk allowDeselect={false}
                  {...form.getInputProps('periodMonth')}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <TextInput
                  label="Year" inputMode="numeric" withAsterisk
                  {...form.getInputProps('periodYear')}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                <MultiSelect
                  label="Employees" data={employeeOptions} searchable clearable
                  placeholder="All active and on-leave employees with a salary structure"
                  description="Leave empty to run payroll for everyone eligible"
                  {...form.getInputProps('employeeIds')}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                <Switch
                  label="Round net pay to the nearest shilling"
                  {...form.getInputProps('roundNetToShilling', { type: 'checkbox' })}
                />
              </Grid.Col>
            </Grid>
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="sand" component={Link} to="/payroll">Cancel</Button>
            <Button type="submit" loading={submitting}>Create run</Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
