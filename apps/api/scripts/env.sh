#!/usr/bin/env bash
# Convenience for interactive sessions — sets a fresh token + common IDs.
#   Usage:  source scripts/env.sh
# (Must be sourced, not executed, so the exports land in your shell.)
export BASE_URL="${BASE_URL:-http://localhost:3000/api}"
export TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
export EMP=d14e23a6-4b96-4700-87a0-ed12a774193d   # Jane Wanjiru
if [ -n "$TOKEN" ]; then echo "TOKEN set; EMP=$EMP (Jane). Base: $BASE_URL"; else echo "login failed — is the API up at $BASE_URL?"; fi
