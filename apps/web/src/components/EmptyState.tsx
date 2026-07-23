import { Button, Center, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { Icon } from '@tabler/icons-react';

/** The standard "nothing here yet" shape: icon, one sentence, one primary action. */
export function EmptyState({
  icon: StateIcon, title, description, actionLabel, onAction, actionTo, py = 48,
}: {
  icon: Icon; title: string; description?: string;
  actionLabel?: string; onAction?: () => void; actionTo?: string; py?: number;
}) {
  return (
    <Center py={py}>
      <Stack gap={6} align="center" maw={380}>
        <StateIcon size={30} stroke={1.5} color="var(--mantine-color-sand-4)" />
        <Text fw={600} mt={4}>{title}</Text>
        {description && <Text size="sm" c="sand.6" ta="center">{description}</Text>}
        {actionLabel && actionTo && (
          <Button component={Link} to={actionTo} variant="light" mt="sm">{actionLabel}</Button>
        )}
        {actionLabel && !actionTo && onAction && (
          <Button onClick={onAction} variant="light" mt="sm">{actionLabel}</Button>
        )}
      </Stack>
    </Center>
  );
}
