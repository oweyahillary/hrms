import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Group, LoadingOverlay, Select, Stack, Switch, Text, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import {
  getLeaveApproval, updateLeaveApproval, type LeaveApprovalMode,
} from '../api/organization';
import { getApprovers, type Approver } from '../api/leave';
import { ApiError } from '../api/client';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';

interface FormValues {
  leaveApprovalMode: LeaveApprovalMode;
  leaveHrApproverUserId: string;
  allowEmployeeChosenApprovers: boolean;
}

export function SettingsLeavePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvers, setApprovers] = useState<Approver[]>([]);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: {
      leaveApprovalMode: 'DEPT_HEAD_THEN_HR', leaveHrApproverUserId: '',
      allowEmployeeChosenApprovers: false,
    },
  });
  useUnsavedChangesWarning(form.isDirty());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [la, apps] = await Promise.all([getLeaveApproval(), getApprovers()]);
        if (cancelled) return;
        setApprovers(apps);
        form.setValues({
          leaveApprovalMode: la.leaveApprovalMode,
          leaveHrApproverUserId: la.leaveHrApproverUserId ?? '',
          allowEmployeeChosenApprovers: la.allowEmployeeChosenApprovers,
        });
        form.resetDirty();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError && e.status === 403
            ? 'You do not have permission to change leave settings.'
            : 'Could not load leave approval settings.');
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
      await updateLeaveApproval({
        leaveApprovalMode: values.leaveApprovalMode,
        // Blank means "nobody set" -> null, not an empty string.
        leaveHrApproverUserId: values.leaveHrApproverUserId || null,
        allowEmployeeChosenApprovers: values.allowEmployeeChosenApprovers,
      });
      form.resetDirty();
      notifications.show({
        color: 'brand', icon: <IconCheck size={16} />,
        title: 'Leave approval saved', message: 'New requests will follow this policy.',
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save leave approval settings.');
    } finally {
      setSaving(false);
    }
  };

  const noApprover = !form.values.leaveHrApproverUserId;
  const usesDeptHead = form.values.leaveApprovalMode !== 'HR_ONLY';

  return (
    <Stack gap="lg" maw={880}>
      <div>
        <Title order={1}>Leave approval</Title>
        <Text c="sand.6" mt={4}>
          Who signs off leave requests. Employees don&apos;t choose their own approver — the
          system works it out from this policy.
        </Text>
      </div>

      {error && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{error}</Alert>}

      <form onSubmit={form.onSubmit((v) => void save(v))}>
        <Card p="lg" radius="md" pos="relative">
          <LoadingOverlay visible={loading} />

          {!loading && noApprover && (
            <Alert
              color="amber" variant="light" mb="md" icon={<IconAlertTriangle size={16} />}
              title="Nobody can approve leave yet"
            >
              Choose an HR approver below. Until you do, leave requests will be refused.
            </Alert>
          )}

          <Stack gap="md">
            <Select
              label="Approval steps"
              data={[
                { value: 'DEPT_HEAD_THEN_HR', label: 'Department head, then HR (two steps)' },
                { value: 'HR_ONLY', label: 'HR only (one step)' },
                { value: 'DEPT_HEAD_ONLY', label: 'Department head only (one step)' },
              ]}
              allowDeselect={false}
              {...form.getInputProps('leaveApprovalMode')}
            />

            <Select
              label="HR approver"
              description="The person who signs off as HR. A role can't approve — an approval needs a name."
              data={approvers.map((a) => ({ value: a.id, label: `${a.name} · ${a.role}` }))}
              placeholder={approvers.length ? 'Choose a person' : 'No HR users available'}
              searchable clearable
              {...form.getInputProps('leaveHrApproverUserId')}
            />

            {usesDeptHead && (
              <Text size="sm" c="sand.7">
                This mode uses department heads. A department with no head — or a head with no
                login — falls back to the HR approver above.
              </Text>
            )}

            <Switch
              label="Let employees choose their own approvers"
              description="Off is recommended. Choosing who signs off your own leave is a weak control."
              {...form.getInputProps('allowEmployeeChosenApprovers', { type: 'checkbox' })}
            />
          </Stack>

          <Group justify="flex-end" mt="lg">
            <Button type="submit" loading={saving} disabled={loading}>Save leave approval</Button>
          </Group>
        </Card>
      </form>
    </Stack>
  );
}
