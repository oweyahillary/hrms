#!/usr/bin/env bash
# End-to-end smoke test for the HRMS API.
# Exercises the full stack against a running instance and asserts key values.
# Repeatable: uses a timestamped throwaway employee and discards its payroll
# draft, so it leaves no meaningful residue and can be run over and over.
#
#   Usage:  bash scripts/smoke-test.sh
#   Config: override via env, e.g. BASE_URL=http://localhost:3000/api bash scripts/smoke-test.sh

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api}"
EMAIL="${SMOKE_EMAIL:-admin@example.com}"
PASSWORD="${SMOKE_PASSWORD:-ChangeMe123!}"
PERIOD_MONTH="${SMOKE_PERIOD_MONTH:-9}"
PERIOD_YEAR="${SMOKE_PERIOD_YEAR:-2026}"

PASS=0; FAIL=0
green(){ printf '\033[32m%s\033[0m\n' "$1"; }
red(){ printf '\033[31m%s\033[0m\n' "$1"; }
section(){ printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# assert_contains <haystack> <needle> <label>
assert_contains(){
  if printf '%s' "$1" | grep -qF -- "$2"; then PASS=$((PASS+1)); green "  PASS  $3"
  else FAIL=$((FAIL+1)); red "  FAIL  $3"; red "        expected to find: $2"; red "        in: $1"; fi
}
# first_id <json> -> first "id" value
first_id(){ printf '%s' "$1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4; }

req(){ # req METHOD PATH [JSON]  (uses global TOKEN)
  local m="$1" p="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$m" "$BASE_URL$p" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -X "$m" "$BASE_URL$p" -H "Authorization: Bearer $TOKEN"
  fi
}

# ---------------------------------------------------------------------------
section "Auth"
LOGIN=$(curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then red "  FAIL  login (no token) — is the API running at $BASE_URL?"; echo "$LOGIN"; exit 1; fi
green "  PASS  login returned an access token"; PASS=$((PASS+1))
ME=$(req GET /auth/me); assert_contains "$ME" '"role":"Admin"' "GET /auth/me returns current user context"

# ---------------------------------------------------------------------------
section "Statutory rates (seeded)"
AS_OF=$(printf '%04d-%02d-15' "$PERIOD_YEAR" "$PERIOD_MONTH")
RATES=$(req GET "/statutory-rates/effective?asOf=$AS_OF")
assert_contains "$RATES" '"personalRelief":2400' "PAYE personal relief 2400 in force"
assert_contains "$RATES" '"upperLimit":108000' "NSSF UEL 108000 (Phase 4) in force"
assert_contains "$RATES" '"floor":300'         "SHIF floor 300 in force"

# ---------------------------------------------------------------------------
section "Employee + salary structure"
STAMP=$(date +%s)
EMPNO="SMOKE-$STAMP"
NID="${STAMP: -8}"   # national ID must be 7–8 digits
EMP_JSON=$(req POST /employees "{\"employeeNumber\":\"$EMPNO\",\"firstName\":\"Smoke\",\"lastName\":\"Test\",\"nationalId\":\"$NID\",\"employmentType\":\"PERMANENT\",\"hireDate\":\"2026-01-01\"}")
EMP_ID=$(first_id "$EMP_JSON")
assert_contains "$EMP_JSON" "\"employeeNumber\":\"$EMPNO\"" "created throwaway employee $EMPNO"
if [ -z "$EMP_ID" ]; then red "  ABORT  employee creation failed — cannot continue:"; echo "$EMP_JSON"; exit 1; fi

STRUCT=$(req POST "/employees/$EMP_ID/salary-structures" '{
  "basicSalary":80000,"effectiveDate":"2026-01-01",
  "components":[
    {"componentType":"ALLOWANCE","name":"House","amount":20000,"isTaxable":true},
    {"componentType":"ALLOWANCE","name":"PerDiem","amount":5000,"isTaxable":false},
    {"componentType":"DEDUCTION_VOLUNTARY","name":"SACCO","amount":10000}
  ]}')
assert_contains "$STRUCT" '"gross":105000'       "derived gross 105000"
assert_contains "$STRUCT" '"taxableGross":100000' "derived taxableGross 100000 (per-diem excluded)"

# ---------------------------------------------------------------------------
section "Payroll (draft -> verify -> discard)"
RUN=$(req POST /payroll/runs "{\"periodMonth\":$PERIOD_MONTH,\"periodYear\":$PERIOD_YEAR,\"employeeIds\":[\"$EMP_ID\"]}")
RUN_ID=$(first_id "$RUN")
if printf '%s' "$RUN" | grep -qF '"statusCode":409'; then
  red "  FAIL  payroll run create 409 — a REGULAR run already exists for $PERIOD_YEAR-$PERIOD_MONTH."
  red "        Re-run with SMOKE_PERIOD_MONTH set to an unused month."; FAIL=$((FAIL+1))
else
  assert_contains "$RUN" '"nssfEmployee":6300' "payslip NSSF 6300 (pensionable 105000)"
  assert_contains "$RUN" '"paye":19154.6'      "payslip PAYE 19154.6"
  assert_contains "$RUN" '"netPay":65082.9'    "payslip net 65082.9 (to the cent)"
  assert_contains "$RUN" '"oneThirdRulePass":true' "one-third rule passes"
  DISCARD=$(req DELETE "/payroll/runs/$RUN_ID")
  assert_contains "$DISCARD" '"success":true'  "draft run discarded (repeatable, no residue)"
fi

# ---------------------------------------------------------------------------
section "Compliance: consent + retention"
CONSENT=$(req POST "/employees/$EMP_ID/consents" '{"purpose":"Payroll","lawfulBasis":"CONTRACT"}')
CONSENT_ID=$(first_id "$CONSENT")
assert_contains "$CONSENT" '"active":true' "consent granted (active)"
WD=$(req POST "/consents/$CONSENT_ID/withdraw")
assert_contains "$WD" '"active":false' "consent withdrawn (inactive)"
RET=$(req PUT /retention-policies '{"recordType":"SMOKE_TEST","retentionPeriodMonths":12}')
assert_contains "$RET" '"retentionPeriodMonths":12' "retention policy upserted"

# ---------------------------------------------------------------------------
section "Compliance: DSR erasure gate"
DSR=$(req POST "/employees/$EMP_ID/data-subject-requests" '{"requestType":"ERASURE","notes":"smoke"}')
DSR_ID=$(first_id "$DSR")
assert_contains "$DSR" '"daysUntilDue":30' "ERASURE request has 30-day SLA"
BLOCKED=$(req PATCH "/data-subject-requests/$DSR_ID" '{"status":"COMPLETED"}')
assert_contains "$BLOCKED" '"statusCode":409' "completing erasure blocked before anonymization"
ANON=$(req POST "/employees/$EMP_ID/anonymize")
assert_contains "$ANON" '"anonymized":true' "employee anonymized (Admin action)"
DONE=$(req PATCH "/data-subject-requests/$DSR_ID" '{"status":"COMPLETED"}')
assert_contains "$DONE" '"status":"COMPLETED"' "erasure request completes after anonymization"
GONE=$(req GET "/employees/$EMP_ID")
assert_contains "$GONE" '"firstName":"[ERASED]"' "PII scrubbed but record preserved"

# ---------------------------------------------------------------------------
section "Compliance: breach 72h clock"
BREACH=$(req POST /breach-incidents '{"detectedAt":"2020-01-01T00:00:00Z","description":"smoke","affectedEmployeeCount":1}')
BREACH_ID=$(first_id "$BREACH")
assert_contains "$BREACH" '"status":"OVERDUE"' "old breach reads OVERDUE against 72h clock"
NOTIFIED=$(req POST "/breach-incidents/$BREACH_ID/notify-odpc")
assert_contains "$NOTIFIED" '"status":"NOTIFIED_LATE"' "late ODPC notification recorded honestly"

# ---------------------------------------------------------------------------
printf '\n\033[1m== Summary ==\033[0m\n'
green "  $PASS passed"; [ "$FAIL" -gt 0 ] && red "  $FAIL failed" || echo "  0 failed"
[ "$FAIL" -eq 0 ] && { green "SMOKE TEST GREEN"; exit 0; } || { red "SMOKE TEST FAILED"; exit 1; }
