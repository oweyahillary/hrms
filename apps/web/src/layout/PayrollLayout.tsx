import { Outlet, useLocation, useNavigate, Link as RouterLink } from 'react-router-dom';
import { Anchor, Group, Stack, Tabs } from '@mantine/core';
import { IconCalculator } from '@tabler/icons-react';

/**
 * Container for the Payroll section: a Run / Setup / Reports tab bar sitting
 * above the routed content. The tabs replace the old sidebar sub-nav (Runs /
 * Preview calculator). Preview stays reachable as a secondary action so a
 * working tool isn't stranded, but it isn't a primary tab.
 */
const TABS: { value: string; label: string; path: string }[] = [
  { value: 'run', label: 'Run', path: '/payroll' },
  { value: 'setup', label: 'Setup', path: '/payroll/setup' },
  { value: 'reports', label: 'Reports', path: '/payroll/reports' },
];

function activeTab(pathname: string): string {
  if (pathname.startsWith('/payroll/setup')) return 'setup';
  if (pathname.startsWith('/payroll/reports')) return 'reports';
  return 'run';
}

export function PayrollLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = activeTab(location.pathname);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Tabs
          value={active}
          onChange={(value) => {
            const tab = TABS.find((t) => t.value === value);
            if (tab) navigate(tab.path);
          }}
          variant="default"
        >
          <Tabs.List>
            {TABS.map((t) => (
              <Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        <Anchor component={RouterLink} to="/payroll/preview" size="sm" c="sand.6">
          <Group gap={6} wrap="nowrap">
            <IconCalculator size={16} />
            Preview calculator
          </Group>
        </Anchor>
      </Group>

      <Outlet />
    </Stack>
  );
}
