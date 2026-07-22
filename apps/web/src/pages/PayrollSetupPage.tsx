import { Link as RouterLink } from 'react-router-dom';
import { Badge, Card, Group, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import {
  IconCash, IconAdjustments, IconReceipt2, IconSettings, IconChevronRight, IconInfoCircle,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

interface SetupCard {
  to: string;
  icon: Icon;
  title: string;
  description: string;
  /** External (settings) vs in-section link — affects nothing but intent. */
  disabled?: boolean;
  note?: string;
}

const CARDS: SetupCard[] = [
  {
    to: '/payroll/setup/loans',
    icon: IconCash,
    title: 'Loans & advances',
    description: 'Issue and track staff loans and salary advances, and see outstanding balances. Advances are capped at two months\u2019 basic salary.',
  },
  {
    to: '/payroll/setup/deductions',
    icon: IconAdjustments,
    title: 'Deductions & bonuses',
    description: 'One-off deductions and bonuses applied to a specific payroll period, each with a recorded reason.',
  },
  {
    to: '/employees',
    icon: IconReceipt2,
    title: 'Salary structures',
    description: 'Salary revisions are managed per employee. A dedicated salary-revision screen has not been built yet \u2014 open an employee to view their current structure.',
    note: 'No dedicated screen yet',
  },
  {
    to: '/settings/payroll',
    icon: IconSettings,
    title: 'Payroll settings',
    description: 'Organisation-level payroll configuration, including the severance day-rate basis. Lives under Settings.',
  },
];

export function PayrollSetupPage() {
  return (
    <Stack gap="lg">
      <div>
        <Text fw={600} size="lg">Setup</Text>
        <Text c="sand.6" size="sm" mt={2}>
          Configure the inputs that feed a payroll run: staff loans, one-off adjustments, and pay settings.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {CARDS.map((card) => (
          <Card
            key={card.to}
            component={RouterLink}
            to={card.to}
            p="lg"
            radius="md"
            withBorder
            className="nav-item"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Group wrap="nowrap" align="flex-start" gap="md">
                <ThemeIcon size={42} radius="md" variant="light" color={card.note ? 'sand' : 'brand'}>
                  <card.icon size={22} stroke={1.7} />
                </ThemeIcon>
                <div>
                  <Group gap="xs">
                    <Text fw={600}>{card.title}</Text>
                    {card.note && (
                      <Badge size="xs" color="sand" variant="light" leftSection={<IconInfoCircle size={11} />}>
                        {card.note}
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" c="sand.6" mt={4}>{card.description}</Text>
                </div>
              </Group>
              <IconChevronRight size={18} color="var(--mantine-color-sand-4)" />
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
