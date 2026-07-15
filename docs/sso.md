# SSO (OpenID Connect) — groundwork

Single sign-on via the OIDC Authorization Code flow. **Disabled by default** and
dormant until configured, so it has no effect on the existing local login. Local
email/password (with MFA) always remains available as the **break-glass** path.

Status: **scaffold only.** It compiles and is wired end-to-end, but has **not
been exercised against a live identity provider**. The provider-specific wiring
(registering the redirect URI, obtaining client credentials, confirming claim
names) is completed when a pilot client's IdP is known.

## How it works

1. SPA calls `GET /api/auth/sso/config` → `{ enabled }`. When true, the login
   page shows a "Sign in with SSO" button.
2. Button → `GET /api/auth/sso/login`. The server discovers the IdP
   (`{issuer}/.well-known/openid-configuration`), signs a short-lived `state`
   (CSRF), and redirects to the IdP's authorization endpoint.
3. IdP authenticates the user and redirects back to
   `GET /api/auth/sso/callback?code=…&state=…`.
4. The server verifies `state`, exchanges the `code` at the token endpoint, and
   verifies the returned `id_token` signature/issuer/audience against the IdP's
   JWKS (via `jose`).
5. The verified `email` is mapped to a **local** user (`AuthService.ssoLogin`).
   Users must already be provisioned locally — SSO authenticates, it does not
   auto-create accounts or grant access on its own.
6. Our normal session (access + refresh) is issued and handed to the SPA at
   `/{OIDC_POST_LOGIN_REDIRECT}/sso/callback#accessToken=…&refreshToken=…`; the
   SPA adopts the tokens, calls `/auth/me`, and lands on the dashboard.

## Enabling it (per instance)

Set in `apps/api/.env` (single-tenant, so one IdP per deployment):

```
SSO_ENABLED=true
OIDC_ISSUER=https://accounts.google.com          # or Entra / Okta issuer
OIDC_CLIENT_ID=…
OIDC_CLIENT_SECRET=…
OIDC_REDIRECT_URI=https://<api-host>/api/auth/sso/callback
OIDC_SCOPES=openid email profile                 # optional
OIDC_POST_LOGIN_REDIRECT=https://<spa-host>      # optional
```

Register `OIDC_REDIRECT_URI` as an allowed redirect in the IdP app registration.
When `SSO_ENABLED=true`, the `OIDC_*` values are required at boot (fail-closed).

## Provider notes (fill in per pilot)

- **Google Workspace** — issuer `https://accounts.google.com`; `email` +
  `email_verified` are standard.
- **Microsoft Entra ID** — issuer
  `https://login.microsoftonline.com/<tenant>/v2.0`; email may arrive as
  `preferred_username`; confirm before relying on `email`.
- **Okta** — issuer `https://<org>.okta.com`.

## Before production (hardening TODO)

- **Token handoff:** the callback currently passes tokens in the redirect URL
  fragment. Move to an **httpOnly, Secure refresh cookie** so tokens never touch
  the URL/history; the SPA then calls `/auth/refresh` to get an access token.
- **State binding:** `state` is signed but not yet bound to the browser session
  via a cookie; add a nonce cookie compared on callback.
- **Account linking:** matching is by verified email. Optionally store the IdP
  `sub` on the user for stronger linking if emails can change.
- **Live test:** run the full flow against the pilot IdP; add an integration
  check once a test IdP or mock is available (not covered by the current e2e
  suite, which needs no external IdP).

## Files

- `apps/api/src/auth/oidc.service.ts` — discovery, authorize URL, callback verify
- `apps/api/src/auth/oidc.controller.ts` — `/auth/sso/{config,login,callback}`
- `apps/api/src/auth/auth.service.ts` — `ssoLogin(email)` (email → local session)
- `apps/api/src/auth/tokens.service.ts` — `signSsoState` / `verifySsoState`
- `apps/web/src/pages/SsoCallbackPage.tsx` — SPA token handoff
- `apps/web/src/pages/LoginPage.tsx` — conditional "Sign in with SSO" button
