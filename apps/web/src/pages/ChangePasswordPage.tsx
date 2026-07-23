import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { changePassword, me } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    validateInputOnBlur: true,
    initialValues: { currentPassword: '', newPassword: '', confirm: '' },
    validate: {
      newPassword: (v) => (v.length >= 12 ? null : 'Use at least 12 characters'),
      confirm: (v, values) => (v === values.newPassword ? null : 'Passwords do not match'),
    },
  });

  async function submit(values: typeof form.values) {
    setError(null); setBusy(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      const who = await me();
      auth.setUser(who);
      auth.setMustChangePassword(false);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md" bg="sand.0">
      <Paper p="xl" radius="md" w={420} maw="100%">
        <form onSubmit={form.onSubmit(submit)}>
          <Stack gap="md">
            <div>
              <Title order={2}>Set a new password</Title>
              <Text c="sand.6" size="sm" mt={4}>
                For your security, choose a new password before continuing.
              </Text>
            </div>
            <PasswordInput label="Current password" {...form.getInputProps('currentPassword')} />
            <PasswordInput label="New password" description="At least 12 characters" {...form.getInputProps('newPassword')} />
            <PasswordInput label="Confirm new password" {...form.getInputProps('confirm')} />
            {error && <Text c="red.7" size="sm">{error}</Text>}
            <Button type="submit" loading={busy} fullWidth size="md">Update password</Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
