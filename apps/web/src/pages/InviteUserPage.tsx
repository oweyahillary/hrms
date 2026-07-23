import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Anchor, Button, Card, Code, CopyButton, Group, Select, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconArrowLeft, IconCheck, IconCopy, IconKey } from '@tabler/icons-react';
import { createUser, listRoles, type CreatedUser, type RoleOption } from '../api/users';
import { loadEmployeeOptions, type EmployeeOption } from '../api/employee-options';
import { ApiError } from '../api/client';

interface FormValues {
  email: string;
  roleId: string;
  employeeId: string;
}

export function InviteUserPage() {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [saving, setSaving] = useState(false);
  // A dedicated page (not a modal): the create response carries a one-time temp
  // password. A modal can be dismissed by an outside click and the secret is
  // then gone forever; a page holds it in place until the admin deliberately
  // leaves — matching the "creation is a dedicated page" precedent from loans.
  const [created, setCreated] = useState<CreatedUser | null>(null);

  const form = useForm<FormValues>({
    validateInputOnBlur: true,
    initialValues: { email: '', roleId: '', employeeId: '' },
    validate: {
      email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter a valid email'),
      roleId: (v) => (v ? null : 'Choose a role'),
    },
  });

  useEffect(() => {
    void listRoles().then(setRoles).catch(() => notifications.show({
      color: 'red', icon: <IconAlertTriangle size={16} />,
      title: 'Could not load roles', message: 'Reopen this page to retry.',
    }));
    void loadEmployeeOptions().then(setEmployees).catch(() => { /* optional link stays empty */ });
  }, []);

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      const user = await createUser({
        email: values.email.trim().toLowerCase(),
        roleId: values.roleId,
        employeeId: values.employeeId || undefined,
      });
      setCreated(user);
    } catch (e) {
      notifications.show({
        color: 'red', icon: <IconAlertTriangle size={16} />,
        title: 'Could not invite user',
        message: e instanceof ApiError ? e.message : 'Something went wrong.',
      });
    } finally {
      setSaving(false);
    }
  };

  const inviteAnother = () => { setCreated(null); form.reset(); };

  return (
    <Stack gap="lg" maw={620}>
      <Anchor component={RouterLink} to="/settings/users" size="sm" c="sand.6">
        <Group gap={4} wrap="nowrap"><IconArrowLeft size={15} /> Back to users</Group>
      </Anchor>

      <div>
        <Title order={2}>Invite user</Title>
        <Text c="sand.6" size="sm" mt={2}>
          Creates a login and generates a temporary password. There is no email delivery — you share the
          password with them, and they must change it on first sign-in.
        </Text>
      </div>

      {created ? (
        <Card p="lg" radius="md" withBorder>
          <Stack gap="md">
            <Group gap="xs">
              <IconCheck size={18} color="var(--mantine-color-brand-6)" />
              <Text fw={600}>{created.displayName} invited</Text>
            </Group>

            <Alert color="amber" variant="light" icon={<IconKey size={16} />} title="One-time temporary password">
              <Text size="sm" mb="sm">
                Copy this now and share it with the user securely. It is shown <b>once</b> — it cannot be
                retrieved again. They will be required to change it on first login.
              </Text>
              <Group gap="sm">
                <Code fz="md" style={{ padding: '6px 12px' }}>{created.tempPassword}</Code>
                <CopyButton value={created.tempPassword}>
                  {({ copied, copy }) => (
                    <Button
                      size="xs" variant={copied ? 'filled' : 'default'} color={copied ? 'brand' : undefined}
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            </Alert>

            <Group justify="flex-end">
              <Button variant="default" onClick={inviteAnother}>Invite another</Button>
              <Button component={RouterLink} to="/settings/users">Done</Button>
            </Group>
          </Stack>
        </Card>
      ) : (
        <form onSubmit={form.onSubmit((v) => void submit(v))}>
          <Card p="lg" radius="md" withBorder>
            <Stack gap="md">
              <TextInput label="Email" type="email" withAsterisk placeholder="name@company.co.ke" {...form.getInputProps('email')} />
              <Select
                label="Role" placeholder="Choose a role" withAsterisk searchable
                data={roles.map((r) => ({ value: r.id, label: r.name }))}
                {...form.getInputProps('roleId')}
              />
              <Select
                label="Link to employee"
                description="Optional — sets the display name from the employee record"
                placeholder="Not linked" clearable searchable
                data={employees} {...form.getInputProps('employeeId')}
              />
              <Group justify="flex-end" mt="sm">
                <Button variant="default" component={RouterLink} to="/settings/users">Cancel</Button>
                <Button type="submit" loading={saving}>Invite</Button>
              </Group>
            </Stack>
          </Card>
        </form>
      )}
    </Stack>
  );
}
