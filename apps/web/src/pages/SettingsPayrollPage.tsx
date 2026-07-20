import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Group, LoadingOverlay, Select, Stack, Text, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import {
  getPayrollSettings, updatePayrollSettings, type SeveranceDayRateBasis,
} from '../api/organization';
import { ApiError } from '../api/client';

const BASIS_OPTIONS: { value: SeveranceDayRateBasis; label: string }[] = [
  { value: 'CALENDAR_30', label: 'Calendar days (30) — the common convention' },
  { value: 'WORKING_26', label: 'Working days (26)' },
];

interface FormValues {
  severanceDayRateBasis: SeveranceDayRateBasis;
}

export function SettingsPayrollPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    initialValues: { severanceDayRateBasis: 'CALENDAR_30' },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await getPayrollSettings();
        if (cancelled) return;
        form.setValues({ severanceDayRateBasis: s.severanceDayRateBasis });
        form.resetDirty();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError && e.status === 403
            ? 'You do not have permission to change payroll settings.'
            : 'Could not load payroll settings.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (values: FormValues) => {
    setSaving(true); setError(null);
    try {
      await updatePayrollSettings({ severanceDayRateBasis: values.severanceDayRateBasis });
      form.resetDirty();
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Payroll settings saved',
        message: 'The day-rate basis will apply to new severance calculations.',
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save payroll settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="lg" maw={880}>
      <div>
        <Title order={1}>Payroll</Title>
        <Text c="sand.6" mt={4}>
          How a monthly basic salary is converted into a day&apos;s pay for statutory
          exit calculations.
        </Text>
      </div>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{error}</Alert>}

      <form onSubmit={form.onSubmit((v) => void save(v))}>
        <Card p="lg" radius="md" pos="relative">
          <LoadingOverlay visible={loading} />

          <Select
            label="Severance day-rate basis"
            description="A day's pay = monthly basic salary ÷ this number of days."
            data={BASIS_OPTIONS}
            allowDeselect={false}
            value={form.values.severanceDayRateBasis}
            onChange={(v) => form.setFieldValue('severanceDayRateBasis', (v as SeveranceDayRateBasis) ?? 'CALENDAR_30')}
          />

          <Text size="sm" c="sand.7" mt="md">
            This affects severance pay and notice pay-in-lieu calculations going
            forward. Calculations already saved keep the basis they were computed
            with and do not change.
          </Text>

          <Group justify="flex-end" mt="lg">
            <Button type="submit" loading={saving} disabled={loading}>Save payroll settings</Button>
          </Group>
        </Card>
      </form>
    </Stack>
  );
}
