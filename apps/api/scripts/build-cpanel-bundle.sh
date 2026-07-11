#!/usr/bin/env bash
# Build a deploy bundle for cPanel shared hosting.
# Run from apps/api on YOUR machine (needs internet for `prisma generate`).
# Produces cpanel-bundle.zip containing everything the shared host needs —
# EXCEPT node_modules (installed on the host) and secrets (set in the cPanel UI).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Generating Prisma client (Rust-free, pure JS — no engine needed on host)"
npx prisma generate

echo "==> Building"
npm run build

echo "==> Assembling bundle"
rm -rf .cpanel-bundle cpanel-bundle.zip
mkdir -p .cpanel-bundle
cp -r dist .cpanel-bundle/
cp package.json passenger.js .cpanel-bundle/
[ -f package-lock.json ] && cp package-lock.json .cpanel-bundle/ || true
cp -r prisma .cpanel-bundle/   # schema kept for reference only; migrations run from your machine

( cd .cpanel-bundle && zip -rq ../cpanel-bundle.zip . )
rm -rf .cpanel-bundle
echo "==> Done: apps/api/cpanel-bundle.zip"
echo "    Upload + extract into the cPanel application root, then Run NPM Install."
