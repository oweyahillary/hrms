import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Button, Center, Divider, Group, Paper, PasswordInput, PinInput, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { login, verifyMfa, isMfaChallenge, me, ssoConfig } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../layout/BrandMark';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => { void ssoConfig().then((c) => setSsoEnabled(c.enabled)); }, []);

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Enter a valid email'),
      password: (v) => (v.length > 0 ? null : 'Enter your password'),
    },
  });

  async function submitCredentials(values: { email: string; password: string }) {
    setError(null); setBusy(true);
    try {
      const result = await login(values.email, values.password);
      if (isMfaChallenge(result)) {
        setMfaToken(result.mfaToken);
      } else {
        const who = await me();
        auth.setUser(who);
        auth.setMustChangePassword(result.mustChangePassword);
        navigate(result.mustChangePassword ? '/change-password' : from, { replace: true });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa() {
    if (!mfaToken || code.length < 6) return;
    setError(null); setBusy(true);
    try {
      const session = await verifyMfa(mfaToken, code);
      const who = await me();
      auth.setUser(who);
      auth.setMustChangePassword(session.mustChangePassword);
      navigate(session.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center mih="100vh" p="md" bg="sand.0">
      <Stack w={400} maw="100%" gap="lg">
        <Group gap="sm" justify="center">
          <BrandMark />
        </Group>

        <Paper p="xl" radius="md">
          {!mfaToken ? (
            <form onSubmit={form.onSubmit(submitCredentials)}>
              <Stack gap="md">
                <Box>
                  <Title order={2}>Welcome back</Title>
                  <Text c="sand.6" size="sm" mt={4}>Sign in to your workspace</Text>
                </Box>
                <TextInput
                  label="Email" placeholder="you@company.co.ke" autoComplete="username"
                  {...form.getInputProps('email')}
                />
                <PasswordInput
                  label="Password" placeholder="Your password" autoComplete="current-password"
                  {...form.getInputProps('password')}
                />
                {error && <Text c="red.7" size="sm">{error}</Text>}
                <Button type="submit" loading={busy} fullWidth size="md" mt="xs">Sign in</Button>
                {ssoEnabled && (
                  <>
                    <Divider label="or" labelPosition="center" my={4} />
                    <Button
                      component="a" href="/api/auth/sso/login"
                      variant="default" fullWidth size="md"
                      leftSection={<IconLock size={16} />}
                    >
                      Sign in with SSO
                    </Button>
                  </>
                )}
              </Stack>
            </form>
          ) : (
            <Stack gap="md">
              <Box>
                <Title order={2}>Two-factor</Title>
                <Text c="sand.6" size="sm" mt={4}>Enter the 6-digit code from your authenticator</Text>
              </Box>
              <Center>
                <PinInput length={6} type="number" value={code} onChange={setCode} oneTimeCode size="md" />
              </Center>
              {error && <Text c="red.7" size="sm" ta="center">{error}</Text>}
              <Button onClick={submitMfa} loading={busy} disabled={code.length < 6} fullWidth size="md">
                Verify
              </Button>
              <Button variant="subtle" color="sand" size="sm" onClick={() => { setMfaToken(null); setCode(''); setError(null); }}>
                Back
              </Button>
            </Stack>
          )}
        </Paper>

        <Text ta="center" size="xs" c="sand.5">HRMS · secure workspace</Text>
      </Stack>
    </Center>
  );
}
