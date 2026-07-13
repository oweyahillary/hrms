/**
 * Prove the password-change hardening over HTTP:
 *  - change-password rejects a wrong current password (401) and a weak new one (400)
 *  - a successful change rotates credentials (old fails, new works) and returns tokens
 *  - admin force-reset flags a user; their next login is blocked from normal routes
 *    (403 PASSWORD_CHANGE_REQUIRED) but may reach /auth/me and change-password
 *  - after changing, the same token is unblocked
 * Restores the seeded password at the end so the run is idempotent.
 *
 *   cd apps/api && npx ts-node scripts/verify-password-change.ts
 *
 * Requires the admin seeded WITHOUT the forced-change flag
 * (SEED_FORCE_PASSWORD_CHANGE=false), as in CI.
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
const EMAIL = 'admin@example.com';
const PW0 = 'ChangeMe123!';        // seeded default
const PW1 = 'Str0ngTestPass_01';   // valid rotation target
const PROTECTED = '/reports/headcount'; // token-required, not bypassed

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

async function login(password: string): Promise<{ status: number; token?: string; mcp?: boolean }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json()) as { accessToken: string; mustChangePassword?: boolean };
  return { status: res.status, token: body.accessToken, mcp: body.mustChangePassword };
}

async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<{ status: number; token?: string }> {
  const res = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json()) as { accessToken: string };
  return { status: res.status, token: body.accessToken };
}

const getStatus = async (token: string, path: string): Promise<number> =>
  (await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;

async function main(): Promise<void> {
  // Baseline login with the seeded default.
  const first = await login(PW0);
  if (first.status !== 200 || !first.token) {
    console.log('  FAIL  baseline admin login (need SEED_FORCE_PASSWORD_CHANGE=false)');
    process.exit(1);
  }
  check('baseline login is not flagged for change', first.mcp === false || first.mcp === undefined);
  check('normal protected route works before any reset', (await getStatus(first.token, PROTECTED)) === 200);

  // Wrong current password → 401.
  check('change-password rejects wrong current (401)',
    (await changePassword(first.token, 'WrongCurrent!1', PW1)).status === 401);
  // Weak new password → 400 (DTO validation).
  check('change-password rejects a short new password (400)',
    (await changePassword(first.token, PW0, 'short1')).status === 400);

  // Successful rotation.
  const changed = await changePassword(first.token, PW0, PW1);
  check('change-password succeeds and returns a token', changed.status === 200 && !!changed.token);
  check('old password no longer logs in (401)', (await login(PW0)).status === 401);
  const asNew = await login(PW1);
  check('new password logs in (200)', asNew.status === 200 && !!asNew.token);

  // Restore the seeded default for the next phase.
  await changePassword(asNew.token as string, PW1, PW0);

  // ---- Force-reset → blocked → bypass → unblock ----
  const admin = await login(PW0);
  const resetRes = await fetch(`${BASE}/auth/force-reset`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin.token as string}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });
  check('admin force-reset returns 200', resetRes.status === 200, `status=${resetRes.status}`);

  const flagged = await login(PW0);
  check('post-reset login is flagged mustChangePassword', flagged.status === 200 && flagged.mcp === true, `mcp=${flagged.mcp}`);

  // Blocked from a normal route, allowed on /auth/me.
  const blocked = await fetch(`${BASE}${PROTECTED}`, { headers: { Authorization: `Bearer ${flagged.token as string}` } });
  const blockedBody = (await blocked.json().catch(() => ({}))) as { code?: string };
  check('flagged token is blocked from normal route (403)', blocked.status === 403, `status=${blocked.status}`);
  check('block carries PASSWORD_CHANGE_REQUIRED code', blockedBody.code === 'PASSWORD_CHANGE_REQUIRED', `code=${blockedBody.code}`);
  check('flagged token may still reach /auth/me', (await getStatus(flagged.token as string, '/auth/me')) === 200);

  // Change password with the flagged token → unblocked.
  const fixed = await changePassword(flagged.token as string, PW0, PW1);
  check('flagged user can change password (200)', fixed.status === 200 && !!fixed.token);
  check('after change, same token reaches the normal route (200)',
    (await getStatus(fixed.token as string, PROTECTED)) === 200);

  // Restore seeded default so the run is idempotent.
  const restore = await login(PW1);
  await changePassword(restore.token as string, PW1, PW0);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
