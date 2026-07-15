import { type ReactNode } from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import {
  AppShell, Box, Group, Menu, NavLink, ScrollArea, Text, UnstyledButton, Avatar,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconUsers, IconCalendarStats, IconReportMoney, IconChevronDown, IconLogout,
} from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from './BrandMark';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/employees', label: 'Employees', icon: IconUsers },
  { to: '/leave', label: 'Leave', icon: IconCalendarStats },
  { to: '/payroll', label: 'Payroll', icon: IconReportMoney },
];

export function AppShellLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <AppShell
      layout="alt"
      header={{ height: 60 }}
      navbar={{ width: 248, breakpoint: 'sm' }}
      padding="lg"
      styles={{
        navbar: { background: 'var(--mantine-color-white)', borderColor: 'var(--mantine-color-sand-2)' },
        header: { background: 'var(--mantine-color-white)', borderColor: 'var(--mantine-color-sand-2)' },
        main: { background: 'var(--mantine-color-sand-0)' },
      }}
    >
      <AppShell.Navbar p="md">
        <Box mb="lg" px="xs"><BrandMark name={user?.organizationName} /></Box>
        <ScrollArea>
          {NAV.map((item) => {
            const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to} component={RouterNavLink} to={item.to} label={item.label}
                leftSection={<item.icon size={19} stroke={1.7} />} active={active}
                variant="light" mb={2}
                styles={{ root: { borderRadius: 8 } }}
              />
            );
          })}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Text c="sand.6" size="sm">{titleFor(location.pathname)}</Text>
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <UnstyledButton>
                <Group gap="xs">
                  <Avatar radius="xl" size={30} color="brand" variant="filled">{initials}</Avatar>
                  <Box visibleFrom="sm">
                    <Text size="sm" fw={600} lh={1.1}>{user?.email}</Text>
                    <Text size="xs" c="sand.6" lh={1.1}>{user?.role}</Text>
                  </Box>
                  <IconChevronDown size={15} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconLogout size={15} />} onClick={() => void signOut()}>
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

function titleFor(path: string): string {
  if (path === '/') return 'Dashboard';
  return path.slice(1).replace(/^\w/, (c) => c.toUpperCase());
}
