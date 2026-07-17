/**
 * Prove the employees list contract over HTTP: search, sort, pagination, filters,
 * and the PII posture of list vs detail.
 *
 * Creates its own cohort with a unique tag so it is independent of whatever else
 * lives on the DB (CI seeds a fresh one; locally there are leftover BANK-/P9-/RPT-
 * employees). Every assertion is RELATIONAL — "the tagged rows come back in this
 * order", never "the DB holds exactly N employees" — so the gate survives other
 * scripts creating data before it.
 *
 *   cd apps/api && npx ts-node scripts/verify-employees.ts
 */
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000/api';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`  PASS  ${label}`); pass += 1; }
  else { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); fail += 1; }
}

interface ListRow {
  id: string; employeeNumber: string; firstName: string; lastName: string;
  fullName: string; employmentStatus: string; hireDate: string;
  nationalId?: unknown; kraPin?: unknown; bankAccountNumber?: unknown;
}
interface ListBody {
  data: ListRow[]; page: number; pageSize: number; total: number; totalPages: number;
}

async function main(): Promise<void> {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'ChangeMe123!' }),
  });
  const token = ((await login.json()) as { accessToken?: string }).accessToken;
  if (!token) { console.log('  FAIL  login'); process.exit(1); }
  const auth = { Authorization: `Bearer ${token}` };
  const authJson = { ...auth, 'Content-Type': 'application/json' };

  const stamp = Date.now();
  const tag = `EMPQ${stamp}`; // unique, and a substring of every employeeNumber below

  const getList = async (qs: string): Promise<ListBody> => {
    const r = await fetch(`${BASE}/employees?${qs}`, { headers: auth });
    return (await r.json()) as ListBody;
  };

  // --- cohort: three employees, deliberately ordered differently by name vs hire date
  // Fixture values must satisfy src/common/validation/kenya.ts:
  //   nationalId  /^\d{7,8}$/        -> 7 stamp digits + seq = 8 digits
  //   kraPin      /^[AP]\d{9}[A-Z]$/ -> 'A' + 8 stamp digits + seq + check letter 'Z'
  const mk = async (
    seq: string, firstName: string, lastName: string, hireDate: string,
  ): Promise<string> => {
    const r = await fetch(`${BASE}/employees`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({
        employeeNumber: `${tag}-${seq}`, firstName, lastName,
        nationalId: `${String(stamp).slice(-7)}${seq}`,
        kraPin: `A${String(stamp).slice(-8)}${seq}Z`,
        bankAccountNumber: `01234567${seq}`,
        bankName: 'Test Bank',
        bankCode: '11',
        bankBranchCode: '022',
        employmentType: 'PERMANENT', hireDate,
      }),
    });
    const body = (await r.json()) as { id?: string; message?: string };
    if (!body.id) { console.log(`  FAIL  create ${seq} — ${JSON.stringify(body.message)}`); process.exit(1); }
    return body.id;
  };

  // Name order (asc by lastName): Achieng, Baraka, Cheruiyot
  // Hire order (asc):             Cheruiyot(2021), Achieng(2022), Baraka(2023)
  // The two orders disagree, so a passing sort test can't be a coincidence.
  const idA = await mk('1', 'Amina', 'Achieng', '2022-06-01');
  const idB = await mk('2', 'Brian', 'Baraka', '2023-02-15');
  const idC = await mk('3', 'Carol', 'Cheruiyot', '2021-09-30');

  // --- search
  const byTag = await getList(`q=${tag}&pageSize=100`);
  check('search matches employeeNumber substring', byTag.total === 3, `got total=${byTag.total}`);

  const bySurname = await getList(`q=Cheruiyot&pageSize=100`);
  check(
    'search matches lastName',
    bySurname.data.some((r) => r.id === idC),
    'Cheruiyot not found',
  );

  const byFirst = await getList(`q=amina&pageSize=100`);
  check(
    'search is case-insensitive on firstName',
    byFirst.data.some((r) => r.id === idA),
    '"amina" did not match "Amina"',
  );

  const noMatch = await getList(`q=${tag}ZZZNOPE&pageSize=100`);
  check('search with no matches returns empty, not everything', noMatch.total === 0, `got ${noMatch.total}`);

  const blank = await getList(`q=%20%20&pageSize=100`);
  check('blank search collapses to no filter', blank.total >= 3, `got ${blank.total}`);

  // --- sort (scoped to our cohort via q, so other rows can't interfere)
  const nameAsc = await getList(`q=${tag}&sort=name&order=asc&pageSize=100`);
  check(
    'sort=name&order=asc orders by surname',
    nameAsc.data.map((r) => r.id).join() === [idA, idB, idC].join(),
    nameAsc.data.map((r) => r.lastName).join(),
  );

  const nameDesc = await getList(`q=${tag}&sort=name&order=desc&pageSize=100`);
  check(
    'sort=name&order=desc reverses',
    nameDesc.data.map((r) => r.id).join() === [idC, idB, idA].join(),
    nameDesc.data.map((r) => r.lastName).join(),
  );

  const hireAsc = await getList(`q=${tag}&sort=hireDate&order=asc&pageSize=100`);
  check(
    'sort=hireDate&order=asc differs from name order (proves the key is honoured)',
    hireAsc.data.map((r) => r.id).join() === [idC, idA, idB].join(),
    hireAsc.data.map((r) => r.hireDate).join(),
  );

  const numAsc = await getList(`q=${tag}&sort=employeeNumber&order=asc&pageSize=100`);
  check(
    'sort=employeeNumber&order=asc',
    numAsc.data.map((r) => r.id).join() === [idA, idB, idC].join(),
    numAsc.data.map((r) => r.employeeNumber).join(),
  );

  const badSort = await fetch(`${BASE}/employees?sort=nationalId`, { headers: auth });
  check('unknown sort column is rejected (400)', badSort.status === 400, `got ${badSort.status}`);

  const badOrder = await fetch(`${BASE}/employees?order=sideways`, { headers: auth });
  check('unknown order direction is rejected (400)', badOrder.status === 400, `got ${badOrder.status}`);

  // --- pagination
  const p1 = await getList(`q=${tag}&sort=name&order=asc&page=1&pageSize=2`);
  const p2 = await getList(`q=${tag}&sort=name&order=asc&page=2&pageSize=2`);
  check('page 1 respects pageSize', p1.data.length === 2, `got ${p1.data.length}`);
  check('page 2 returns the remainder', p2.data.length === 1, `got ${p2.data.length}`);
  check('total counts all matches, not just the page', p1.total === 3, `got ${p1.total}`);
  check('totalPages derives from total/pageSize', p1.totalPages === 2, `got ${p1.totalPages}`);
  check(
    'pages do not overlap',
    !p1.data.some((r) => p2.data.some((o) => o.id === r.id)),
    'an id appeared on both pages',
  );

  // --- filters compose with search
  const filtered = await getList(`q=${tag}&status=ACTIVE&pageSize=100`);
  check('status filter composes with search', filtered.total === 3, `got ${filtered.total}`);
  const exited = await getList(`q=${tag}&status=EXITED&pageSize=100`);
  check('status=EXITED excludes the active cohort', exited.total === 0, `got ${exited.total}`);

  // --- PII posture: the whole point of the slim payload
  const row = byTag.data[0];
  check('list row omits nationalId', !('nationalId' in row));
  check('list row omits kraPin', !('kraPin' in row));
  check('list row omits bankAccountNumber', !('bankAccountNumber' in row));
  check('list row carries fullName convenience field', typeof row.fullName === 'string' && row.fullName.length > 0);

  // Detail still returns PII in full for an HR-privileged caller (admin).
  const detailRes = await fetch(`${BASE}/employees/${idA}`, { headers: auth });
  const detail = (await detailRes.json()) as {
    nationalId?: string; piiMasked?: boolean;
    bankCode?: string | null; bankBranchCode?: string | null;
  };
  check(
    'detail still returns decrypted nationalId to a privileged caller',
    typeof detail.nationalId === 'string' && !detail.nationalId.includes('*'),
    JSON.stringify(detail.nationalId),
  );
  check('detail reports piiMasked=false for a privileged caller', detail.piiMasked === false);

  // Routing codes are write-only regression bait: create/update accept them and
  // the EFT export reads them from the DB, so a missing read path is invisible
  // until a UI tries to show them.
  check('detail returns bankCode written at create', detail.bankCode === '11', JSON.stringify(detail.bankCode));
  check(
    'detail returns bankBranchCode written at create',
    detail.bankBranchCode === '022', JSON.stringify(detail.bankBranchCode),
  );

  // --- erasure lifecycle (DPA): erasure is for leavers only
  // Uses its own tag so this employee never matches the cohort searches above.
  const eraseTag = `EMPZ${stamp}`;
  const eraseRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `${eraseTag}-9`, firstName: 'Erase', lastName: 'Candidate',
      nationalId: `${String(stamp).slice(-7)}9`,
      employmentType: 'PERMANENT', hireDate: '2020-01-01',
    }),
  });
  const eraseId = ((await eraseRes.json()) as { id?: string }).id ?? '';
  if (!eraseId) { console.log('  FAIL  create erase candidate'); process.exit(1); }

  const tooSoon = await fetch(`${BASE}/employees/${eraseId}/anonymize`, { method: 'POST', headers: auth });
  check('erasing an ACTIVE employee is refused (409)', tooSoon.status === 409, `got ${tooSoon.status}`);

  const stillNamed = await fetch(`${BASE}/employees/${eraseId}`, { headers: auth });
  const stillNamedBody = (await stillNamed.json()) as { firstName?: string };
  check(
    'the refused erasure changed nothing',
    stillNamedBody.firstName === 'Erase', JSON.stringify(stillNamedBody.firstName),
  );

  const term = await fetch(`${BASE}/employees/${eraseId}/terminate`, {
    method: 'POST', headers: authJson, body: JSON.stringify({ exitDate: '2026-06-30' }),
  });
  check('terminate marks the employee EXITED', term.status === 200, `got ${term.status}`);

  const erased = await fetch(`${BASE}/employees/${eraseId}/anonymize`, { method: 'POST', headers: auth });
  const erasedBody = (await erased.json()) as { anonymized?: boolean; alreadyAnonymized?: boolean };
  check('erasing an EXITED employee succeeds', erased.ok && erasedBody.anonymized === true,
    `status ${erased.status} ${JSON.stringify(erasedBody)}`);

  const after = await fetch(`${BASE}/employees/${eraseId}`, { headers: auth });
  const afterBody = (await after.json()) as { firstName?: string; employmentStatus?: string };
  check('erased record keeps the [ERASED] marker', afterBody.firstName === '[ERASED]', JSON.stringify(afterBody.firstName));
  check(
    'erased record stays EXITED — never ACTIVE without a name',
    afterBody.employmentStatus === 'EXITED', JSON.stringify(afterBody.employmentStatus),
  );

  const again = await fetch(`${BASE}/employees/${eraseId}/anonymize`, { method: 'POST', headers: auth });
  const againBody = (await again.json()) as { alreadyAnonymized?: boolean };
  check('a second erasure is an idempotent no-op', againBody.alreadyAnonymized === true, JSON.stringify(againBody));

  // The headcount consequence: an erased leaver must not sit in the ACTIVE list.
  const activeAfter = await getList(`q=${eraseTag}&status=ACTIVE&pageSize=100`);
  check('erased leaver is absent from the ACTIVE list', activeAfter.total === 0, `got ${activeAfter.total}`);

  // --- auto employee numbers
  // Save and restore the org's real config so running this gate locally doesn't
  // quietly reconfigure the developer's own numbering.
  const cfgRes = await fetch(`${BASE}/organization/employee-numbering`, { headers: auth });
  const originalCfg = (await cfgRes.json()) as {
    employeeNumberPrefix: string | null; employeeNumberPadding: number; employeeNumberNextSeq: number;
  };

  const setCfg = async (body: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/organization/employee-numbering`, {
      method: 'PATCH', headers: authJson, body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  const numPrefix = `AN${String(stamp).slice(-6)}`; // unique per run, so numbers can't clash
  const configured = await setCfg({
    employeeNumberPrefix: numPrefix, employeeNumberPadding: 4, employeeNumberNextSeq: 1,
  });
  check('numbering config can be set', configured.status === 200, `got ${configured.status}`);
  check('config reports autoNumbering on', configured.body.autoNumbering === true);
  check(
    'config previews the next number',
    configured.body.preview === `${numPrefix}0001`, JSON.stringify(configured.body.preview),
  );

  const preview = await fetch(`${BASE}/employees/next-number`, { headers: auth });
  const previewBody = (await preview.json()) as { autoNumbering?: boolean; next?: string };
  check('next-number previews without consuming', previewBody.next === `${numPrefix}0001`, JSON.stringify(previewBody));

  const preview2 = await fetch(`${BASE}/employees/next-number`, { headers: auth });
  const preview2Body = (await preview2.json()) as { next?: string };
  check(
    'previewing twice returns the same number (a preview reserves nothing)',
    preview2Body.next === `${numPrefix}0001`, JSON.stringify(preview2Body.next),
  );

  const mkAuto = async (seq: string): Promise<Response> => fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      firstName: 'Auto', lastName: `Number${seq}`,
      nationalId: `${String(stamp).slice(-6)}${seq}0`.slice(0, 8),
      employmentType: 'PERMANENT', hireDate: '2026-02-01',
    }),
  });

  const auto1 = (await (await mkAuto('1')).json()) as { employeeNumber?: string };
  check('omitting employeeNumber allocates the first number', auto1.employeeNumber === `${numPrefix}0001`,
    JSON.stringify(auto1.employeeNumber));

  const auto2 = (await (await mkAuto('2')).json()) as { employeeNumber?: string };
  check('the counter advances', auto2.employeeNumber === `${numPrefix}0002`, JSON.stringify(auto2.employeeNumber));

  // Concurrency: the whole reason the counter is an atomic increment on the org
  // row rather than MAX(number)+1. Five parallel creates must take five numbers.
  const parallel = await Promise.all([3, 4, 5, 6, 7].map((n) => mkAuto(String(n))));
  const parallelNums = await Promise.all(
    parallel.map(async (r) => ((await r.json()) as { employeeNumber?: string }).employeeNumber),
  );
  const unique = new Set(parallelNums);
  check(
    'five concurrent creates get five distinct numbers',
    unique.size === 5 && !parallelNums.includes(undefined), parallelNums.join(),
  );

  // An explicit number must still win — needed when migrating existing staff.
  const manualRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `${numPrefix}-MANUAL`, firstName: 'Manual', lastName: 'Override',
      nationalId: `${String(stamp).slice(-7)}8`, employmentType: 'PERMANENT', hireDate: '2026-02-01',
    }),
  });
  const manual = (await manualRes.json()) as { employeeNumber?: string };
  check('an explicit employeeNumber overrides auto-numbering',
    manual.employeeNumber === `${numPrefix}-MANUAL`, JSON.stringify(manual.employeeNumber));

  // A number already taken by hand must be skipped, not collided with.
  const bumped = await setCfg({ employeeNumberNextSeq: 50 });
  check('the counter can be moved (migration from an existing scheme)',
    bumped.body.preview === `${numPrefix}0050`, JSON.stringify(bumped.body.preview));
  const squatRes = await fetch(`${BASE}/employees`, {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      employeeNumber: `${numPrefix}0050`, firstName: 'Squat', lastName: 'Ter',
      nationalId: `${String(stamp).slice(-7)}7`, employmentType: 'PERMANENT', hireDate: '2026-02-01',
    }),
  });
  check('manual create of the next number succeeds', squatRes.ok, `got ${squatRes.status}`);
  const afterSquat = (await (await mkAuto('9')).json()) as { employeeNumber?: string };
  check('auto-numbering skips a number taken by hand',
    afterSquat.employeeNumber === `${numPrefix}0051`, JSON.stringify(afterSquat.employeeNumber));

  // Prefix validation
  const badPrefix = await setCfg({ employeeNumberPrefix: 'HAS SPACE' });
  check('a prefix with a space is rejected (400)', badPrefix.status === 400, `got ${badPrefix.status}`);
  const badPad = await setCfg({ employeeNumberPadding: 99 });
  check('padding above the maximum is rejected (400)', badPad.status === 400, `got ${badPad.status}`);

  // Auto-numbering off => an omitted number is a clear 400, not a crash.
  await setCfg({ employeeNumberPrefix: null });
  const offRes = await mkAuto('0');
  check('with auto-numbering off, omitting employeeNumber is a 400', offRes.status === 400, `got ${offRes.status}`);
  const offPreview = (await (await fetch(`${BASE}/employees/next-number`, { headers: auth })).json()) as {
    autoNumbering?: boolean;
  };
  check('preview reports autoNumbering off', offPreview.autoNumbering === false, JSON.stringify(offPreview));

  // Restore whatever the org had before this run.
  await setCfg({
    employeeNumberPrefix: originalCfg.employeeNumberPrefix,
    employeeNumberPadding: originalCfg.employeeNumberPadding,
    employeeNumberNextSeq: originalCfg.employeeNumberNextSeq,
  });
  const restored = (await (await fetch(`${BASE}/organization/employee-numbering`, { headers: auth })).json()) as {
    employeeNumberPrefix: string | null;
  };
  check('the org numbering config is restored after the gate',
    restored.employeeNumberPrefix === originalCfg.employeeNumberPrefix,
    JSON.stringify(restored.employeeNumberPrefix));

  // --- update: clearing an optional field, and the date-clearing trap
  const upd = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`${BASE}/employees/${id}`, {
      method: 'PATCH', headers: authJson, body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  const setDob = await upd(idB, { dateOfBirth: '1990-05-20' });
  check('update sets a date of birth',
    typeof setDob.body.dateOfBirth === 'string' && (setDob.body.dateOfBirth as string).startsWith('1990-05-20'),
    JSON.stringify(setDob.body.dateOfBirth));

  // `new Date(null)` is the epoch, so a naive implementation turns a cleared
  // date of birth into 1970-01-01 instead of clearing it.
  const clearDob = await upd(idB, { dateOfBirth: null });
  check('clearing a date of birth nulls it rather than setting 1970',
    clearDob.body.dateOfBirth === null, JSON.stringify(clearDob.body.dateOfBirth));

  const clearBank = await upd(idB, { bankName: null, bankCode: null });
  check('clearing bank fields nulls them',
    clearBank.body.bankName === null && clearBank.body.bankCode === null,
    JSON.stringify([clearBank.body.bankName, clearBank.body.bankCode]));

  const untouched = await upd(idB, { phone: '0722000111' });
  check('a partial update leaves other fields alone',
    untouched.body.firstName === 'Brian' && untouched.body.phone === '0722000111',
    JSON.stringify([untouched.body.firstName, untouched.body.phone]));

  const dupNum = await upd(idB, { employeeNumber: `${tag}-1` });
  check('updating to an existing employee number is refused (409)',
    dupNum.status === 409, `got ${dupNum.status}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
