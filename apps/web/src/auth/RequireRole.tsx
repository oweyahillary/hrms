import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useAuth } from './AuthContext';

/**
 * UX-only route guard — the API already enforces the real boundary, this just
 * stops a page a user has no access to from ever mounting (and firing a wave
 * of 403s while it tries to load data) in favour of one friendly, consistent
 * screen. `check` is one of auth/roles.ts's predicates (canManageEmployees,
 * canManageOrg) — the single source of truth for who can do what, shared with
 * the nav so a route and its nav link can never disagree.
 */
export function RequireRole({ check, children }: { check: (role?: string) => boolean; children: ReactNode }) {
  const { user } = useAuth();

  if (check(user?.role)) return <>{children}</>;

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
