import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { setAccessToken, setRefreshToken } from '../api/client';
import { me } from '../api/auth';
import { useAuth } from '../auth/AuthContext';

/** Target of the OIDC redirect handoff: tokens arrive in the URL fragment. */
export function SsoCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    if (!accessToken || !refreshToken) { setError('Sign-in did not complete.'); return; }

    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    window.history.replaceState(null, '', '/'); // strip tokens from the URL

    (async () => {
      try {
        const who = await me();
        auth.setUser(who);
        navigate('/', { replace: true });
      } catch {
        setError('Could not establish your session.');
      }
    })();
  }, [auth, navigate]);

  return (
    <Center mih="100vh" bg="sand.0">
      {error
        ? <Text c="red.7" size="sm">{error}</Text>
        : <Stack align="center" gap="sm"><Loader color="brand" /><Text c="sand.6" size="sm">Signing you in…</Text></Stack>}
    </Center>
  );
}
