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

function makeTheme(brand: MantineColorsTuple) {
  return createTheme({
    primaryColor: 'brand',
    primaryShade: { light: 8, dark: 6 },
    colors: { brand, sand, amber },
    white: '#ffffff',
    black: '#241f18',
    defaultRadius: 'sm',
    radius: { xs: '4px', sm: '6px', md: '9px', lg: '13px', xl: '20px' },
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headings: {
      fontFamily: '"Plus Jakarta Sans", sans-serif',
      fontWeight: '600',
      sizes: {
        h1: { fontSize: '1.75rem', lineHeight: '1.25' },
        h2: { fontSize: '1.35rem', lineHeight: '1.3' },
        h3: { fontSize: '1.1rem', lineHeight: '1.35' },
      },
    },
    defaultGradient: { from: 'brand.8', to: 'brand.6', deg: 135 },
    components: {
      Button: { defaultProps: { fw: 600 } },
      Paper: { defaultProps: { withBorder: true, shadow: 'none' } },
      Card: { defaultProps: { withBorder: true, shadow: 'none' } },
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
