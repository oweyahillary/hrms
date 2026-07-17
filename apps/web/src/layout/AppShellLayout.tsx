import { type ReactNode } from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import {
  AppShell, Box, Group, Menu, NavLink, ScrollArea, Text, UnstyledButton, Avatar,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconUsers, IconCalendarStats, IconReportMoney, IconChevronDown, IconLogout,
  IconSettings,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useAuth } from '../auth/AuthContext';
import { canManageEmployees, canManageOrg } from '../auth/roles';
import { BrandMark } from './BrandMark';

interface NavChild {
  to: string;
  label: string;
  /**
   * Highlight only on an exact path match. Needed where a child's path is a
   * PREFIX of its siblings' — '/leave' would otherwise stay lit on
   * '/leave/balances', because react-router treats a path as active when the
   * location merely starts with it at a '/' boundary.
   */
  exact?: boolean;
  /** Hide from anyone who can't administer leave configuration. */
  hrOnly?: boolean;
}
interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  children?: NavChild[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/employees', label: 'Employees', icon: IconUsers },
  {
    to: '/leave',
    label: 'Leave',
    icon: IconCalendarStats,
    children: [
      // '/leave' is both the section and the requests screen, so it has to match
      // exactly or it would light up on every child route.
      { to: '/leave', label: 'Requests', exact: true },
      { to: '/leave/apply', label: 'Apply for leave' },
      { to: '/leave/balances', label: 'Balances' },
      { to: '/leave/types', label: 'Leave types', hrOnly: true },
    ],
  },
  { to: '/payroll', label: 'Payroll', icon: IconReportMoney },
];

/** Settings is organisation administration — only for roles that can manage it. */
const ADMIN_NAV: NavItem[] = [
  {
    to: '/settings',
    label: 'Settings',
    icon: IconSettings,
    children: [
      { to: '/settings', label: 'Organisation', exact: true },
      { to: '/settings/leave', label: 'Leave approval' },
      { to: '/settings/numbering', label: 'Employee numbers' },
    ],
  },
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
          {[...NAV, ...(canManageOrg(user?.role) ? ADMIN_NAV : [])].map((item) => {
            const inSection = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);

            if (!item.children) {
              return (
                <NavLink
                  key={item.to} component={RouterNavLink} to={item.to} label={item.label}
                  leftSection={<item.icon size={19} stroke={1.7} />} active={inSection}
                  variant="light" mb={2}
                  styles={{ root: { borderRadius: 8 } }}
                />
              );
            }

            // A section with children: the parent opens the list rather than
            // navigating, and the first child is the section's own page. Keyed
            // on the path so the group re-opens when you land inside it from a
            // link elsewhere, not just when you click the parent.
            return (
              <NavLink
                key={item.to} label={item.label}
                leftSection={<item.icon size={19} stroke={1.7} />}
                defaultOpened={inSection}
                variant="light" mb={2} childrenOffset={30}
                styles={{ root: { borderRadius: 8 } }}
              >
                {item.children
                  .filter((child) => !child.hrOnly || canManageEmployees(user?.role))
                  .map((child) => (
                    <NavLink
                      key={child.to} component={RouterNavLink} to={child.to} label={child.label}
                      // `end` is what decides this, NOT an `active` prop: react-router
                      // sets aria-current="page" on a match, and Mantine styles
                      // [aria-current='page'] as active on its own. Passing `active`
                      // as well would give two systems a vote and they can disagree —
                      // which is exactly how '/leave' stayed lit on '/leave/balances'.
                      end={child.exact}
                      variant="light" mb={2}
                      styles={{ root: { borderRadius: 8 } }}
                    />
                  ))}
              </NavLink>
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
  // Section only — a detail route (/employees/:id) is still "Employees", not
  // the raw path with a UUID glued on.
  const [section = ''] = path.slice(1).split('/');
  return section.replace(/^\w/, (c) => c.toUpperCase());
}
