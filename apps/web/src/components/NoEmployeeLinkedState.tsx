import { Card, Center, Stack, Text } from '@mantine/core';
import { IconUserOff } from '@tabler/icons-react';

/**
 * Shown on a /me/* page when the signed-in account has no Employee record
 * linked (e.g. an Admin/HR login used only for administration, or a login
 * whose employee was never attached). Deliberately not an ErrorCard: retrying
 * can't fix this — an admin has to link the account to an employee first.
 */
export function NoEmployeeLinkedState() {
  return (
    <Card p="xl" radius="md">
      <Center py={16}>
        <Stack gap={6} align="center" maw={420}>
          <IconUserOff size={28} stroke={1.7} color="var(--mantine-color-sand-4)" />
          <Text fw={600} ta="center">No employee profile linked</Text>
          <Text size="sm" c="sand.6" ta="center">
            Your account isn&apos;t linked to an employee record, so there&apos;s nothing to
            show here. Ask an admin to link your account to an employee profile.
          </Text>
        </Stack>
      </Center>
    </Card>
  );
}
