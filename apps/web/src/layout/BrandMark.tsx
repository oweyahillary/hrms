import { Box, Group, Image, Text } from '@mantine/core';
import { logoUrl } from '../api/branding';
import { useBranding } from '../branding/BrandingContext';

type Size = 'md' | 'lg';

const LOGO_DIMS: Record<Size, { h: number; maxWidth: number }> = {
  md: { h: 34, maxWidth: 180 }, // sidebar
  lg: { h: 64, maxWidth: 260 }, // sign-in card — the logo is the hero here
};

/**
 * The client's mark: their uploaded logo when there is one, otherwise a
 * monogram tile from their name. Falls back to the product wordmark only when
 * no organisation branding is available at all.
 */
export function BrandMark({
  name, compact = false, size = 'md',
}: { name?: string; compact?: boolean; size?: Size }) {
  const { branding, version } = useBranding();
  const label = (name ?? branding.name ?? '').trim();
  const monogram = (label ? label[0] : 'H').toUpperCase();

  if (branding.hasLogo) {
    // The logo carries the company's identity (and usually its name), so it
    // stands alone — pairing it with the name crowds the layout and truncates
    // both. The name stays available to screen readers via alt text.
    const dims = LOGO_DIMS[size];
    return (
      <Image
        src={logoUrl(version)}
        alt={label || 'Logo'}
        h={compact ? 28 : dims.h}
        w="auto"
        fit="contain"
        style={{ maxWidth: compact ? 40 : dims.maxWidth }}
      />
    );
  }

  const tile = size === 'lg' ? 44 : 32;
  return (
    <Group gap="xs" wrap="nowrap">
      <Box
        w={tile} h={tile}
        style={{
          borderRadius: size === 'lg' ? 11 : 8,
          background: 'linear-gradient(135deg, var(--mantine-color-brand-8), var(--mantine-color-brand-6))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: size === 'lg' ? 20 : 15,
          letterSpacing: '-0.02em', flexShrink: 0,
        }}
      >
        {monogram}
      </Box>
      {!compact && (
        label ? (
          <Text fw={700} size={size === 'lg' ? 'lg' : 'md'} style={{ letterSpacing: '-0.01em', lineHeight: 1.15 }} lineClamp={1}>
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
