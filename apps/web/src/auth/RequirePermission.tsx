import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth } from './AuthContext';
import { hasAnyPermission } from './permissions';

/**
 * UX-only route guard — the API already enforces the real boundary, this just
 * stops a page a user has no access to from ever mounting (and firing a wave
 * of 403s while it tries to load data) in favour of one friendly, consistent
 * screen. `permission` is one key or several (ANY match is enough), checked
 * against the SAME permission set the API embedded in the session at
 * login/refresh — the single source of truth, shared with the nav so a route
 * and its nav link can never disagree.
 */
export function RequirePermission({ permission, children }: {
  permission: string | string[]; children: ReactNode;
}) {
  const { user } = useAuth();
  const required = Array.isArray(permission) ? permission : [permission];

  if (hasAnyPermission(user?.permissions, required)) return <>{children}</>;

  return (
    <Center py={80}>
      <Stack gap="sm" align="center" maw={360}>
        <ThemeIcon size={48} radius="xl" variant="light" color="sand">
          <IconLock size={24} stroke={1.7} />
        </ThemeIcon>
        <Title order={3} ta="center">You don&apos;t have access to this page</Title>
        <Text size="sm" c="sand.6" ta="center">
          Your role doesn&apos;t include this. If you think that&apos;s wrong, ask an administrator.
        </Text>
        <Button component={Link} to="/" variant="light" mt="sm">Back to Dashboard</Button>
      </Stack>
    </Center>
  );
}
