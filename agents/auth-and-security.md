# Auth, household sharing, security

## Auth

- **Magic link email** OR **Google Sign-In** → session cookie (30 days).
- **Magic link grace window:** 10-minute grace period after first use to handle email client link prefetching.
- **Google auth via GIS** (Google Identity Services) — JWT verified server-side, no client secret needed. `GOOGLE_CLIENT_ID` env var.

## Household sharing

- Middleware resolves a member user → household owner's data for all data-bearing endpoints.
- **Per-household state** for grocery (order_source, regulars_added, pantry_checked, receipt_data) lives on `grocery_state` keyed by the **owner's** user_id.
- **Store sharing.** `allow_household` column on `user_kroger_tokens`. Toggle in Account sheet. Server-side check on order/submit. Endpoint name is generic: `/api/store/allow-household`.

## Rate limiting

DB-backed (`rate_limits` table), persists across deploys. Per-user limits:

| Action | Limit |
|---|---|
| search | 20 / min |
| receipt upload | 10 / min |
| magic link request | 3 / 15 min |
| invites | 5 / hr |

## Kroger token encryption

Fernet symmetric encryption via `ENCRYPTION_KEY` env var.

- Encrypt on write (OAuth callback, token refresh).
- Decrypt on read.
- Graceful fallback to plaintext if key not set.

## Admin

Admin user = `ADMIN_USER_ID` env var (set in prod) **or**, if unset, the first-registered user. `_is_admin(conn, user_id)` in `api.py` is the server-side gate on every admin endpoint; `_admin_user_id(conn)` returns that same id for owner-protection checks. `/auth/me` also returns an **`is_admin`** flag (same resolution) so the frontend can gate the Account-sheet "Admin dashboard" link and the `#admin` route — but the link/route are convenience only; the **data and actions are gated server-side**, so a non-admin hitting the URL or calling an endpoint directly gets `Not authorized`.

**Admin dashboard** (`#admin` → `AdminPanel`, Stats | Feedback tabs):
- `GET /admin/metrics` — usage rollups (plain SELECTs; read scalars via RowMapping, see `database.md` / MEMORY). "Active" = users with a live session, not `last_login`.
- `GET /admin/detail/{key}` — drill-down lists for `users` / `households` / `waitlist` / `invites` / `kroger` / `tips`. The `users` rows carry a `protected` flag (owner/self) so the UI hides revoke/delete on them.
- Other admin endpoints: feedback respond, unknown-brands review, e2e simulators (gated behind `PLAYWRIGHT_TEST_SECRET`).

**Account management endpoints** (all admin-gated except self-delete):
- `POST /admin/waitlist/approve` (allowlist + magic link + clear waitlist) · `/admin/waitlist/dismiss`
- `POST /admin/invite/cancel` (pending invites only)
- `POST /admin/user/revoke` — **soft**: delete from `allowed_emails` + delete sessions. Reversible (re-approve), data kept.
- `POST /admin/user/delete` — **hard**: `_USER_DELETE_SQL` wipes ~25 user-scoped tables child-first, then the `users` row. Irreversible.
- `POST /account/delete` — **self-serve**, NOT admin-gated; acts on `request.state.real_user_id`, same `_USER_DELETE_SQL`. Wired to "Delete my account" in the Account sheet.
- **Owner/self is blocked server-side** on revoke + both deletes (`target_id in (real_user_id, _admin_user_id(conn))`; self-delete blocks the app owner). `_USER_DELETE_SQL` is verified to cover every FK referencing `users` — if a new user-scoped table with an FK to `users` is added, add it to that list or the hard delete will FK-error.

## Public webhook paths

`/api/stripe/webhook` is in `PUBLIC_PATHS` in `code/mealrunner/web/auth.py` so Stripe can hit it without a session cookie. See `agents/tip-jar.md` for signature verification.
