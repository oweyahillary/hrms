import { createTheme, type MantineColorsTuple } from '@mantine/core';
import { shadesFromHex } from './brand-color';

// Default accent — deep evergreen-teal. Used when a client sets no brand colour.
const defaultBrand: MantineColorsTuple = [
  '#eef7f5', '#dbeae7', '#b7d5cf', '#8fbfb5', '#6bab9f',
  '#539e90', '#419686', '#2f8273', '#217365', '#0c6355',
];

// Warm sand/stone neutrals (not cold slate) — the real source of "warm & professional".
const sand: MantineColorsTuple = [
  '#faf9f7', '#f2f0ec', '#e8e4dd', '#d8d2c8', '#bcb3a5',
  '#978d7d', '#736a5c', '#554d41', '#3a332b', '#241f18',
];

// Honey-amber highlight for accents/positive emphasis.
const amber: MantineColorsTuple = [
  '#fdf6ec', '#f8e9d2', '#f0d0a3', '#e8b56f', '#e19f45',
  '#dd922c', '#dc8b20', '#c37716', '#ae6a11', '#975a08',
];

/**
 * Soft, warm-neutral elevation. Colour comes from the near-black in the sand
 * ramp (never pure black) so shadows read as depth, not a grey smear, and
 * stay consistent with the rest of the (brand-independent) neutral palette.
 */
const shadows = {
  xs: '0 1px 2px rgba(36, 31, 24, 0.06)',
  sm: '0 2px 8px rgba(36, 31, 24, 0.06), 0 1px 2px rgba(36, 31, 24, 0.04)',
  md: '0 8px 24px rgba(36, 31, 24, 0.08), 0 2px 6px rgba(36, 31, 24, 0.05)',
  lg: '0 16px 36px rgba(36, 31, 24, 0.10), 0 4px 10px rgba(36, 31, 24, 0.06)',
  xl: '0 24px 56px rgba(36, 31, 24, 0.14), 0 8px 18px rgba(36, 31, 24, 0.08)',
};

function makeTheme(brand: MantineColorsTuple) {
  return createTheme({
    primaryColor: 'brand',
    primaryShade: { light: 8, dark: 6 },
    // `gray` is what Mantine's own components (borders, `color="gray"`,
    // disabled states) fall back to when nothing else is specified. Left
    // alone it's Mantine's built-in cool grey, which clashes with this
    // theme's warm sand/stone neutrals — every unstyled border was quietly
    // the wrong temperature. Pointing it at the same ramp fixes that everywhere
    // at once, with no brand-colour implications (sand is brand-independent).
    colors: { brand, sand, amber, gray: sand },
    white: '#ffffff',
    black: '#241f18',
    defaultRadius: 'sm',
    // Rounder than the old scale (was 4/6/9/13/20) and more differentiated
    // step-to-step: inputs/buttons stay crisp at `sm`, surfaces like cards and
    // modals get a friendlier, more contemporary `md`/`lg`.
    radius: { xs: '6px', sm: '8px', md: '14px', lg: '18px', xl: '26px' },
    shadows,
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headings: {
      fontFamily: '"Plus Jakarta Sans", sans-serif',
      fontWeight: '650',
      sizes: {
        h1: { fontSize: '1.85rem', lineHeight: '1.25' },
        h2: { fontSize: '1.4rem', lineHeight: '1.3' },
        h3: { fontSize: '1.125rem', lineHeight: '1.35' },
        h4: { fontSize: '1rem', lineHeight: '1.4' },
      },
    },
    defaultGradient: { from: 'brand.7', to: 'brand.5', deg: 135 },
    components: {
      Button: { defaultProps: { fw: 600 } },
      // Elevation instead of a hard outline is the biggest single lever for a
      // more modern feel: a soft shadow reads as "surface floating above the
      // page" where a 1px border reads as "boxed form". Keep a hairline
      // border too (now warm, via the `gray` remap above) — shadow alone gets
      // muddy on a light background, the pair is crisp at every zoom level.
      Paper: { defaultProps: { withBorder: true, shadow: 'xs' } },
      Card: { defaultProps: { withBorder: true, shadow: 'xs' } },
      Modal: {
        defaultProps: {
          radius: 'lg',
          shadow: 'xl',
          overlayProps: { backgroundOpacity: 0.45, blur: 2 },
        },
      },
      Menu: { defaultProps: { radius: 'md', shadow: 'md' } },
      Tooltip: { defaultProps: { radius: 'sm' } },
      Popover: { defaultProps: { radius: 'md', shadow: 'md' } },
    },
    other: {
      appBg: '#faf9f7',
      surface: '#ffffff',
      border: '#e8e4dd',
      textMuted: '#736a5c',
    },
    });
}

/**
 * Build the theme for a client. With a valid brand hex the accent ramp is
 * generated from it (the client's exact colour lands on the primary shade);
 * otherwise the default evergreen-teal is used.
 */
export function buildTheme(brandColor?: string | null) {
  const shades = brandColor ? shadesFromHex(brandColor) : null;
  return makeTheme((shades as MantineColorsTuple | null) ?? defaultBrand);
}

/** Default theme (no client branding) — handy for tests/storybook. */
export const theme = buildTheme(null);
