/**
 * Prove the immutability guards are live. Every attempted mutation runs inside a
 * transaction that is ALWAYS rolled back, so nothing is ever persisted — this is
 * safe to run against real data. Exits non-zero if any guard is missing.
 *   cd apps/api && npx ts-node scripts/verify-immutability.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

let pass = 0;
let fail = 0;

async function expectBlocked(client: Client, label: string, sql: string): Promise<void> {
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('ROLLBACK');
    console.log(`  FAIL  ${label} — mutation was ALLOWED`);
    fail += 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log(`  PASS  ${label} — blocked (${String((e as Error).message).split('\n')[0]})`);
    pass += 1;
  }
}

async function expectAllowed(client: Client, label: string, sql: string): Promise<void> {
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('ROLLBACK'); // never persist — only prove it is permitted
    console.log(`  PASS  ${label} — allowed`);
    pass += 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log(`  FAIL  ${label} — unexpectedly blocked (${String((e as Error).message).split('\n')[0]})`);
    fail += 1;
  }
}

// Two-step: attach a pdfPath (allowed), then try to overwrite it (must be blocked).
async function expectOverwriteBlocked(client: Client, payslipId: string): Promise<void> {
  const label = 'overwrite an existing pdfPath on a finalized payslip';
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE payslips SET "pdfPath" = '/ci/first.pdf', "pdfStatus" = 'READY' WHERE id = '${payslipId}'`);
    await client.query(`UPDATE payslips SET "pdfPath" = '/ci/second.pdf' WHERE id = '${payslipId}'`);
    await client.query('ROLLBACK');
    console.log(`  FAIL  ${label} — overwrite was ALLOWED`);
    fail += 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log(`  PASS  ${label} — blocked (${String((e as Error).message).split('\n')[0]})`);
    pass += 1;
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const fin = await client.query(
      `SELECT r.id AS run_id, p.id AS payslip_id
         FROM payroll_runs r JOIN payslips p ON p."payrollRunId" = r.id
        WHERE r.status = 'FINALIZED'
        ORDER BY (p."pdfPath" IS NULL) DESC
        LIMIT 1`,
    );
    if (fin.rowCount) {
      const runId = fin.rows[0].run_id as string;
      const payslipId = fin.rows[0].payslip_id as string;
      console.log(`Using FINALIZED run ${runId} (payslip ${payslipId})`);
      await expectBlocked(client, 'UPDATE a finalized payslip',
        `UPDATE payslips SET "netPay" = "netPay" + 1 WHERE id = '${payslipId}'`);
      await expectBlocked(client, 'DELETE a finalized payslip',
        `DELETE FROM payslips WHERE id = '${payslipId}'`);
      await expectBlocked(client, 'revert a finalized run to DRAFT',
        `UPDATE payroll_runs SET status = 'DRAFT' WHERE id = '${runId}'`);
      await expectBlocked(client, 'DELETE a finalized run',
        `DELETE FROM payroll_runs WHERE id = '${runId}'`);

      // Phase 2: the narrow PDF-artifact exception on an otherwise-frozen payslip.
      const cur = await client.query(`SELECT "pdfPath" FROM payslips WHERE id = '${payslipId}'`);
      const hasPath = cur.rows[0]?.pdfPath != null;
      if (!hasPath) {
        await expectAllowed(client, 'attach pdfPath (NULL->value) + set pdfStatus READY',
          `UPDATE payslips SET "pdfPath" = '/ci/probe.pdf', "pdfStatus" = 'READY' WHERE id = '${payslipId}'`);
        await expectAllowed(client, 'set pdfStatus FAILED with no path (render-failed lifecycle)',
          `UPDATE payslips SET "pdfStatus" = 'FAILED' WHERE id = '${payslipId}'`);
        await expectBlocked(client, 'attach pdfPath WITH a figure change (netPay)',
          `UPDATE payslips SET "pdfPath" = '/ci/x.pdf', "netPay" = "netPay" + 1 WHERE id = '${payslipId}'`);
        await expectOverwriteBlocked(client, payslipId);
      } else {
        console.log('  SKIP  finalized payslip already has a pdfPath — attach-exception cases skipped');
      }
    } else {
      console.log('  SKIP  no FINALIZED run found — finalize one, then re-run to test run/payslip guards');
    }

    const aud = await client.query(`SELECT id FROM audit_logs LIMIT 1`);
    if (aud.rowCount) {
      const id = aud.rows[0].id as string;
      await expectBlocked(client, 'UPDATE an audit_logs row',
        `UPDATE audit_logs SET action = 'tampered' WHERE id = '${id}'`);
      await expectBlocked(client, 'DELETE an audit_logs row',
        `DELETE FROM audit_logs WHERE id = '${id}'`);
    } else {
      console.log('  SKIP  no audit_logs rows found');
    }

    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error('verify error:', (e as Error).message); process.exit(1); });
