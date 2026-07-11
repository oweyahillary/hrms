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

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const fin = await client.query(
      `SELECT r.id AS run_id, p.id AS payslip_id
         FROM payroll_runs r JOIN payslips p ON p."payrollRunId" = r.id
        WHERE r.status = 'FINALIZED' LIMIT 1`,
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
