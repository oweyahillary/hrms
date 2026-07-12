#!/usr/bin/env bash
# Convenience for interactive sessions — sets a fresh token + common IDs.
#   Usage:  source scripts/env.sh
# (Must be sourced, not executed, so the exports land in your shell.)
#
# After sourcing, `refresh` re-mints just the token in one word when it expires
# (access tokens are short-lived), without re-running the whole script.

export BASE_URL="${BASE_URL:-http://localhost:3000/api}"

# Local scratch space for test downloads (git-ignored via .scratch/). Resolved
# relative to this script so it works regardless of the current directory.
export SCRATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.scratch" 2>/dev/null && pwd)"
[ -n "$SCRATCH" ] || export SCRATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/.scratch"
mkdir -p "$SCRATCH" 2>/dev/null || true

# Re-mint just the access token (call `refresh` anytime it expires).
refresh() {
  export TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@example.com","password":"ChangeMe123!"}' \
    | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
  if [ -n "$TOKEN" ]; then echo "TOKEN refreshed."; else echo "login failed — is the API up at $BASE_URL?"; fi
}

export EMP=d14e23a6-4b96-4700-87a0-ed12a774193d   # Jane Wanjiru

refresh >/dev/null
if [ -n "$TOKEN" ]; then
  echo "TOKEN set; EMP=$EMP (Jane). Base: $BASE_URL"
  echo "SCRATCH=$SCRATCH  |  run 'refresh' to re-mint the token when it expires"
else
  echo "login failed — is the API up at $BASE_URL?"
fi
