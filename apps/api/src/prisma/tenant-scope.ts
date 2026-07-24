/**
 * Pure tenant-scoping + audit helper logic. No Prisma import on purpose, so it
 * is trivially unit-testable and has no runtime coupling to the generated client.
 * The Prisma extension (prisma.extensions.ts) is thin glue over these.
 */

/**
 * Models that carry an organizationId column (tenant-scoped). Keep in sync with
 * schema.prisma. Deliberately EXCLUDED:
 *   Organization (it IS the tenant), StatutoryRate (national/global),
 *   Session (via userId), SalaryComponent (via SalaryStructure),
 *   LeaveApprovalStep (via LeaveRequest), Payslip / BankExportBatch (via PayrollRun),
 *   LoanRepayment (via Loan).
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'User', 'Role', 'AuditLog', 'Department', 'JobTitle', 'Employee',
  'EmployeeDocument', 'PublicHoliday', 'AttendanceRecord', 'LeaveType',
  'LeaveBalance', 'LeaveRequest', 'ShiftDefinition', 'ShiftAssignment',
  'AttendanceDevice', 'AttendancePunch',
  'SalaryStructure', 'PayrollRun',
  'ConsentRecord', 'DataSubjectRequest', 'RetentionPolicy', 'BreachIncident',
  'SeveranceCalculation', 'Loan', 'PayrollAdjustment',
  'OvertimePolicy', 'OvertimeEntry',
]);

export const WHERE_INJECTABLE: ReadonlySet<string> = new Set([
  'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);
export const UNIQUE_READ: ReadonlySet<string> = new Set(['findUnique', 'findUniqueOrThrow']);
export const WRITE_OPS: ReadonlySet<string> = new Set([
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
]);

type Args = Record<string, unknown>;

export function isTenantScoped(model?: string): boolean {
  return !!model && TENANT_SCOPED_MODELS.has(model);
}

/** PascalCase model name -> camelCase delegate key ('Employee' -> 'employee'). */
export function delegateKey(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Return args with organizationId injected for the model + operation. No org
 * context, or a non-scoped model, returns args unchanged. Unique-where ops
 * (findUnique/update/delete-by-id) are handled in the extension body, not here.
 */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: Args,
  orgId?: string,
): Args {
  if (!orgId || !isTenantScoped(model)) return args;

  if (WHERE_INJECTABLE.has(operation)) {
    const where = (args.where as Args | undefined) ?? {};
    return { ...args, where: { ...where, organizationId: orgId } };
  }
  if (operation === 'create') {
    const data = (args.data as Args | undefined) ?? {};
    // organizationId LAST so the context org always wins — a caller can never
    // write into another tenant by passing a different organizationId.
    return { ...args, data: { ...data, organizationId: orgId } };
  }
  if (operation === 'createMany') {
    const data = args.data;
    const withOrg = Array.isArray(data)
      ? data.map((row) => ({ ...(row as Args), organizationId: orgId }))
      : { ...(data as Args), organizationId: orgId };
    return { ...args, data: withOrg };
  }
  return args;
}

/** True if a unique-read result belongs to a DIFFERENT org and must be hidden. */
export function isCrossTenantRow(result: unknown, orgId?: string): boolean {
  if (!orgId || result === null || typeof result !== 'object') return false;
  const rowOrg = (result as Record<string, unknown>).organizationId;
  return typeof rowOrg === 'string' && rowOrg !== orgId;
}

/** Safe JSON snapshot for audit before/after (handles Date, Decimal, nested). */
export function toJsonSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function isAuditableWrite(model: string | undefined, operation: string, orgId?: string): boolean {
  return !!model && model !== 'AuditLog' && WRITE_OPS.has(operation) && !!orgId;
}

/** Extract a stable entity id for the audit row from a result or before-state. */
export function extractEntityId(result: unknown, before: unknown): string {
  const rec = (result ?? before) as Record<string, unknown> | null;
  return rec && typeof rec === 'object' && 'id' in rec ? String(rec.id) : 'batch';
}

/**
 * Fail-closed decision for the by-id tenant gap: should this single-row
 * update/delete be blocked because its target isn't in the caller's org?
 *
 * Prisma can't add an organizationId filter to an update/delete by unique id, so
 * the extension first does a *scoped* findFirst (where + organizationId). This
 * predicate turns that read into a hard guard:
 *   - only for tenant-scoped models, with an org in context, on update/delete;
 *   - only when the scoped read actually RESOLVED (returned a value, incl. null).
 *     If the read threw (e.g. a composite-unique where findFirst can't take), we
 *     can't determine membership, so we DON'T block — behaviour is unchanged and
 *     those wheres already carry their unique fields.
 *   - block precisely when the scoped read resolved to null (no in-org row).
 */
export function blocksCrossTenantWrite(opts: {
  model?: string;
  operation: string;
  orgId?: string;
  scopedReadResolved: boolean;
  beforeFound: boolean;
}): boolean {
  const { model, operation, orgId, scopedReadResolved, beforeFound } = opts;
  if (!orgId || !isTenantScoped(model)) return false;
  if (operation !== 'update' && operation !== 'delete') return false;
  return scopedReadResolved && !beforeFound;
}
