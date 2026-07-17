/**
 * Thin API client. The access token lives in memory; the refresh token is
 * persisted so a reload can re-establish the session. On a 401 the client
 * refreshes once and retries the original request.
 */
const REFRESH_KEY = 'hrms.refresh';

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void { accessToken = token; }
export function getRefreshToken(): string | null { return localStorage.getItem(REFRESH_KEY); }
export function setRefreshToken(token: string | null): void {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}
export function setOnAuthLost(fn: (() => void) | null): void { onAuthLost = fn; }

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  // FormData must keep the browser-generated multipart boundary, so only JSON
  // bodies get an explicit content type.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`/api${path}`, { ...init, headers });
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!data.accessToken) return false;
  setAccessToken(data.accessToken);
  if (data.refreshToken) setRefreshToken(data.refreshToken);
  return true;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);

  if (res.status === 401 && accessToken !== null) {
    if (await tryRefresh()) {
      res = await raw(path, init);
    } else {
      setAccessToken(null);
      setRefreshToken(null);
      onAuthLost?.();
    }
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message ?? res.statusText;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message, body);
  }
  return body as T;
}

/**
 * Download a binary response (PDF/CSV/XLSX) and save it via the browser's
 * normal download UI. There's no JSON body to decode here, so this doesn't
 * reuse `api()` — but it shares the same auth-header + single-retry-on-401
 * shape as `raw()`/`tryRefresh()` above.
 *
 * The filename is taken from the server's `Content-Disposition` header when
 * present (every payroll download endpoint sets one); `fallbackFilename` is
 * only a safety net.
 */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  let res = await raw(path, {});

  if (res.status === 401 && accessToken !== null) {
    if (await tryRefresh()) {
      res = await raw(path, {});
    } else {
      setAccessToken(null);
      setRefreshToken(null);
      onAuthLost?.();
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    const text = await res.text();
    if (text) {
      try {
        const body = JSON.parse(text) as { message?: string | string[] };
        if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      } catch {
        // Not JSON — fall back to statusText.
      }
    }
    throw new ApiError(res.status, message);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
