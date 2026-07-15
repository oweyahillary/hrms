/**
 * Turn a single brand hex into the 10-shade ramp Mantine expects.
 *
 * A client supplies one colour (e.g. "#0c6355"); Mantine needs shades 0 (lightest)
 * → 9 (darkest). The supplied colour is placed at index 8 — the shade this theme
 * uses as `primaryShade` in light mode — so buttons and accents render as exactly
 * the colour the client picked. Lighter steps interpolate toward white for
 * backgrounds/hovers, and index 9 is a slightly darker step for pressed states.
 */

/** Where the client's own colour lands, matching theme.primaryShade.light. */
const PRIMARY_INDEX = 8;

export type Rgb = { r: number; g: number; b: number };

/** Parse "#rrggbb" (or "rrggbb"). Returns null when the input isn't a 6-digit hex. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix: amount 0 → colour, 1 → target. */
function mix(colour: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: colour.r + (target.r - colour.r) * amount,
    g: colour.g + (target.g - colour.g) * amount,
    b: colour.b + (target.b - colour.b) * amount,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * Build the 10 shades. Returns null for invalid input so callers can fall back
 * to the default theme rather than render a broken palette.
 */
export function shadesFromHex(hex: string): string[] | null {
  const base = parseHex(hex);
  if (!base) return null;

  const shades: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    if (i === PRIMARY_INDEX) {
      shades.push(toHex(base));
    } else if (i < PRIMARY_INDEX) {
      // 0 is nearly white, approaching the base colour as i rises.
      const amount = ((PRIMARY_INDEX - i) / PRIMARY_INDEX) * 0.94;
      shades.push(toHex(mix(base, WHITE, amount)));
    } else {
      shades.push(toHex(mix(base, BLACK, 0.18)));
    }
  }
  return shades;
}

/**
 * Readable foreground ("#fff" or a near-black) for text sitting on the brand
 * colour, chosen by relative luminance so a light brand colour doesn't produce
 * white-on-yellow. Threshold follows the usual WCAG-style luminance split.
 */
export function readableOn(hex: string): string {
  const c = parseHex(hex);
  if (!c) return '#ffffff';
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  return luminance > 0.45 ? '#241f18' : '#ffffff';
}
