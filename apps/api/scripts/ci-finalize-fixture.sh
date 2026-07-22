#!/usr/bin/env bash
# CI fixture: create an employee + salary structure, run payroll for an unused
# period, and FINALIZE it — so verify:immutability has a finalized run/payslip to
# test against. Intended for the ephemeral CI database (leaves a finalized run).
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000/api}"

TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "fixture: login failed"; exit 1; }

STAMP=$(date +%s); NID="${STAMP: -8}"
EID=$(curl -s -X POST "$BASE_URL/employees" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"employeeNumber\":\"CI-$STAMP\",\"firstName\":\"CI\",\"lastName\":\"Fixture\",\"nationalId\":\"$NID\",\"employmentType\":\"PERMANENT\",\"hireDate\":\"2026-01-01\"}" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$EID" ] || { echo "fixture: employee create failed"; exit 1; }

curl -s -X POST "$BASE_URL/employees/$EID/salary-structures" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"basicSalary":80000,"effectiveDate":"2026-01-01","reason":"Salary revision","components":[{"componentType":"ALLOWANCE","name":"House","amount":20000,"isTaxable":true}]}' >/dev/null

RID=$(curl -s -X POST "$BASE_URL/payroll/runs" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"periodMonth\":3,\"periodYear\":2030,\"employeeIds\":[\"$EID\"]}" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$RID" ] || { echo "fixture: run create failed"; exit 1; }

curl -s -X POST "$BASE_URL/payroll/runs/$RID/finalize?__skipPdf=true" -H "Authorization: Bearer $TOKEN" >/dev/null
echo "fixture: finalized run $RID (employee $EID)"
