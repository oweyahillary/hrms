import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Group, NumberInput, Select, Stack, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck } from '@tabler/icons-react';
import { createLoan, LOAN_TYPES, type LoanType } from '../api/loans';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';

interface FormValues {
  employeeId: string;
  type: LoanType;
  principal: number | string;
  interestRate: number | string;
  numberOfInstallments: number | string;
  disbursedDate: string;
  reason: string;
}

export function LoanCreatePage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [saving, setSaving] = useState(false);
  // A rejected ADVANCE (over the two-month cap) is a domain error, not a field
  // error — surface the server's exact message rather than a bare 400.
  const [capError, setCapError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      employeeId: '', type: 'LOAN', principal: '', interestRate: 0,
      numberOfInstallments: 3, disbursedDate: new Date().toISOString().slice(0, 10), reason: '',
    },
    validate: {
      employeeId: (v) => (v ? null : 'Choose an employee'),
      principal: (v) => (Number(v) > 0 ? null : 'Enter a principal amount'),
      numberOfInstallments: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? null : 'At least one installment'),
      disbursedDate: (v) => (v ? null : 'Pick a disbursement date'),
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
    setSaving(true); setCapError(null);
    try {
      const loan = await createLoan(values.employeeId, {
        type: values.type,
        principal: Number(values.principal),
        interestRate: Number(values.interestRate) || 0,
        numberOfInstallments: Number(values.numberOfInstallments),
        disbursedDate: values.disbursedDate,
        reason: values.reason.trim(),
      });
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: `${loan.type === 'ADVANCE' ? 'Advance' : 'Loan'} created`,
        message: `Installment of KES ${loan.installmentAmount.toLocaleString('en-KE')} over ${loan.numberOfInstallments} run(s).`,
      });
      navigate('/payroll/setup/loans');
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // Most commonly the §19 two-month advance cap. Show the server's message
        // verbatim so the officer sees the actual limit and requested amount.
        setCapError(e.message);
      } else {
        notifications.show({
          color: 'red', icon: <IconAlertTriangle size={16} />,
          title: 'Could not create',
          message: e instanceof ApiError ? e.message : 'Something went wrong creating the loan.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={620}>
      <Anchor component={RouterLink} to="/payroll/setup/loans" size="sm" c="sand.6">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={15} /> Back to loans</Group>
      </Anchor>

      <div>
        <Title order={2}>New loan / advance</Title>
        <Text c="sand.6" size="sm" mt={2}>
          A loan or advance is repaid over one or more payroll runs. An advance may not exceed
          two months&apos; basic salary.
        </Text>
      </div>

      {capError && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="Advance not allowed">
          {capError}
        </Alert>
      )}

      <form onSubmit={form.onSubmit((v) => void submit(v))}>
        <Card p="lg" radius="md" withBorder>
          <Stack gap="md">
            <Select
              label="Employee" placeholder="Choose an employee" searchable withAsterisk
              data={employees} {...form.getInputProps('employeeId')}
            />
            <Select
              label="Type" withAsterisk allowDeselect={false}
              data={LOAN_TYPES.map((t) => ({ value: t, label: t === 'ADVANCE' ? 'Salary advance' : 'Loan' }))}
              value={form.values.type}
              onChange={(v) => form.setFieldValue('type', (v as LoanType) ?? 'LOAN')}
            />
            <Group grow align="flex-start">
              <NumberInput
                label="Principal (KES)" withAsterisk min={1} thousandSeparator=","
                {...form.getInputProps('principal')}
              />
              <NumberInput
                label="Interest rate (%)"
                description="Flat, one-time % of principal"
                min={0} {...form.getInputProps('interestRate')}
              />
            </Group>
            <Group grow align="flex-start">
              <NumberInput
                label="Number of installments" withAsterisk min={1} allowDecimal={false}
                {...form.getInputProps('numberOfInstallments')}
              />
              <TextInput
                label="Disbursement date" type="date" withAsterisk
                {...form.getInputProps('disbursedDate')}
              />
            </Group>
            <Textarea
              label="Reason" withAsterisk autosize minRows={2}
              placeholder="Why this loan/advance is being issued"
              {...form.getInputProps('reason')}
            />

            {form.values.type === 'ADVANCE' && (
              <Text size="xs" c="sand.6">
                Advances are capped at two months&apos; basic salary; an over-limit request is rejected, not clamped.
              </Text>
            )}

            <Group justify="flex-end" mt="sm">
              <Button variant="default" component={RouterLink} to="/payroll/setup/loans">Cancel</Button>
              <Button type="submit" loading={saving}>Create</Button>
            </Group>
          </Stack>
        </Card>
      </form>
    </Stack>
  );
}
