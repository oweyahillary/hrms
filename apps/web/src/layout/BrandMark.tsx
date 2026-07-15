import { Box, Group, Text } from '@mantine/core';

/**
 * Brand mark. With `name` (the client org) it shows a monogram from that name +
 * the name; without, it falls back to the product wordmark (e.g. the login page).
 */
export function BrandMark({ name, compact = false }: { name?: string; compact?: boolean }) {
  const label = name?.trim();
  const monogram = (label ? label[0] : 'H').toUpperCase();

  return (
    <Group gap="xs" wrap="nowrap">
      <Box
        w={32} h={32}
        style={{
          borderRadius: 8,
          background: 'linear-gradient(135deg, var(--mantine-color-brand-8), var(--mantine-color-brand-6))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', flexShrink: 0,
        }}
      >
        {monogram}
      </Box>
      {!compact && (
        label ? (
          <Text fw={700} size="md" style={{ letterSpacing: '-0.01em', lineHeight: 1.15 }} lineClamp={1}>
            {label}
          </Text>
        ) : (
          <Text fw={700} size="lg" style={{ letterSpacing: '-0.02em' }}>
            Harambee<Text span c="brand.7" inherit>HR</Text>
          </Text>
        )
      )}
    </Group>
  );
}
