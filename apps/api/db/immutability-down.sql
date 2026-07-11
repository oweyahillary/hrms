-- Rollback for immutability guards. Removes triggers then their functions.
DROP TRIGGER IF EXISTS trg_payroll_runs_immutable ON payroll_runs;
DROP TRIGGER IF EXISTS trg_payslips_immutable ON payslips;
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
DROP FUNCTION IF EXISTS hrms_block_finalized_run_mutation();
DROP FUNCTION IF EXISTS hrms_block_finalized_payslip_mutation();
DROP FUNCTION IF EXISTS hrms_block_audit_mutation();
