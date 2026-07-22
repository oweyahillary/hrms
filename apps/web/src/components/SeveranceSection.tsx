import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Group, Modal, NumberInput, Select, SimpleGrid, Skeleton, Stack, Table,
  Text, TextInput, ThemeIcon, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconLogout, IconPlus } from '@tabler/icons-react';
import {
  listSeveranceCalculations, createSeveranceCalculation,
  BUCKET_LABEL, EXIT_REASON_OPTIONS, PAY_FREQUENCY_OPTIONS, CONTRACT_TERM_OPTIONS,
  type SeveranceCalculation, type ContractTermType,
} from '../api/severance';
import { ApiError } from '../api/client';

const kes = (n: number): string =>
  n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = (): string => new Date().toISOString().slice(0, 10);

interface FormValues {
  exitDate: string;
  reason: string;
  payFrequency: string;
  contractualNoticeDays: number | string;
  contractTermType: string;
  unexpiredTermMonths: number | string;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="sand.6" tt="uppercase" fw={600} style={{ letterSpacing: '0.04em' }}>{label}</Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

export function SeveranceSection({
  employeeId, canEdit, hasExited, defaultExitDate,
}: { employeeId: string; canEdit: boolean; hasExited: boolean; defaultExitDate?: string | null }) {
  const [history, setHistory] = useState<SeveranceCalculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // A completed calculation is shown as a prominent result, not just a toast —
  // the entitlement and its provisional PAYE need to be seen, not skimmed.
  const [result, setResult] = useState<SeveranceCalculation | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      exitDate: defaultExitDate ?? today(),
      reason: 'REDUNDANCY',
      payFrequency: 'MONTHLY',
      contractualNoticeDays: '',
      contractTermType: '',
      unexpiredTermMonths: '',
    },
    validate: {
      exitDate: (v) => (v ? null : 'Pick an exit date'),
      reason: (v) => (v ? null : 'Select an exit reason'),
      payFrequency: (v) => (v ? null : 'Select a pay frequency'),
      contractTermType: (v) => (v ? null : 'Select the contract classification'),
      unexpiredTermMonths: (v, values) =>
        values.contractTermType === 'FIXED_TERM'
          ? (Number(v) >= 1 ? null : 'Required for a fixed-term contract')
          : null,
    },
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setHistory(await listSeveranceCalculations(employeeId));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to view severance calculations.'
        : 'Could not load severance calculations.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  const openModal = () => {
    setResult(null);
    form.setValues({
      exitDate: defaultExitDate ?? today(),
      reason: 'REDUNDANCY',
      payFrequency: 'MONTHLY',
      contractualNoticeDays: '',
      contractTermType: '',
      unexpiredTermMonths: '',
    });
    form.resetDirty();
    setOpen(true);
  };

  const closeModal = () => { setOpen(false); setResult(null); form.reset(); };

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      const calc = await createSeveranceCalculation(employeeId, {
        reason: values.reason,
        exitDate: values.exitDate,
        payFrequency: values.payFrequency,
        contractualNoticeDays: values.contractualNoticeDays === '' ? undefined : Number(values.contractualNoticeDays),
        contractTermType: values.contractTermType as ContractTermType,
        unexpiredTermMonths: values.contractTermType === 'FIXED_TERM' ? Number(values.unexpiredTermMonths) : undefined,
      });
      setResult(calc);
      await load();
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Severance calculated',
        message: 'The calculation has been recorded.',
      });
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not calculate severance',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const b = result?.calculationBreakdown;
  const resultPayeStatus = b?.paye?.status;

  return (
    <Card p="lg" radius="md">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs">
          <ThemeIcon size={28} radius="md" variant="light" color="sand">
            <IconLogout size={16} stroke={1.7} />
          </ThemeIcon>
          <Title order={3}>Severance</Title>
        </Group>
        {canEdit && (
          <Button size="compact-sm" variant={hasExited || history.length > 0 ? 'filled' : 'default'}
            leftSection={<IconPlus size={14} />} onClick={openModal} disabled={loading}>
            New calculation
          </Button>
        )}
      </Group>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} mb="md">{error}</Alert>}

      {loading && <Skeleton h={70} radius="sm" />}

      {!loading && !error && (
        history.length === 0 ? (
          <Text c="sand.6" size="sm">
            {hasExited
              ? 'No severance calculation recorded yet.'
              : 'Severance is normally calculated when an employee exits (e.g. redundancy).'}
            {canEdit ? ' Use \u201CNew calculation\u201D to run one.' : ''}
          </Text>
        ) : (
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Exit date</Table.Th>
                <Table.Th>Reason</Table.Th>
                <Table.Th ta="right">Years</Table.Th>
                <Table.Th ta="right">Severance</Table.Th>
                <Table.Th ta="right">Notice pay</Table.Th>
                <Table.Th>Rule</Table.Th>
                <Table.Th>PAYE</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.map((s) => {
                const bd = s.calculationBreakdown;
                const prov = bd.paye?.status === 'PROVISIONAL_UNVERIFIED';
                const bucket = bd.paye?.bucket ?? bd.contractTermType ?? null;
                return (
                  <Table.Tr key={s.id} style={prov ? { background: 'var(--mantine-color-red-0)' } : undefined}>
                    <Table.Td>{s.exitDate.slice(0, 10)}</Table.Td>
                    <Table.Td>{s.reason}</Table.Td>
                    <Table.Td ta="right">{bd.severance?.completedYears ?? '\u2014'}</Table.Td>
                    <Table.Td ta="right">{kes(s.severanceAmount)}</Table.Td>
                    <Table.Td ta="right">{bd.notice?.payInLieu == null ? '\u2014' : kes(bd.notice.payInLieu)}</Table.Td>
                    <Table.Td><Text size="sm">{bucket ? (BUCKET_LABEL[bucket] ?? bucket) : '\u2014'}</Text></Table.Td>
                    <Table.Td>
                      {prov
                        ? <Badge color="red" variant="filled">Provisional</Badge>
                        : <Text size="sm" c="sand.6">{bd.paye?.status ?? '\u2014'}</Text>}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )
      )}

      <Modal opened={open} onClose={closeModal} title={result ? 'Severance calculation' : 'Calculate severance'} centered>
        {result ? (
          <Stack gap="md">
            <div>
              <Text size="xs" tt="uppercase" c="sand.6" fw={600} style={{ letterSpacing: '0.04em' }}>Severance entitlement</Text>
              <Text fw={700} fz={30} lh={1.1}>KES {kes(result.severanceAmount)}</Text>
              {result.reason !== 'REDUNDANCY' && (
                <Text size="xs" c="sand.6" mt={4}>
                  {result.reason} does not attract statutory severance — the entitlement is zero (notice pay still applies).
                </Text>
              )}
            </div>

            <SimpleGrid cols={2}>
              <Stat label="Completed years" value={b?.severance?.completedYears == null ? '\u2014' : String(b.severance.completedYears)} />
              <Stat label="Notice pay in lieu" value={`KES ${kes(b?.notice?.payInLieu ?? 0)}`} />
            </SimpleGrid>

            {/* PAYE — deliberately in the same red "provisional" treatment used in the
                severance register, so it never reads as confidently as the entitlement. */}
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} title="PAYE — provisional, not verified">
              <Text size="sm">
                {resultPayeStatus === 'PROVISIONAL_UNVERIFIED'
                  ? `Provisional PAYE of KES ${kes(b?.paye?.paye ?? 0)}, spread as `
                    + `${b?.paye?.bucket ? (BUCKET_LABEL[b.paye.bucket] ?? b.paye.bucket) : '\u2014'} `
                    + `over ${b?.paye?.periods ?? '\u2014'} month(s).`
                  : resultPayeStatus === 'UNAVAILABLE'
                    ? 'PAYE was not computed \u2014 no statutory rate is in force for this exit date.'
                    : resultPayeStatus === 'N/A'
                      ? 'No severance amount, so no PAYE.'
                      : `PAYE status: ${resultPayeStatus ?? 'unknown'}.`}
              </Text>
              <Text size="xs" mt={6}>
                Severance lump-sum tax treatment is not confirmed. Do not rely on this PAYE figure without KRA guidance.
              </Text>
            </Alert>

            <Group justify="flex-end">
              <Button onClick={closeModal}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <form onSubmit={form.onSubmit((v) => void submit(v))}>
            <Stack gap="md">
              <TextInput label="Exit date" type="date" withAsterisk {...form.getInputProps('exitDate')} />
              <Select
                label="Exit reason" withAsterisk allowDeselect={false} data={EXIT_REASON_OPTIONS}
                {...form.getInputProps('reason')}
              />
              {form.values.reason !== '' && form.values.reason !== 'REDUNDANCY' && (
                <Text size="xs" c="sand.6">
                  Only redundancy attracts statutory severance; this reason calculates to a zero severance amount
                  (notice pay still applies).
                </Text>
              )}
              <Select
                label="Pay frequency" withAsterisk allowDeselect={false} data={PAY_FREQUENCY_OPTIONS}
                {...form.getInputProps('payFrequency')}
              />
              <NumberInput
                label="Contractual notice days"
                description="Optional — used only if it exceeds the statutory minimum"
                min={0} allowDecimal={false} {...form.getInputProps('contractualNoticeDays')}
              />
              <Select
                label="Contract classification (for PAYE spreading)" withAsterisk
                placeholder="Select a classification" data={CONTRACT_TERM_OPTIONS}
                {...form.getInputProps('contractTermType')}
              />
              {form.values.contractTermType === 'FIXED_TERM' && (
                <NumberInput
                  label="Unexpired term (months)" withAsterisk min={1} allowDecimal={false}
                  description="The lump sum is spread over this many months"
                  {...form.getInputProps('unexpiredTermMonths')}
                />
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={closeModal}>Cancel</Button>
                <Button type="submit" loading={saving}>Calculate</Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
    </Card>
  );
}
