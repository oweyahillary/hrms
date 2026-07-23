import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Anchor, Button, Card, Group, NumberInput, Select, Stack, Switch, Text, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import {
  createPayrollAdjustment, ADJUSTMENT_TYPES, type AdjustmentType,
} from '../api/payrollAdjustments';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';

interface FormValues {
  employeeId: string;
  type: AdjustmentType;
  amount: number | string;
  isTaxable: boolean;
  targetPeriodMonth: number | string;
  targetPeriodYear: number | string;
  reason: string;
}

export function AdjustmentCreatePage() {
  const navigate = useNavigate();
  const now = new Date();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: {
      employeeId: '', type: 'DEDUCTION', amount: '', isTaxable: true,
      targetPeriodMonth: now.getMonth() + 1, targetPeriodYear: now.getFullYear(), reason: '',
    },
    validate: {
      employeeId: (v) => (v ? null : 'Choose an employee'),
      amount: (v) => (Number(v) > 0 ? null : 'Enter an amount'),
      targetPeriodMonth: (v) => (Number(v) >= 1 && Number(v) <= 12 ? null : 'Month 1\u201312'),
      targetPeriodYear: (v) => (Number(v) >= 2000 && Number(v) <= 2100 ? null : 'Enter a valid year'),
      reason: (v) => (v.trim() ? null : 'A reason is required'),
    },
  });

  useEffect(() => {
    void loadEmployeeOptions()
      .then(setEmployees)
      .catch(() => notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not load employees',
        message: 'The employee list failed to load; you can retry by reopening this page.',
      }));
  }, []);

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      await createPayrollAdjustment(values.employeeId, {
        type: values.type,
        amount: Number(values.amount),
        isTaxable: values.type === 'BONUS' ? values.isTaxable : undefined,
        targetPeriodMonth: Number(values.targetPeriodMonth),
        targetPeriodYear: Number(values.targetPeriodYear),
        reason: values.reason.trim(),
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Adjustment added',
        message: 'It will apply when that period\u2019s payroll run is created.',
      });
      navigate('/payroll/setup/deductions');
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not add adjustment',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={620}>
      <Anchor component={RouterLink} to="/payroll/setup/deductions" size="sm" c="sand.6">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={15} /> Back to deductions</Group>
      </Anchor>

      <div>
        <Title order={2}>New adjustment</Title>
        <Text c="sand.6" size="sm" mt={2}>
          A one-off bonus or deduction applied to a specific payroll period. Each needs a recorded reason.
        </Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v))}>
        <Card p="lg" radius="md" withBorder>
          <Stack gap="md">
            <Select
              label="Employee" placeholder="Choose an employee" searchable withAsterisk
              data={employees} {...form.getInputProps('employeeId')}
            />
            <Select
              label="Type" withAsterisk allowDeselect={false}
              data={ADJUSTMENT_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))}
              value={form.values.type}
              onChange={(v) => form.setFieldValue('type', (v as AdjustmentType) ?? 'DEDUCTION')}
            />
            <NumberInput
              label="Amount (KES)" withAsterisk min={1} thousandSeparator=","
              {...form.getInputProps('amount')}
            />
            {form.values.type === 'BONUS' && (
              <Switch
                label="Taxable (folds into the PAYE base)"
                checked={form.values.isTaxable}
                onChange={(e) => form.setFieldValue('isTaxable', e.currentTarget.checked)}
              />
            )}
            <Group grow align="flex-start">
              <NumberInput label="Target month" withAsterisk min={1} max={12} allowDecimal={false} {...form.getInputProps('targetPeriodMonth')} />
              <NumberInput label="Target year" withAsterisk min={2000} max={2100} allowDecimal={false} {...form.getInputProps('targetPeriodYear')} />
            </Group>
            <Textarea
              label="Reason" withAsterisk autosize minRows={2}
              placeholder="Why this adjustment is being applied"
              {...form.getInputProps('reason')}
            />

            <Group justify="flex-end" mt="sm">
              <Button variant="default" component={RouterLink} to="/payroll/setup/deductions">Cancel</Button>
              <Button type="submit" loading={saving}>Create</Button>
            </Group>
          </Stack>
        </Card>
      </form>
    </Stack>
  );
}
