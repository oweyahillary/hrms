/**
 * Prove the MFA (TOTP) path over HTTP, computing real codes from the enrolled
 * secret with otplib (same library the server uses):
 *  - setup returns a secret + otpauth URI; enable confirms with a code and
 *    returns one-time backup codes
 *  - once enabled, a password login no longer returns a session — it returns an
 *    MFA challenge; verifying the challenge with a TOTP code issues the session
 *  - a wrong code is rejected; a backup code works once and is then consumed
 *  - disable (with a current code) returns the account to password-only login
 * Restores the admin to no-MFA at the end so the run is idempotent.
 *
 *   cd apps/api && npx ts-node scripts/verify-mfa.ts
 */
import 'dotenv/config';
import { generateSync } from 'otplib';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const EMAIL = 'admin@example.com';
const PW = 'ChangeMe123!';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface LoginResult { status: number; accessToken?: string; mfaRequired?: boolean; mfaToken?: string }
async function login(): Promise<LoginResult> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    status: res.status,
    accessToken: body.accessToken as string | undefined,
    mfaRequired: body.mfaRequired as boolean | undefined,
    mfaToken: body.mfaToken as string | undefined,
  };
}

const post = async (path: string, token: string | null, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

const code = (secret: string): string => generateSync({ secret });

async function main(): Promise<void> {
  const first = await login();
  if (first.status !== 200 || !first.accessToken) {
    console.log('  FAIL  baseline admin login'); process.exit(1);
  }
  const token = first.accessToken;

  // Enrollment
  const setup = await post('/auth/mfa/setup', token, {});
  const secret = setup.json.secret as string;
  check('setup returns a secret', setup.status === 200 && typeof secret === 'string' && secret.length >= 16);
  check('setup returns an otpauth URI', String(setup.json.otpauthUri ?? '').startsWith('otpauth://totp/'));

  const enable = await post('/auth/mfa/enable', token, { token: code(secret) });
  const backupCodes = (enable.json.backupCodes as string[]) ?? [];
  check('enable confirms with a TOTP code', enable.status === 200 && enable.json.enabled === true);
  check('enable returns 10 one-time backup codes', backupCodes.length === 10);

  // Password login now yields a challenge, not a session.
  const challenged = await login();
  check('login now returns an MFA challenge (no session)',
    challenged.status === 200 && challenged.mfaRequired === true && !!challenged.mfaToken && !challenged.accessToken,
    `mfaRequired=${challenged.mfaRequired} hasAccess=${!!challenged.accessToken}`);

  // Wrong code rejected.
  const wrong = await post('/auth/mfa/verify', null, { mfaToken: challenged.mfaToken, code: '000000' });
  check('MFA verify rejects a wrong code (401)', wrong.status === 401, `status=${wrong.status}`);

  // Correct TOTP completes login.
  const good = await post('/auth/mfa/verify', null, { mfaToken: challenged.mfaToken, code: code(secret) });
  check('MFA verify with a TOTP code issues a session', good.status === 200 && typeof good.json.accessToken === 'string');

  // Backup code works once, then is consumed.
  const c2 = await login();
  const b1 = await post('/auth/mfa/verify', null, { mfaToken: c2.mfaToken, code: backupCodes[0] });
  check('a backup code completes login', b1.status === 200 && typeof b1.json.accessToken === 'string');
  const c3 = await login();
  const b1again = await post('/auth/mfa/verify', null, { mfaToken: c3.mfaToken, code: backupCodes[0] });
  check('the same backup code cannot be reused (401)', b1again.status === 401, `status=${b1again.status}`);

  // Disable with a current TOTP → back to password-only.
  const session = good.json.accessToken as string;
  const disable = await post('/auth/mfa/disable', session, { code: code(secret) });
  check('disable turns MFA off', disable.status === 200 && disable.json.enabled === false, `status=${disable.status}`);

  const afterDisable = await login();
  check('after disable, password login returns a session again',
    afterDisable.status === 200 && !!afterDisable.accessToken && !afterDisable.mfaRequired);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
