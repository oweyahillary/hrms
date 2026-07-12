-- ============================================================================
-- HRMS — database-level immutability guards (defense in depth).
--
-- These enforce append-only / finalized-immutability at the DATABASE, so the
-- guarantees hold even if application code has a bug or is bypassed. They are
-- applied out-of-band from `prisma db push` (which does not model triggers);
-- db push leaves these objects untouched on subsequent runs.
--
-- Idempotent: safe to run repeatedly (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
-- Column identifiers are camelCase (Prisma default) and MUST be double-quoted.
-- ============================================================================

-- 1) payroll_runs: once FINALIZED, the row is immutable (no UPDATE, no DELETE).
--    The DRAFT->FINALIZED transition itself is allowed because the trigger reads
--    OLD.status (still DRAFT at that moment).
--    NOTE (Phase 2): when a settlement transition FINALIZED->PAID is introduced,
--    this function must be updated to permit that specific forward change.
CREATE OR REPLACE FUNCTION hrms_block_finalized_run_mutation() RETURNS trigger AS $fn$
BEGIN
  IF OLD.status::text = 'FINALIZED' THEN
    RAISE EXCEPTION 'payroll_runs %: FINALIZED runs are immutable (% blocked)', OLD.id, TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_runs_immutable ON payroll_runs;
CREATE TRIGGER trg_payroll_runs_immutable
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION hrms_block_finalized_run_mutation();

-- 2) payslips: frozen once the parent run is FINALIZED, EXCEPT the one-time PDF
--    attach (pdfPath NULL->value) and pdfStatus lifecycle (see the function body).
--    While the run is DRAFT, payslips may still be recomputed or discarded.
CREATE OR REPLACE FUNCTION hrms_block_finalized_payslip_mutation() RETURNS trigger AS $fn$
DECLARE
  parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM payroll_runs WHERE id = OLD."payrollRunId";
  IF parent_status = 'FINALIZED' THEN
    -- Narrow exception: allow ONLY the PDF-artifact lifecycle on an otherwise frozen
    -- payslip. pdfPath may go NULL->value ONCE (never overwrite or clear) and
    -- pdfStatus may move within its lifecycle (PENDING/READY/FAILED). EVERY other
    -- column must be byte-identical, so payroll figures can never change.
    IF TG_OP = 'UPDATE'
       AND (OLD."pdfPath" IS NULL OR NEW."pdfPath" IS NOT DISTINCT FROM OLD."pdfPath")
       AND ROW(NEW.id, NEW."payrollRunId", NEW."employeeId", NEW."grossPay", NEW.paye,
               NEW."nssfEmployee", NEW."nssfEmployer", NEW.shif, NEW."ahlEmployee",
               NEW."ahlEmployer", NEW."otherDeductions", NEW."netPay",
               NEW."oneThirdRulePass", NEW."createdAt")
         IS NOT DISTINCT FROM
           ROW(OLD.id, OLD."payrollRunId", OLD."employeeId", OLD."grossPay", OLD.paye,
               OLD."nssfEmployee", OLD."nssfEmployer", OLD.shif, OLD."ahlEmployee",
               OLD."ahlEmployer", OLD."otherDeductions", OLD."netPay",
               OLD."oneThirdRulePass", OLD."createdAt")
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payslips %: belongs to a FINALIZED run and is immutable (% blocked)', OLD.id, TG_OP
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslips_immutable ON payslips;
CREATE TRIGGER trg_payslips_immutable
  BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION hrms_block_finalized_payslip_mutation();

-- 3) audit_logs: append-only. DELETE is always blocked. UPDATE is blocked except
--    the single legitimate system operation: the FK ON DELETE SET NULL that
--    clears userId if a referenced user row is ever removed (no user-delete path
--    exists today, but we must not break referential integrity if one is added).
--    audit_logs has no updatedAt, so the all-columns-equal check below is stable.
CREATE OR REPLACE FUNCTION hrms_block_audit_mutation() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only (DELETE blocked)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."userId" IS NOT NULL AND NEW."userId" IS NULL
     AND ROW(NEW.id, NEW."organizationId", NEW.action, NEW."entityType", NEW."entityId",
             NEW."beforeState", NEW."afterState", NEW."ipAddress", NEW."createdAt")
       IS NOT DISTINCT FROM
         ROW(OLD.id, OLD."organizationId", OLD.action, OLD."entityType", OLD."entityId",
             OLD."beforeState", OLD."afterState", OLD."ipAddress", OLD."createdAt")
  THEN
    RETURN NEW; -- permit ON DELETE SET NULL housekeeping only
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (UPDATE blocked)'
    USING ERRCODE = 'check_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION hrms_block_audit_mutation();
