import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Group, LoadingOverlay, NumberInput, SimpleGrid, Stack, Text, TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { getNumbering, updateNumbering } from '../api/organization';
import {
  EMPLOYEE_NUMBER_PREFIX_REGEX, MAX_PADDING, MIN_PADDING, formatEmployeeNumber, prefixError,
} from '../validation/employee-number';
import { ApiError } from '../api/client';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';

interface FormValues {
  employeeNumberPrefix: string;
  employeeNumberPadding: number | string;
  employeeNumberNextSeq: number | string;
}

export function SettingsNumberingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { employeeNumberPrefix: '', employeeNumberPadding: 4, employeeNumberNextSeq: 1 },
    validate: {
      // Empty prefix is legitimate — it means auto-numbering is switched off.
      employeeNumberPrefix: (v) =>
        (!v.trim() || EMPLOYEE_NUMBER_PREFIX_REGEX.test(v.trim()) ? null : prefixError),
      employeeNumberPadding: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= MIN_PADDING && n <= MAX_PADDING
          ? null : `Choose between ${MIN_PADDING} and ${MAX_PADDING} digits`;
      },
      employeeNumberNextSeq: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 ? null : 'The next number must be 1 or more';
      },
    },
  });
  useUnsavedChangesWarning(form.isDirty());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const n = await getNumbering();
        if (cancelled) return;
        form.setValues({
          employeeNumberPrefix: n.employeeNumberPrefix ?? '',
          employeeNumberPadding: n.employeeNumberPadding,
          employeeNumberNextSeq: n.employeeNumberNextSeq,
        });
        form.resetDirty();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError && e.status === 403
            ? 'You do not have permission to change employee numbering.'
            : 'Could not load employee numbering.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview reflects what's typed right now, so the effect of a change is
  // visible before saving. Invalid input shows no preview rather than nonsense.
  const prefixNow = form.values.employeeNumberPrefix.trim();
  const paddingNow = Number(form.values.employeeNumberPadding);
  const seqNow = Number(form.values.employeeNumberNextSeq);
  const preview =
    prefixNow && EMPLOYEE_NUMBER_PREFIX_REGEX.test(prefixNow)
      && Number.isInteger(paddingNow) && paddingNow >= MIN_PADDING && paddingNow <= MAX_PADDING
      && Number.isInteger(seqNow) && seqNow >= 1
      ? formatEmployeeNumber(prefixNow, paddingNow, seqNow)
      : null;

  const save = async (values: FormValues) => {
    setSaving(true); setError(null);
    try {
      await updateNumbering({
        // Blank means "turn auto-numbering off" -> null, not an empty string.
        employeeNumberPrefix: values.employeeNumberPrefix.trim() || null,
        employeeNumberPadding: Number(values.employeeNumberPadding),
        employeeNumberNextSeq: Number(values.employeeNumberNextSeq),
      });
      form.resetDirty();
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Employee numbering saved', message: preview ? `Next: ${preview}` : 'Automatic numbering is off.',
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save employee numbering.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={880}>
      <div>
        <Title order={1}>Employee numbers</Title>
        <Text c="sand.6" mt={4}>
          New employees are numbered automatically from a prefix and a running counter.
          Leave the prefix blank to switch this off and type each number by hand.
        </Text>
      </div>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{error}</Alert>}

      <form onSubmit={form.onSubmit((v) => void save(v))}>
        <Card p="lg" radius="md" pos="relative">
          <LoadingOverlay visible={loading} />

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <TextInput label="Prefix" placeholder="VIVO" {...form.getInputProps('employeeNumberPrefix')} />
            <NumberInput
              label="Digits" min={MIN_PADDING} max={MAX_PADDING} clampBehavior="strict"
              allowDecimal={false} allowNegative={false}
              {...form.getInputProps('employeeNumberPadding')}
            />
            <NumberInput
              label="Next number" min={1} allowDecimal={false} allowNegative={false}
              {...form.getInputProps('employeeNumberNextSeq')}
            />
          </SimpleGrid>

          <Text size="sm" c="sand.7" mt="md">
            {preview
              ? <>The next employee will be <Text span fw={700} ff="monospace">{preview}</Text></>
              : 'Automatic numbering is off — you will enter each employee number yourself.'}
          </Text>

          <Group justify="flex-end" mt="lg">
            <Button type="submit" loading={saving} disabled={loading}>Save employee numbers</Button>
          </Group>
        </Card>
      </form>
    </Stack>
  );
}
