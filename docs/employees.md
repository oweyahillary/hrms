# Employees

The first feature module: employee CRUD, national-ID blind-index lookup,
role-based PII masking, and document uploads.

## Encrypted identifiers (how PII is stored)

`nationalId`, `kraPin`, and `bankAccountNumber` are encrypted at the app layer
(`CryptoService.encrypt`) and stored as ciphertext (verified: the `nationalId`
column holds an `HRMS1:env:…` envelope, not the plaintext). The two searchable
ones also store a keyed-HMAC **blind index** (`nationalIdHmac`, `kraPinHmac`) —
lookups hash the query value and match the index, so we never scan plaintext.
`bankAccountNumber` has no index (not searchable by design). The audit trail
captures the ciphertext row, so **no plaintext PII ever lands in `audit_logs`**.

## Who sees decrypted PII

Reads decrypt server-side, then expose values based on the caller's role:
- **Admin / HR Manager / HR Officer** — full values.
- **Everyone else** — masked (all but last 4, e.g. `****5678`); `piiMasked: true`.

The same privileged set gates create/update/terminate/lookup and all document
operations (`@Roles`).

## Endpoints

Employee records:
- `POST /api/employees` — create (privileged)
- `GET  /api/employees` — list, paginated (`page`, `pageSize`, `status`, `departmentId`)
- `GET  /api/employees/lookup?nationalId=` — find by national ID via blind index (privileged)
- `GET  /api/employees/:id` — fetch one
- `PATCH /api/employees/:id` — update; PII re-encrypted + blind indexes refreshed (privileged)
- `POST /api/employees/:id/terminate` — status `EXITED` + `exitDate` (privileged)

Documents (all privileged):
- `POST   /api/employees/:id/documents` — multipart upload (`file`, `documentType`, `isSensitive`)
- `GET    /api/employees/:id/documents` — list metadata
- `GET    /api/employees/:id/documents/:docId/download` — stream the file
- `DELETE /api/employees/:id/documents/:docId` — delete record + file

## Document storage

Files are written to local disk under `STORAGE_DIR` (default `./storage`) at
`<orgId>/<employeeId>/<uuid>/<sanitized-filename>`. Point `STORAGE_DIR` at a
mounted volume (Docker/VPS) or a directory outside the web root (cPanel); the
`FileStorageService` interface can back S3 later. Uploads are limited to PDF/JPEG/
PNG and 10 MB; filenames are sanitized and paths are traversal-guarded.

Downloads are **reads**, which the audit extension doesn't capture automatically,
so each download writes an explicit `AuditLog` entry (`action: download`) — the
sensitive-access trail required for compliance.

## Tenant safety

All queries run through the extended Prisma client (org auto-injected). Single
update/delete/terminate and document operations do a scoped read first, so you
can't touch another org's employee or document (see docs/spine.md).

## Verified

- PII masking/privilege logic: 12/12 unit tests.
- Filename sanitization + content-type + upload allowlist: 10/10 unit tests.
- Full app compiles; DI-boots with Employees + Storage + Documents wired.
- Live: create/lookup/list proven; national ID confirmed ciphertext at rest.
  Document upload/download is the Step-2 acceptance test (curl).
