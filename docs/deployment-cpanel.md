# Deploying the HRMS API to shared cPanel hosting

> **Read this first.** Shared cPanel is supported as an *alternate* path for
> clients who insist on it (common in Kenya). It is **not** the recommended
> deployment. For anything holding real employee data under the DPA, a small
> Kenyan VPS (Truehost / Safaricom / Angani, ~KES 1,400–4,000/mo, Nairobi DC)
> is the better home: it keeps the whole Docker deployment, gives you an
> isolated instance instead of a co-tenant box, and costs about the same as a
> decent shared plan. Use cPanel only when a client requires it.

## Will it even run here? Check these before you start

The plan must provide **both**:

1. **Node.js Selector** (cPanel → "Setup Node.js App"), with a Node version
   **20 or newer**. The app targets modern JS; Node 18 or older will crash on
   startup. Confirm the host offers 20+.
2. **PostgreSQL** (cPanel → "PostgreSQL Databases"). Many budget shared plans
   are **MySQL-only** — this app uses Postgres-specific features and will *not*
   run on MySQL without a real port. If Postgres isn't listed, either upgrade
   the plan, ask support to enable it, or move to a VPS.

Also be aware of the shared-hosting ceilings that bite this kind of app:

- **Memory (CloudLinux LVE):** often 512 MB–1 GB. A large payroll run can
  strain it; the OOM killer will terminate the process without warning.
- **No Docker, no root, no PM2, no long-running workers, no custom cron
  daemons.** Passenger is the process manager — it starts/stops the app on
  demand.
- **KMS is not applicable here.** Use `KEY_PROVIDER=env` on shared hosting.

## How this deployment works (the shape)

Because Prisma 7's client is Rust-free (pure JS), we can sidestep every
shared-hosting binary headache:

- **Build on your machine**, not on the host. `prisma generate` + `nest build`
  produce a `dist/` that already contains the generated client. Nothing Rust
  ever needs to run on the shared server.
- **Run migrations from your machine** against the cPanel database over an SSH
  tunnel — so the Prisma migration engine never has to execute on the host, and
  it works even when the host's Postgres only listens on localhost.
- **Passenger runs the app** via a small startup shim (`passenger.js`). Passenger
  uses *reverse port binding* — it ignores whatever port the app listens on and
  assigns its own — so no port config is needed. The shim only normalises the
  `PORT` value (Passenger may pass a socket path) so our strict env validation
  is satisfied.

## Step-by-step

### 1. Create the database (cPanel → PostgreSQL Databases)

- Create a database, e.g. `hrms`. cPanel prefixes it with your account name →
  actual name `cpuser_hrms`.
- Create a database user with a strong password, e.g. `cpuser_hrmsapp`.
- Add the user to the database with **all privileges**.
- Note: host is `localhost`, port `5432`.

### 2. Build the deploy bundle (on your machine)

```bash
cd apps/api
bash scripts/build-cpanel-bundle.sh
```

This generates the Prisma client, builds, and produces
`apps/api/cpanel-bundle.zip` containing `dist/`, `package.json`,
`package-lock.json`, `passenger.js`, and `prisma/` (schema, for reference).
It deliberately excludes `node_modules` (installed on the host) and any secrets.

### 3. Apply migrations from your machine over an SSH tunnel

Shared Postgres usually only accepts local connections, and we don't want to
run Prisma's engine on the host — so tunnel in and migrate from your side:

```bash
# Terminal A — open the tunnel (use the SSH port your host gave you; often 22 or a custom one)
ssh -p 22 -L 5433:localhost:5432 cpuser@your-server-hostname

# Terminal B — run migrations THROUGH the tunnel (note port 5433 → localhost)
cd apps/api
DATABASE_URL="postgresql://cpuser_hrmsapp:PASSWORD@localhost:5433/cpuser_hrms?schema=public" \
  npx prisma migrate deploy
```

> First deployment only: if you haven't created migrations yet, run
> `npx prisma migrate dev --name init` locally against a dev database first to
> generate the migration files, commit them, then `migrate deploy` here.

### 4. Create the Node.js app (cPanel → Setup Node.js App)

- **Create Application.**
- **Node.js version:** 20+.
- **Application mode:** Production (this sets `NODE_ENV=production`).
- **Application root:** e.g. `hrms-api` (a folder in your home directory).
- **Application startup file:** `passenger.js`
- Create it. cPanel scaffolds the folder and a virtual environment.

### 5. Upload the bundle

Upload `cpanel-bundle.zip` into the application root (File Manager or SFTP) and
extract it there. You should end up with `dist/`, `package.json`,
`passenger.js`, etc. directly inside the application root.

### 6. Set environment variables (in the Node.js app UI, not a .env file)

Passenger doesn't always read a root `.env` reliably, and the UI is more secure.
In the app's "Environment variables" section add:

| Variable         | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`   | `postgresql://cpuser_hrmsapp:PASSWORD@localhost:5432/cpuser_hrms?schema=public` |
| `KEY_PROVIDER`   | `env`                                                                 |
| `ENCRYPTION_KEY` | 32-byte base64 (generate below)                                       |
| `HMAC_KEY`       | 32-byte base64 (generate below)                                       |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `NODE_ENV` comes from Application mode. `PORT` is **not** needed — Passenger
> assigns it. Keep `ENCRYPTION_KEY` / `HMAC_KEY` out of source control; store
> them somewhere safe — losing `ENCRYPTION_KEY` means unrecoverable data.

### 7. Install dependencies and start

- In the app UI, click **Run NPM Install** (installs runtime deps; the Prisma
  client is already generated, so no engine download happens).
- Click **Start App** (or Restart).
- The API is served at your app's domain/subdomain, e.g.
  `https://hrms.client.co.ke/api`, with Swagger at `/api/docs`.

Verify: `https://hrms.client.co.ke/api/health` → `{ "status": "ok" }`, and
`/api/health/ready` → `{ "status": "ready", "database": "up" }`.

### 8. Deploying updates later

1. Rebuild the bundle locally (`scripts/build-cpanel-bundle.sh`).
2. Apply any new migrations via the SSH tunnel (step 3).
3. Re-upload/extract `dist/` (and `package.json` if deps changed → Run NPM
   Install again).
4. Restart: click Restart in the UI, or `touch tmp/restart.txt` in the app root.

## Troubleshooting

- **503 / "Incomplete response received from application":** the app crashed on
  boot. Check the Passenger log (path shown in the Node.js app UI). Most common
  causes below.
- **`Invalid environment configuration`:** a required env var
  (`DATABASE_URL` / `ENCRYPTION_KEY` / `HMAC_KEY`) is missing or malformed in the
  app UI. This is the app failing closed on purpose.
- **`Cannot find module ...`:** you didn't Run NPM Install, or Node version
  mismatch. Re-run install inside the app's virtualenv (via SSH using the
  `source .../activate` command shown in the UI).
- **DB connection refused / timeout:** wrong `DATABASE_URL` (check the
  `cpuser_` prefix on both db and user), or the user lacks privileges, or you're
  pointing at `5433` (that's only the tunnel — the app itself uses `5432`).
- **Works then dies under load:** LVE memory limit. Reduce payroll batch size,
  or move to a VPS — this is a hard ceiling of shared hosting.

## Security note

On shared hosting you are a co-tenant with other accounts. The app-layer field
encryption (national ID, KRA PIN, bank account) means a database dump alone is
useless without the key, which materially reduces the blast radius — but it does
not make a shared box equivalent to an isolated one. For health-sector,
financial, or otherwise sensitive clients, prefer a VPS.
