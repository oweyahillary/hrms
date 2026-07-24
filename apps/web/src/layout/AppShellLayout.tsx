import { type ReactNode } from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import {
  AppShell, Box, Divider, Group, Menu, NavLink, ScrollArea, Text, UnstyledButton, Avatar,
} from '@mantine/core';
import {
  IconLayoutDashboard, IconUsers, IconCalendarStats, IconReportMoney, IconChevronDown, IconLogout,
  IconSettings, IconReceipt2, IconUserCircle, IconUser, IconClockHour4, IconClipboardCheck,
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
];

/**
 * The org-wide Employees directory and the admin Leave section (approvals,
 * balances administration, leave types) — HR_MANAGEMENT_ROLES only. A non-HR
 * employee gets the self-service equivalents instead (SELF_SERVICE_NAV /
 * MY_SPACE_NAV below), not these.
 */
const HR_NAV: NavItem[] = [
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
  { to: '/shifts', label: 'Shifts', icon: IconClockHour4 },
  { to: '/attendance', label: 'Attendance', icon: IconClipboardCheck },
];

/**
 * "My own data" — every authenticated user can reach these regardless of
 * role (the API enforces that they only ever see their own rows; see
 * apps/api/src/self-service). Two renderings of the same three destinations:
 * SELF_SERVICE_NAV shows them as top-level items (non-HR — this ends up being
 * their whole nav, so no need to bury it under a group); MY_SPACE_NAV wraps
 * the same links under one collapsible "My space" parent for HR, who already
 * have a full nav of their own. NavLink only renders two levels deep, so "My
 * Leave" can carry its own Apply child when it's top-level (SELF_SERVICE_NAV)
 * but not when it's already nested under "My space" (MY_SPACE_NAV) — there
 * "Apply for leave" is a sibling child instead.
 */
const SELF_SERVICE_NAV: NavItem[] = [
  { to: '/me/payslips', label: 'My payslips', icon: IconReceipt2 },
  {
    to: '/me/leave',
    label: 'My leave',
    icon: IconCalendarStats,
    children: [
      { to: '/me/leave', label: 'My requests', exact: true },
      { to: '/leave/apply', label: 'Apply for leave' },
    ],
  },
  { to: '/me/attendance', label: 'My attendance', icon: IconClipboardCheck },
  { to: '/me/profile', label: 'My profile', icon: IconUserCircle },
];

const MY_SPACE_NAV: NavItem[] = [
  {
    to: '/me',
    label: 'My space',
    icon: IconUser,
    children: [
      { to: '/me/payslips', label: 'My payslips' },
      { to: '/me/leave', label: 'My leave', exact: true },
      { to: '/leave/apply', label: 'Apply for leave' },
      { to: '/me/attendance', label: 'My attendance' },
      { to: '/me/profile', label: 'My profile' },
    ],
  },
];

/**
 * Payroll is entirely HR_MANAGEMENT_ROLES-gated on the API — every route under
 * it 403s for anyone else. Keep it out of the base NAV and show it only to
 * roles that can actually use it, the same way ADMIN_NAV below hides Settings.
 */
const PAYROLL_NAV: NavItem[] = [
  // Flat single entry: the Run / Setup / Reports sub-navigation lives in a tab
  // bar at the top of the Payroll section (PayrollLayout), not in the sidebar.
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
      { to: '/settings/payroll', label: 'Payroll' },
      { to: '/settings/shifts', label: 'Shift definitions' },
      { to: '/settings/devices', label: 'Devices' },
      { to: '/settings/users', label: 'Users' },
    ],
  },
];

export function AppShellLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const initials = (user?.email ?? '?').slice(0, 2).toUpperCase();

  // Shared look for every nav row: a touch more breathing room than Mantine's
  // default, and fully rounded so the brand-tinted "active" state (already
  // wired up by `variant="light"` + Mantine's own active/aria-current CSS)
  // reads as a pill rather than a boxed cell. Hover/active colour come from
  // Mantine's built-in NavLink stylesheet, not from here — inline `style`
  // objects can't express `:hover`/`[data-active]`, so that part lives in
  // styles.css (`.nav-item`) instead.
  const navItemStyles = {
    root: { height: 40, paddingLeft: 12, paddingRight: 12 },
    label: { fontSize: 'var(--mantine-font-size-sm)' },
  };

  return (
    <AppShell
      layout="alt"
      header={{ height: 64 }}
      navbar={{ width: 264, breakpoint: 'sm' }}
      padding="lg"
      styles={{
        navbar: {
          background: 'var(--mantine-color-white)',
          borderRight: '1px solid var(--mantine-color-sand-2)',
        },
        header: {
          background: 'var(--mantine-color-white)',
          borderBottom: '1px solid var(--mantine-color-sand-2)',
        },
        main: { background: 'var(--mantine-color-sand-0)' },
      }}
    >
      <AppShell.Navbar p="md">
        <Box mb="md" px="xs" pt={4}><BrandMark name={user?.organizationName} /></Box>
        <Divider color="sand.1" mb="md" />
        <ScrollArea>
          {[
            ...NAV,
            ...(canManageEmployees(user?.role) ? HR_NAV : []),
            ...(canManageEmployees(user?.role) ? PAYROLL_NAV : []),
            ...(canManageOrg(user?.role) ? ADMIN_NAV : []),
            ...(canManageEmployees(user?.role) ? MY_SPACE_NAV : SELF_SERVICE_NAV),
          ].map((item) => {
            const inSection = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);

            if (!item.children) {
              return (
                <NavLink
                  key={item.to} component={RouterNavLink} to={item.to} label={item.label}
                  leftSection={<item.icon size={19} stroke={1.7} />} active={inSection}
                  fw={inSection ? 600 : 500}
                  variant="light" mb={4} className="nav-item"
                  styles={navItemStyles}
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
                fw={inSection ? 600 : 500}
                variant="light" mb={4} childrenOffset={28} className="nav-item"
                styles={navItemStyles}
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
                      variant="light" mb={2} className="nav-item nav-item-child"
                      styles={navItemStyles}
                    />
                  ))}
              </NavLink>
            );
          })}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Text c="sand.7" size="sm" fw={600}>{titleFor(location.pathname)}</Text>
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <UnstyledButton
                px="xs" py={6}
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
                className="topbar-user"
              >
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
