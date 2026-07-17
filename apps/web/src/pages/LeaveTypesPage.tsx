import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Anchor, Badge, Button, Card, Center, Group, Modal, NumberInput, Select, Skeleton, Stack, Switch,
  Table, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCalendarTime, IconCheck, IconPlus } from '@tabler/icons-react';
import {
  createLeaveType, getLeaveTypes, updateLeaveType, type LeaveType,
} from '../api/leave';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees } from '../auth/roles';

const ACCRUAL_OPTIONS = [
  { value: 'NONE', label: "Doesn't accrue — set by hand" },
  { value: 'UPFRONT', label: 'Up front — the whole year at once' },
  { value: 'MONTHLY', label: 'Monthly — a twelfth each month' },
  { value: 'DAILY', label: 'Daily — day by day' },
];

const ACCRUAL_LABEL: Record<string, string> = {
  NONE: 'By hand', UPFRONT: 'Up front', MONTHLY: 'Monthly', DAILY: 'Daily',
};

interface FormValues {
  name: string;
  isPaid: boolean;
  requiresApproval: boolean;
  accrualMethod: string;
  annualDays: number | string;
  carryOverMax: number | string;
  carryOverExpiryMonths: number | string;
  carryOverUnlimited: boolean;
  carryOverNeverExpires: boolean;
}

export function LeaveTypesPage() {
  const { user } = useAuth();
  const isHr = canManageEmployees(user?.role);

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      name: '', isPaid: true, requiresApproval: true, accrualMethod: 'MONTHLY',
      annualDays: 21, carryOverMax: 5, carryOverExpiryMonths: 3,
      carryOverUnlimited: false, carryOverNeverExpires: false,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Give this leave type a name'),
      annualDays: (v, vals) =>
        (vals.accrualMethod !== 'NONE' && !(Number(v) > 0))
          ? 'An accruing type needs an annual entitlement' : null,
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTypes(await getLeaveTypes());
    } catch {
      setTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    form.setValues({
      name: '', isPaid: true, requiresApproval: true, accrualMethod: 'MONTHLY',
      annualDays: 21, carryOverMax: 5, carryOverExpiryMonths: 3,
      carryOverUnlimited: false, carryOverNeverExpires: false,
    });
    setOpen(true);
  };

  const openEdit = (t: LeaveType) => {
    setEditing(t);
    form.setValues({
      name: t.name,
      isPaid: t.isPaid,
      requiresApproval: t.requiresApproval,
      accrualMethod: t.accrualMethod,
      annualDays: t.annualDays ?? 0,
      // null means unlimited / never — the toggles carry that, not a number.
      carryOverMax: t.carryOverMax ?? 0,
      carryOverExpiryMonths: t.carryOverExpiryMonths ?? 0,
      carryOverUnlimited: t.carryOverMax === null,
      carryOverNeverExpires: t.carryOverExpiryMonths === null,
    });
    setOpen(true);
  };

  const save = async (v: FormValues) => {
    setSaving(true);
    try {
      // The API takes undefined for "unlimited"/"never", not a number.
      const payload = {
        name: v.name.trim(),
        isPaid: v.isPaid,
        requiresApproval: v.requiresApproval,
        accrualMethod: v.accrualMethod,
        annualDays: v.accrualMethod === 'NONE' ? undefined : Number(v.annualDays),
        carryOverMax: v.carryOverUnlimited ? undefined : Number(v.carryOverMax),
        carryOverExpiryMonths: v.carryOverNeverExpires ? undefined : Number(v.carryOverExpiryMonths),
      };
      if (editing) await updateLeaveType(editing.id, payload);
      else await createLeaveType(payload);
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: editing ? 'Leave type updated' : 'Leave type created', message: v.name.trim(),
      });
      setOpen(false);
      await load();
    } catch (e) {
      notifications.show({
        color: 'red', title: 'Could not save',
        message: e instanceof ApiError ? e.message : 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const carryText = (t: LeaveType): string => {
    if (t.carryOverMax === 0) return 'None carries over';
    const cap = t.carryOverMax === null ? 'All unused days carry' : `Up to ${t.carryOverMax} days carry`;
    const exp = t.carryOverExpiryMonths === null
      ? 'and never expire'
      : `and lapse ${t.carryOverExpiryMonths} month${t.carryOverExpiryMonths === 1 ? '' : 's'} into the new year`;
    return `${cap} ${exp}`;
  };

  return (
    <Stack gap="lg">
      <Anchor component={Link} to="/leave" size="sm" c="sand.6">
        <Group gap={4}><IconArrowLeft size={14} /> Back to leave</Group>
      </Anchor>

      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div>
          <Title order={1}>Leave types</Title>
          <Text c="sand.6" mt={4}>What leave people can take, how it builds up, and what carries over</Text>
        </div>
        {isHr && (
          <Button leftSection={<IconPlus size={16} />} onClick={openNew}>Add leave type</Button>
        )}
      </Group>

      <Card p="lg" radius="md">
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th w={120}>Accrues</Table.Th>
                <Table.Th w={90}>Per year</Table.Th>
                <Table.Th>Carry-over</Table.Th>
                {isHr && <Table.Th w={80} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading && Array.from({ length: 3 }, (_, i) => (
                <Table.Tr key={`s${i}`}>
                  <Table.Td colSpan={isHr ? 5 : 4}><Skeleton h={14} radius="sm" /></Table.Td>
                </Table.Tr>
              ))}
              {!loading && types.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{t.name}</Text>
                    <Group gap={6} mt={4}>
                      {!t.isPaid && <Badge size="xs" variant="light" color="sand">Unpaid</Badge>}
                      {!t.requiresApproval && <Badge size="xs" variant="light" color="sand">No approval</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm">{ACCRUAL_LABEL[t.accrualMethod] ?? t.accrualMethod}</Text></Table.Td>
                  <Table.Td><Text size="sm">{t.annualDays ?? '—'}</Text></Table.Td>
                  <Table.Td><Text size="sm" c="sand.7">{carryText(t)}</Text></Table.Td>
                  {isHr && (
                    <Table.Td>
                      <Button size="compact-sm" variant="subtle" onClick={() => openEdit(t)}>Edit</Button>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {!loading && types.length === 0 && (
          <Center py={48}>
            <Stack gap={6} align="center">
              <IconCalendarTime size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
              <Text fw={600} mt={4}>No leave types yet</Text>
              <Text size="sm" c="sand.6" maw={400} ta="center">
                Kenyan law gives 21 working days of annual leave. Add that first.
              </Text>
            </Stack>
          </Center>
        )}
      </Card>

      <Modal
        opened={open} onClose={() => setOpen(false)} centered size="lg"
        title={editing ? `Edit ${editing.name}` : 'Add leave type'}
      >
        <form onSubmit={form.onSubmit((v) => void save(v))}>
          <Stack gap="md">
            <TextInput label="Name" placeholder="Annual Leave" withAsterisk {...form.getInputProps('name')} />

            <Group grow>
              <Switch label="Paid" {...form.getInputProps('isPaid', { type: 'checkbox' })} />
              <Switch label="Needs approval" {...form.getInputProps('requiresApproval', { type: 'checkbox' })} />
            </Group>

            <Select
              label="How it builds up" data={ACCRUAL_OPTIONS} allowDeselect={false}
              {...form.getInputProps('accrualMethod')}
            />

            {form.values.accrualMethod !== 'NONE' && (
              <NumberInput
                label="Days per year" min={0} max={365} allowNegative={false} allowDecimal={false}
                description="21 is the statutory minimum for annual leave in Kenya"
                {...form.getInputProps('annualDays')}
              />
            )}

            <Card p="md" radius="md" withBorder bg="sand.0">
              <Text size="sm" fw={600} mb="xs">Carry-over</Text>
              <Stack gap="sm">
                <Switch
                  label="All unused days carry over"
                  description="Off lets you cap it"
                  {...form.getInputProps('carryOverUnlimited', { type: 'checkbox' })}
                />
                {!form.values.carryOverUnlimited && (
                  <NumberInput
                    label="Most days that can carry" min={0} max={365}
                    allowNegative={false} allowDecimal={false}
                    description="0 means nothing carries into the new year"
                    {...form.getInputProps('carryOverMax')}
                  />
                )}
                <Switch
                  label="Carried days never expire"
                  {...form.getInputProps('carryOverNeverExpires', { type: 'checkbox' })}
                />
                {!form.values.carryOverNeverExpires && (
                  <NumberInput
                    label="Months before carried days lapse" min={0} max={12}
                    allowNegative={false} allowDecimal={false}
                    description="3 means they must be used by 31 March"
                    {...form.getInputProps('carryOverExpiryMonths')}
                  />
                )}
              </Stack>
            </Card>

            <Group justify="flex-end" gap="sm">
              <Button variant="subtle" color="sand" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editing ? 'Save changes' : 'Create leave type'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
