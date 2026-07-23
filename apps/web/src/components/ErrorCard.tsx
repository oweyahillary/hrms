import { Button, Card, Center, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';

/**
 * The one shape a failed page-level load renders as everywhere: an icon, the
 * message, and a way to try again — never an infinite skeleton, never a
 * toast-only failure with no recovery in the page itself.
 */
export function ErrorCard({ message, onRetry, retrying }: {
  message: string; onRetry: () => void; retrying?: boolean;
}) {
  return (
    <Card p="xl" radius="md">
      <Center py={16}>
        <Stack gap={10} align="center" maw={420}>
          <IconAlertTriangle size={28} stroke={1.7} color="var(--mantine-color-red-6)" />
          <Text fw={600} ta="center">Something went wrong</Text>
          <Text size="sm" c="sand.6" ta="center">{message}</Text>
          <Button variant="light" mt="xs" loading={retrying} leftSection={<IconRefresh size={16} />} onClick={onRetry}>
            Retry
          </Button>
        </Stack>
      </Center>
    </Card>
  );
}
