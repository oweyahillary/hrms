import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Grid, Group, NumberInput, SimpleGrid, Stack, Text, TextInput,
  ThemeIcon, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconArrowLeft, IconCalculator, IconWallet } from '@tabler/icons-react';
import { previewPayroll, type PreviewPayrollResult } from '../api/payroll';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';

interface FormValues {
  grossPay: number | '';
  pensionablePay: number | '';
  asOf: string;
}

function fmtKES(n: number): string {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Group justify="space-between">
      <Text size="sm" c="sand.6">{label}</Text>
      <Text size="sm" fw={strong ? 700 : 500}>{value}</Text>
    </Group>
  );
}

export function PayrollPreviewPage() {
  const { user } = useAuth();
  const allowed = canManageEmployees(user?.role);

  const [result, setResult] = useState<PreviewPayrollResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: { grossPay: '', pensionablePay: '', asOf: '' },
    validate: {
      grossPay: (v) => (typeof v === 'number' && v >= 0 ? null : 'Enter a gross pay amount'),
    },
  });

  const submit = async (v: FormValues) => {
    setComputing(true);
    setFormError(null);
    try {
      const res = await previewPayroll({
        grossPay: Number(v.grossPay),
        pensionablePay: v.pensionablePay === '' ? undefined : Number(v.pensionablePay),
        asOf: v.asOf || undefined,
      });
      setResult(res);
    } catch (e) {
      setResult(null);
      setFormError(e instanceof ApiError ? e.message : 'The preview could not be computed. Try again.');
    } finally {
      setComputing(false);
    }
  };

  const back = (
    <Anchor component={Link} to="/payroll" size="sm" c="sand.6">
      <Group gap={4}><IconArrowLeft size={14} /> Back to payroll</Group>
    </Anchor>
  );

  if (!allowed) {
    return (
      <Stack gap="lg">
        {back}
        <Card p="xl" radius="md">
          <Title order={3}>You can&apos;t use the preview calculator</Title>
          <Text c="sand.6" mt="xs">This needs an HR role. Ask an administrator for access.</Text>
        </Card>
      </Stack>
    );
  }

  const b = result?.breakdown;

  return (
    <Stack gap="lg">
      {back}

      <div>
        <Title order={1}>Preview calculator</Title>
        <Text c="sand.6" mt={4}>
          A stand-alone statutory breakdown for one gross figure — nothing is saved or linked to an
          employee or run.
        </Text>
      </div>

      <form onSubmit={form.onSubmit((v) => void submit(v))}>
        <Card p="lg" radius="md">
          <Grid gutter="md" align="flex-end">
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <NumberInput
                label="Gross pay" placeholder="e.g. 80000" min={0} withAsterisk
                thousandSeparator="," prefix="KES " decimalScale={2}
                {...form.getInputProps('grossPay')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <NumberInput
                label="Pensionable pay" placeholder="Defaults to gross pay" min={0}
                thousandSeparator="," prefix="KES " decimalScale={2}
                {...form.getInputProps('pensionablePay')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="As of" type="date" description="Defaults to today's statutory rates"
                {...form.getInputProps('asOf')}
              />
            </Grid.Col>
          </Grid>
          <Group justify="flex-end" mt="md">
            <Button type="submit" leftSection={<IconCalculator size={16} />} loading={computing}>Calculate</Button>
          </Group>
        </Card>
      </form>

      {formError && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{formError}</Alert>
      )}

      {b && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card p="lg" radius="md">
            <Group gap="xs" mb="md">
              <ThemeIcon size={28} radius="md" variant="light" color="brand">
                <IconWallet size={16} stroke={1.7} />
              </ThemeIcon>
              <Title order={3}>Net pay</Title>
            </Group>
            <Stack gap={6}>
              <Row label="Gross pay" value={fmtKES(b.grossPay)} />
              <Row label="Pensionable pay" value={fmtKES(b.pensionablePay)} />
              <Row label="Total employee deductions" value={fmtKES(b.totalEmployeeDeductions)} />
              <Row label="Net pay" value={fmtKES(b.netPay)} strong />
              <Text size="xs" c="sand.5" mt={4}>Statutory rates as of {result?.asOf}</Text>
            </Stack>
          </Card>

          <Card p="lg" radius="md">
            <Title order={3} mb="md">Deductions breakdown</Title>
            <Stack gap={6}>
              <Row label="NSSF — Tier I" value={fmtKES(b.nssf.tierI)} />
              <Row label="NSSF — Tier II" value={fmtKES(b.nssf.tierII)} />
              <Row label="NSSF — employee total" value={fmtKES(b.nssf.employee)} />
              <Row label="SHIF" value={fmtKES(b.shif)} />
              <Row label="AHL" value={fmtKES(b.ahl)} />
              <Row label="Taxable pay" value={fmtKES(b.taxablePay)} />
              <Row label="PAYE before relief" value={fmtKES(b.payeBeforeRelief)} />
              <Row label="Personal relief" value={fmtKES(b.personalRelief)} />
              <Row label="PAYE" value={fmtKES(b.paye)} strong />
              <Text size="xs" c="sand.5" mt={4}>
                Employer cost: NSSF {fmtKES(b.employerCost.nssf)} · AHL {fmtKES(b.employerCost.ahl)}
              </Text>
            </Stack>
          </Card>
        </SimpleGrid>
      )}
    </Stack>
  );
}
