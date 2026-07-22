/**
 * Prove the severance calculator end-to-end over HTTP: redundancy is the ONLY
 * reason that attracts statutory severance (every other reason returns 0 with a
 * reported reason, not an omission); "completed year" floors a partial year;
 * notice follows pay frequency and a longer contractual notice overrides the
 * statutory minimum; and calculationBreakdown carries enough to reconstruct the
 * payout by hand.
 *
 *   cd apps/api && npx ts-node scripts/verify-severance.ts
 *
 * Requires the API running (BASE_URL, default http://localhost:3000/api).
 * Severance calculations are not payroll runs, so there are no period
 * collisions to avoid.
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface Breakdown {
  reason: string; hireDate: string; exitDate: string; basicSalary: number; daysPerMonth: number; dailyRate: number;
  severance: { applies: boolean; daysPerYear: number; completedYears: number; formula: string; gross: number; note: string };
  notice: { payFrequency: string; statutoryDays: number; contractualDays: number | null; appliedDays: number; basis: string; payInLieu: number };
  paye: {
    status: string; note: string; paye?: number | null;
    bucket?: string; periods?: number; amountPerPeriod?: number; payePerPeriod?: number;
    net?: number | null; taxableGross?: number;
  };
  totals: { severanceGross: number; noticePayInLieu: number; grossExitPay: number };
}
interface SeveranceResult {
  id?: string; severanceAmount: number; noticePeriodDays: number; calculationBreakdown: Breakdown;
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login — no access token'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };
  const stamp = Date.now();
  let nid = 0;

  async function makeEmployee(tag: string, hireDate: string, basic: number): Promise<string> {
    const res = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `${tag}-${stamp}`, firstName: tag, lastName: 'Severance',
        nationalId: String(stamp).slice(-7) + String(nid++), employmentType: 'PERMANENT', hireDate,
      }),
    });
    const id = ((await res.json()) as { id?: string }).id;
    if (!id) throw new Error(`employee create failed for ${tag}`);
    await fetch(`${BASE}/employees/${id}/salary-structures`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ basicSalary: basic, effectiveDate: hireDate , reason: 'Salary revision'}),
    });
    return id;
  }

  async function calc(empId: string, body: Record<string, unknown>): Promise<SeveranceResult> {
    const res = await fetch(`${BASE}/employees/${empId}/severance-calculations`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ contractTermType: 'NO_PROVISION', ...body }),
    });
    return (await res.json()) as SeveranceResult;
  }

  async function getCalc(id: string): Promise<SeveranceResult> {
    const res = await fetch(`${BASE}/severance-calculations/${id}`, { headers: auth });
    return (await res.json()) as SeveranceResult;
  }

  async function setBasis(basis: 'CALENDAR_30' | 'WORKING_26'): Promise<void> {
    await fetch(`${BASE}/organization/payroll-settings`, {
      method: 'PATCH', headers: authJson, body: JSON.stringify({ severanceDayRateBasis: basis }),
    });
  }

  // Baseline the org to the default so scenarios 1–5 run under CALENDAR_30
  // regardless of any prior state.
  await setBasis('CALENDAR_30');

  // ── Scenario 1: redundancy, whole years, monthly-paid — the core happy path ──
  const e1 = await makeEmployee('SEV1', '2019-01-01', 60000);
  const r1 = await calc(e1, { reason: 'REDUNDANCY', exitDate: '2024-06-30', payFrequency: 'MONTHLY' });
  const b1 = r1.calculationBreakdown;
  check('redundancy severance is paid', r1.severanceAmount > 0, String(r1.severanceAmount));
  check('completed years = 5 (2019-01-01 → 2024-06-30)', b1.severance.completedYears === 5, String(b1.severance.completedYears));
  check("day's pay = basic / 30 (60000 → 2000)", b1.dailyRate === 2000, String(b1.dailyRate));
  check('severance = 2000 × 15 × 5 = 150000', r1.severanceAmount === 150000, String(r1.severanceAmount));
  check('breakdown reconstructs the payout by hand (dailyRate × 15 × years)',
    round2(b1.dailyRate * b1.severance.daysPerYear * b1.severance.completedYears) === r1.severanceAmount,
    `${b1.dailyRate}×${b1.severance.daysPerYear}×${b1.severance.completedYears}`);
  check('monthly notice = 28 statutory days', r1.noticePeriodDays === 28, String(r1.noticePeriodDays));
  check('breakdown captures every input (basic, hire, exit)', b1.basicSalary === 60000 && b1.hireDate === '2019-01-01' && b1.exitDate === '2024-06-30', JSON.stringify({ b: b1.basicSalary, h: b1.hireDate, x: b1.exitDate }));
  // PAYE is deliberately never silently trusted. Two acceptable, flagged states:
  //  - PROVISIONAL_UNVERIFIED: rates were in force, a provisional figure was
  //    computed but marked unverified (carries the KRA caveat, emits a number);
  //  - UNAVAILABLE: no statutory rate in force for the exit date, so the system
  //    refused to invent one (carries the KRA caveat, emits null).
  // Both prove the point; a bare trusted number would not. Which one you see
  // depends only on whether the DB has rates in force for the exit date.
  const payeFlagged = b1.paye.status === 'PROVISIONAL_UNVERIFIED' || b1.paye.status === 'UNAVAILABLE';
  const payeContractHeld = b1.paye.status === 'PROVISIONAL_UNVERIFIED'
    ? typeof b1.paye.paye === 'number' // computed a provisional figure
    : b1.paye.paye === null; // degraded cleanly, no invented number
  check('PAYE is flagged (never silently trusted), with the KRA caveat',
    payeFlagged && payeContractHeld && /KRA/i.test(b1.paye.note),
    JSON.stringify({ status: b1.paye.status, paye: b1.paye.paye }));
  check('totals expose severance + notice-in-lieu', b1.totals.severanceGross === 150000 && b1.totals.grossExitPay === round2(150000 + b1.notice.payInLieu), JSON.stringify(b1.totals));

  // ── Scenario 2: "completed year" — a partial final year must NOT count ──
  // Hired 2019-07-15, exits 2024-06-30: one month short of the 5th anniversary.
  const e2 = await makeEmployee('SEV2', '2019-07-15', 60000);
  const r2 = await calc(e2, { reason: 'REDUNDANCY', exitDate: '2024-06-30', payFrequency: 'MONTHLY' });
  check('a partial final year does NOT count (4 completed, not 5)', r2.calculationBreakdown.severance.completedYears === 4, String(r2.calculationBreakdown.severance.completedYears));
  check('severance uses the floored years: 2000 × 15 × 4 = 120000', r2.severanceAmount === 120000, String(r2.severanceAmount));

  // ── Scenario 3: only redundancy pays — others are 0 but still reported ──
  const e3 = await makeEmployee('SEV3', '2019-01-01', 60000);
  for (const reason of ['RESIGNATION', 'TERMINATION', 'RETIREMENT']) {
    const r = await calc(e3, { reason, exitDate: '2024-06-30', payFrequency: 'MONTHLY' });
    const bd = r.calculationBreakdown;
    check(`${reason}: severance is 0`, r.severanceAmount === 0, String(r.severanceAmount));
    check(`${reason}: the zero case is reported (applies=false + a reason note)`, bd.severance.applies === false && /redundancy only/i.test(bd.severance.note), bd.severance.note);
    check(`${reason}: years of service are still shown (not omitted)`, bd.severance.completedYears === 5, String(bd.severance.completedYears));
  }

  // ── Scenario 4: notice — contractual overrides statutory only when longer ──
  const e4 = await makeEmployee('SEV4', '2020-01-01', 30000);
  const longer = await calc(e4, { reason: 'REDUNDANCY', exitDate: '2024-01-01', payFrequency: 'MONTHLY', contractualNoticeDays: 90 });
  check('a longer contractual notice (90) overrides the 28-day statutory minimum', longer.noticePeriodDays === 90, String(longer.noticePeriodDays));
  check('notice basis is recorded as contractual', longer.calculationBreakdown.notice.basis === 'contractual', longer.calculationBreakdown.notice.basis);
  check('notice pay in lieu = 1000/day × 90 = 90000', longer.calculationBreakdown.notice.payInLieu === 90000, String(longer.calculationBreakdown.notice.payInLieu));

  const shorter = await calc(e4, { reason: 'REDUNDANCY', exitDate: '2024-01-01', payFrequency: 'MONTHLY', contractualNoticeDays: 14 });
  check('a shorter contractual notice (14) never lowers the 28-day statutory floor', shorter.noticePeriodDays === 28, String(shorter.noticePeriodDays));
  check('notice basis falls back to statutory', shorter.calculationBreakdown.notice.basis === 'statutory', shorter.calculationBreakdown.notice.basis);

  const daily = await calc(e4, { reason: 'REDUNDANCY', exitDate: '2024-01-01', payFrequency: 'DAILY' });
  check('daily-paid: no statutory notice (0 days)', daily.noticePeriodDays === 0, String(daily.noticePeriodDays));

  // ── Scenario 5: the day-rate basis is an org setting, applied to NEW calcs ──
  await setBasis('WORKING_26');
  const e5 = await makeEmployee('SEV5', '2019-01-01', 60000);
  const r5 = await calc(e5, { reason: 'REDUNDANCY', exitDate: '2024-06-30', payFrequency: 'MONTHLY' });
  check('WORKING_26 basis: day\'s pay = 60000 / 26 = 2307.69', r5.calculationBreakdown.dailyRate === 2307.69, String(r5.calculationBreakdown.dailyRate));
  check('WORKING_26 basis: severance = 2307.69 × 15 × 5 = 173076.75', r5.severanceAmount === 173076.75, String(r5.severanceAmount));
  check('WORKING_26 basis: breakdown snapshots daysPerMonth = 26', r5.calculationBreakdown.daysPerMonth === 26, String(r5.calculationBreakdown.daysPerMonth));

  // ── Scenario 6: changing the org setting does NOT alter past calculations ──
  // r1 was computed under CALENDAR_30. After the switch to WORKING_26 above, its
  // persisted record must be untouched — the basis is snapshotted per record.
  const r1AfterSwitch = await getCalc(r1.id!);
  check('a prior calculation keeps its stored amount after the org basis changes',
    r1AfterSwitch.severanceAmount === 150000, String(r1AfterSwitch.severanceAmount));
  check('a prior calculation keeps its snapshotted daysPerMonth = 30',
    r1AfterSwitch.calculationBreakdown.daysPerMonth === 30, String(r1AfterSwitch.calculationBreakdown.daysPerMonth));

  // Leave the org back on the default so re-runs start clean.
  await setBasis('CALENDAR_30');

  // ── Scenario 7: contract-type buckets — the KRA PAYE spread genuinely
  // differs by bucket, not just "accepted with a flag" like scenarios 1–6.
  // verify-severance.ts previously only ever sent NO_PROVISION (the `calc()`
  // helper's default) to the live server — FIXED_TERM and
  // UNSPECIFIED_WITH_CLAUSE were unit-tested in isolation only. This exit
  // date (2026-06-30) is deliberately inside full statutory-rate coverage —
  // unlike scenarios 1–6's 2024 dates, which predate the seeded NSSF rate and
  // so only ever exercise the UNAVAILABLE degrade path — specifically so PAYE
  // computes real numbers here and those numbers can be checked by hand.
  const e7 = await makeEmployee('SEV7', '2020-01-01', 60000);

  // FIXED_TERM: the lump sum spreads over the unexpired contract months.
  const fixedTerm = await calc(e7, {
    reason: 'REDUNDANCY', exitDate: '2026-06-30', payFrequency: 'MONTHLY',
    contractTermType: 'FIXED_TERM', unexpiredTermMonths: 6,
  });
  const ftPaye = fixedTerm.calculationBreakdown.paye;
  check('FIXED_TERM: severance = 2000 × 15 × 6 = 180000', fixedTerm.severanceAmount === 180000, String(fixedTerm.severanceAmount));
  check('FIXED_TERM: bucket recorded on the breakdown', ftPaye.bucket === 'FIXED_TERM', String(ftPaye.bucket));
  check('FIXED_TERM: spreads over the 6 unexpired months (not some other period count)', ftPaye.periods === 6, String(ftPaye.periods));
  check('FIXED_TERM: each period is an even slice (180000 / 6 = 30000)', ftPaye.amountPerPeriod === 30000, String(ftPaye.amountPerPeriod));
  check('FIXED_TERM: PAYE actually computed a figure this time (rates in force)',
    ftPaye.status === 'PROVISIONAL_UNVERIFIED' && typeof ftPaye.paye === 'number',
    JSON.stringify({ status: ftPaye.status, paye: ftPaye.paye }));
  // By hand: 30000 taxable -> 24000 @10% + 6000 @25% = 2400 + 1500 = 3900 before
  // relief; minus the 2400 personal relief = 1500/period; × 6 periods = 9000.
  check('FIXED_TERM: PAYE per period = 1500 (24000@10% + 6000@25%, less 2400 relief)', ftPaye.payePerPeriod === 1500, String(ftPaye.payePerPeriod));
  check('FIXED_TERM: total PAYE = 1500 × 6 = 9000', ftPaye.paye === 9000, String(ftPaye.paye));
  check('FIXED_TERM: net = taxableGross − PAYE (180000 − 9000 = 171000)', ftPaye.net === 171000, String(ftPaye.net));

  // UNSPECIFIED_WITH_CLAUSE: spreads forward at the pre-termination monthly rate.
  const unspecified = await calc(e7, {
    reason: 'REDUNDANCY', exitDate: '2026-06-30', payFrequency: 'MONTHLY',
    contractTermType: 'UNSPECIFIED_WITH_CLAUSE',
  });
  const uwPaye = unspecified.calculationBreakdown.paye;
  check('UNSPECIFIED_WITH_CLAUSE: severance is the same 180000 (bucket only changes the PAYE spread)', unspecified.severanceAmount === 180000, String(unspecified.severanceAmount));
  check('UNSPECIFIED_WITH_CLAUSE: bucket recorded on the breakdown', uwPaye.bucket === 'UNSPECIFIED_WITH_CLAUSE', String(uwPaye.bucket));
  check('UNSPECIFIED_WITH_CLAUSE: spreads at the pre-termination monthly rate (60000/period over 3 periods)',
    uwPaye.amountPerPeriod === 60000 && uwPaye.periods === 3,
    JSON.stringify({ amountPerPeriod: uwPaye.amountPerPeriod, periods: uwPaye.periods }));
  check('UNSPECIFIED_WITH_CLAUSE: PAYE actually computed a figure (rates in force)',
    uwPaye.status === 'PROVISIONAL_UNVERIFIED' && typeof uwPaye.paye === 'number',
    JSON.stringify({ status: uwPaye.status, paye: uwPaye.paye }));
  // By hand: 60000 taxable -> 24000@10% + 8333@25% + 27667@30%
  //   = 2400 + 2083.25 + 8300.10 = 12783.35 before relief; minus 2400 relief = 10383.35/period.
  check('UNSPECIFIED_WITH_CLAUSE: PAYE per period = 10383.35 (three PAYE bands, less relief)', uwPaye.payePerPeriod === 10383.35, String(uwPaye.payePerPeriod));
  check('UNSPECIFIED_WITH_CLAUSE: total PAYE = 10383.35 × 3 = 31150.05', uwPaye.paye === 31150.05, String(uwPaye.paye));
  check('UNSPECIFIED_WITH_CLAUSE: net = taxableGross − PAYE (180000 − 31150.05 = 148849.95)', uwPaye.net === 148849.95, String(uwPaye.net));

  // Same severance principal, genuinely different PAYE outcomes — proves the
  // bucket selection actually drives the spread instead of being a no-op.
  check('FIXED_TERM and UNSPECIFIED_WITH_CLAUSE produce different total PAYE for the same lump sum',
    ftPaye.paye !== uwPaye.paye, `${ftPaye.paye} vs ${uwPaye.paye}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
