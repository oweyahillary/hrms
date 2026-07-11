# Attendance

Daily attendance records (manual + biometric CSV import). One record per
employee per day — writes upsert that day's record rather than duplicating it.

## Endpoints (management = Admin / HR Manager / HR Officer)

- `POST /api/attendance` — upsert one day: `{ employeeId, date, clockIn?, clockOut?, status? }`.
  `status` defaults to `PRESENT` if a clock-in is present, else `ABSENT`.
- `GET  /api/attendance?employeeId=&from=&to=` — records in a date range.
- `POST /api/attendance/import` — multipart CSV upload (`file`), source `BIOMETRIC`.

## CSV format

Header row, then one row per employee/day:

```
employeeNumber,date,clockIn,clockOut,status
EMP-001,2026-03-02,08:00,17:00,PRESENT
EMP-001,2026-03-03,,,ABSENT
```

- `date` is `YYYY-MM-DD`; times are `HH:MM`, `HH:MM:SS`, or full ISO (bare times
  combine with the row's date, UTC). `status` optional (inferred from clock-in).
- Rows are resolved by `employeeNumber`. Import is tolerant: valid rows are
  written, bad ones skipped, and the response reports `{ imported, skipped,
  errors: [{ row, message }] }` so you can fix and re-upload. Re-importing the
  same day updates the record (idempotent).

Biometric is CSV in Phase 1; live ZK/Hikvision push ingestion sits behind the
same write path later (the `source` field already distinguishes them).

## Verified

- CSV parsing/validation (time combine, bad rows, status inference): 14/14 unit tests.
- Full app compiles; DI-boots with AttendanceService resolving.
- Live: manual upsert + CSV import is the acceptance test.
