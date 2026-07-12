/** Upload constraints. */
export const ALLOWED_UPLOAD_MIME: ReadonlySet<string> = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Logo uploads: raster images only (pdfkit embeds PNG/JPEG, not SVG), capped small. */
export const ALLOWED_LOGO_MIME: ReadonlySet<string> = new Set([
  'image/png', 'image/jpeg',
]);
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** Strip any path, keep only safe characters, cap length. Never empty. */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '');
  const trimmed = cleaned.slice(0, 120);
  return trimmed.length ? trimmed : 'file';
}

/** Content-Type from a filename's extension (for downloads). */
export function contentTypeFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}
