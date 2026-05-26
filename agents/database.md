# Database

PostgreSQL-specific patterns, gotchas, and operational rules for MealRunner. PostgreSQL is the only supported backend — there is no SQLite fallback. The app fails with a clear error if `DATABASE_URL` is missing.

## Architecture

- **SQLAlchemy Core** with `text()` + `:named` parameters. No ORM.
- **`DictConnection` / `DictResult`** wrappers (`code/mealrunner/database.py`) add `row["column"]` access to SQLAlchemy results. Thin wrappers — only forward `execute`, `commit`, `begin`, `close`. For anything else, reach for `conn.raw.<method>()`.
- **Per-request connection middleware** (`code/mealrunner/web/app.py:ConnectionMiddleware`): opens one `DictConnection` per request via `contextvars`, closes it in `finally`. All endpoints share it via `_conn()` → `get_request_connection()`. Pool: 10 + 5 overflow, 30s timeout.
- **Startup init** (`ensure_db_initialized()`) runs once: kills stale connections, runs migrations, seeds. Closes its own connection.
- **Migrations are additive and idempotent.** `ALTER TABLE ADD COLUMN IF NOT EXISTS`, `pg_constraint` probes before `DROP CONSTRAINT IF EXISTS`. Non-fatal on lock timeout — the app starts anyway and migrations catch up next deploy. New column access in `api.py` is defensive (try/except).
- **`RETURNING id` + `fetchone()["id"]`** for inserts. PostgreSQL `lastrowid` returns 0; don't use it.

## Production connection

**Connection details (host, port, full URL with credentials) live in `agents/local/database.md` — gitignored, local-only.** Never copy any of those values into a tracked file.

If `agents/local/database.md` is missing, repopulate it from Railway: dashboard → mealrunner → Postgres service → Variables → `DATABASE_URL` and `DATABASE_PRIVATE_URL`. The local doc is also the right place for any prod-specific operational notes (DNS fallback IPs, etc.) that would otherwise drift into a tracked file.

**Local scripts must pass `sslmode=require`.** Connecting to the Railway *public* proxy (`*.proxy.rlwy.net`) from a local Python script with psycopg2's default `sslmode=prefer` intermittently fails the SSL handshake with `OperationalError: ... could not receive data from server: Software caused connection abort`. Raw TCP to the proxy port connects fine, so it's an SSL-negotiation quirk, not the proxy being down. Pass `create_engine(URL, connect_args={"sslmode": "require"})` (or `psycopg2.connect(URL, sslmode="require")`). The app itself is unaffected — it uses the private network, not this proxy.

### Standing read authorization

Reading the prod DB for diagnostics is **pre-authorized** — don't ask before SELECT-only queries. Just run them. Asking burns time and frustrates the user since this is the well-established triage path.

Confirmed standing OK for: `user_feedback`, `grocery_items`, `meals`, `recipes`, `rate_limits`, etc.

**Writes still need explicit per-task authorization** — one-off migration / dedup / cleanup scripts must be confirmed before each run.

If the sandbox blocks the SELECT and the user is already in the loop, **re-attempt** rather than re-asking. The harness's permission denial is not the same as the user denying — once the user has signaled standing OK, retry with `dangerouslyDisableSandbox: true` if needed (read-only SELECTs only).

Don't dump large amounts of user data to context — query with specific WHERE clauses. Print only columns needed.

The user does **not** have the Railway CLI installed. Don't suggest `railway run` / dashboard-driven queries — connect directly.

---

## `timestamptz` columns — read AND write gotchas

All `_at` / `_login` / `_picked` / `_seen` / `window_start` columns are `timestamptz` (migrated session 53 from TEXT). Column list: `_TIMESTAMP_COLUMNS` in `db.py`. Use `DateTime(timezone=True)` (`TS` alias in `database.py`) for new timestamp columns.

**`meals.slot_date` is the exception — it's stored as TEXT** (ISO `YYYY-MM-DD`), not a date type. So `WHERE slot_date >= CURRENT_DATE` 500s with `operator does not exist: text >= date`. Compare against an ISO **string** (`slot_date >= :iso`) or cast explicitly (`slot_date::date >= CURRENT_DATE`). The ISO-string lexical sort matches date order, so plain text comparison is correct for ranges.

Exception: `company_violations.most_recent_date` stays TEXT (YYYYMMDD label from FDA).

### Read-side

psycopg2 returns these columns as **tz-aware `datetime` objects, NOT ISO strings**.

- Never wrap reads in `datetime.fromisoformat()`.
- Never call `.replace("Z", "+00:00")` — `datetime.replace()` takes int kwargs and raises `TypeError` on a string arg, which often gets swallowed silently and returns `None`.
- Never `.date[:10]` slice. Use `.date()`.
- Build cutoffs as tz-aware datetimes: `datetime.now(timezone.utc) - timedelta(...)`.
- Defensive `isinstance(x, str)` fallbacks with fromisoformat are OK for deploy-transition safety; once all callsites are clean, strip them.

**Past failures from this class:**

1. `_check_throttle` (api.py) called `.replace("Z","+00:00")` on a datetime. TypeError caught silently → window never reset → rate-limited endpoints permanently 429'd. Fixed 2026-04-24.
2. `_parse_ts` (api.py) had the same pattern → returned None for every datetime input → `recently_checked` list always empty AND `_regulars_prompt_state` 3-day TTL was non-functional. Fixed 2026-05-01 (commit `e7a136d`).
3. Dead `_prompt_state` had the same latent pattern; deleted in commit `d29dfea`.

### Write-side

`UPDATE table SET ts_col = CURRENT_TIMESTAMP::text` (or any `::text` expression) FAILS with `column is timestamp with time zone but expression is text`. Postgres does NOT implicitly cast text → timestamptz for explicitly-typed SQL expressions. The error 500s the request and rolls back the whole transaction.

**Fix:** drop the `::text` cast. Bare `CURRENT_TIMESTAMP` is already timestamptz.

**Subtle distinction — parameters DO get coerced:** `UPDATE t SET ts_col = :v` with `{"v": "2026-05-01T..."}` (a Python str via psycopg2) works because the parameter is sent untyped and Postgres coerces from the column type. So `expires=expires.isoformat()` writes to magic_links/sessions still work. The bug is **specifically** explicit `::text` in SQL, not parameter binding.

**Past failure:** `/grocery/toggle` had `UPDATE regulars SET last_bought_at = CURRENT_TIMESTAMP::text` and same for pantry. Every swipe-bought on a regulars/pantry row 500'd. The frontend rollback would refetch and restore the item, so the user's symptom was "swipe doesn't work on regulars items, kitchen-style toast pops up." Fixed 2026-05-01 (commit `db9ec74`).

### Audit pattern

Periodically grep for both:
- `fromisoformat` and `.replace(.*Z` on values from timestamptz columns (read-side)
- `::text` and `::timestamp` casts in `UPDATE`/`INSERT` where the target column is in `_TIMESTAMP_COLUMNS` (write-side)

---

## psycopg2 doesn't auto-cast Python `bool` to PostgreSQL `Integer`

PostgreSQL is strict about types: `column "curbside" is of type integer but expression is of type boolean`. psycopg2 doesn't auto-coerce.

**Fix at the parameter dict, not in SQL:**
```python
"curbside": int(bool(value)),  # not just `value`
```

### Why it matters more than it looks

Inside a multi-statement loop with a per-iteration try/except, **a single failure poisons the whole transaction**. Every subsequent statement raises `current transaction is aborted, commands ignored until end of transaction block`, the per-iteration except silently catches them, and 0 rows commit. The function looks like it ran (no thrown exception), counts errors silently, and returns "0 polled, N errors" with no log.

**Concrete incident:** `pricing.py poll_user_prices` ran for 49 UPCs every 6h. When `INSERT INTO product_scores` was added on 2026-03-30 (commit `e9a2d6e`), it passed `curbside`/`delivery` as Python booleans. First UPC raised, transaction poisoned, all 48 subsequent UPCs failed silently. **Background polling produced 0 rows for 4 weeks** before being noticed via biased "best day" analysis on the order page.

### Apply

- Always `int(bool(x))` Python booleans destined for `Integer` columns in INSERT/UPDATE param dicts.
- For multi-statement loops, prefer `conn.commit()` per iteration OR `conn.raw.begin_nested()` savepoints (see below) so one failure doesn't kill the rest.
- When a background thread runs silently for weeks, query the DB directly (e.g. `SELECT MAX(fetched_at) FROM product_prices WHERE source='poll'`) to verify it's actually writing. **"No errors in logs" ≠ "running successfully"** if the per-iteration except is swallowing them.

---

## Savepoints via `conn.raw.begin_nested()`

`DictConnection` is a thin wrapper that only forwards `execute`, `commit`, `begin`, `close`. It does NOT forward `begin_nested`, `rollback`, `inspector`, etc.

For savepoint-based "best-effort" transactions (e.g. tolerant cleanup endpoints):

```python
sp = conn.raw.begin_nested()
try:
    conn.execute(text(...), params)
    sp.commit()
except Exception as e:
    sp.rollback()
    errors.append(str(e))
```

**Why:** Hit during e2e-cleanup endpoint dev (session 54). First version called `conn.begin_nested()` directly → AttributeError every iteration → no SQL ran → endpoint reported success but deleted nothing. The `.raw` accessor is documented in `database.py` but easy to miss.

**Apply:** Any time you need savepoint, rollback, or other SQLAlchemy Connection methods beyond the basic four, reach for `conn.raw.<method>()`.

---

## `with conn.begin():` does not work in route handlers

Don't reach for `with conn.begin():` to wrap a transaction inside a route. It will raise `InvalidRequestError: this connection has already initialized a SQLAlchemy Transaction()`.

**Why:** `AuthMiddleware.dispatch` calls `get_household_owner_id(conn, user_id)` (`auth.py:325`) before the route handler runs. That executes a SELECT, which autobegins a transaction in SQLAlchemy 2.x. By the time the handler reaches `conn.begin()`, the connection is already in a tx, and `Connection.begin()` raises rather than nesting.

This was latent in `swap_meal_smart` from session 18 (the audit "fix" that added `with conn.begin():` for a read-swap-read race) until session 68's e2e suite finally called the endpoint and surfaced the 500.

**Apply:** If you need an explicit transaction inside a handler, use `conn.raw.begin_nested()` (savepoint) instead. Don't try `conn.begin()` even though it parses fine — the middleware's autobegun tx will always be there.

---

## Legacy single-user UNIQUE-on-name constraints

**Don't trust the SQLAlchemy `Table` definitions in `database.py` to reflect prod's actual unique/primary-key constraints.** The DB has accumulated single-user-era constraints (`UNIQUE(name)`, `PRIMARY KEY(name)`) that the Python schema has long since dropped. They were correct when the app was single-user; they're bugs now.

**Why this matters:** 2026-05-03 (session 64) — the regulars-overlap e2e test 500'd because `regulars.name` had `regulars_name_key UNIQUE(name)` on prod. Once one user added a regular for "chicken thighs", any other user 500'd on the same name. Same shape on `learning_dismissed` (PRIMARY KEY on `name` alone). Both invisible in single-user testing. Application-level dedup at `regulars.add_regular` keys on `(user_id, LOWER(name))`, so the constraint was redundant defense and a multi-user bug.

### Apply

- Before assuming a table's uniqueness behavior matches the Python schema, run on prod:
  ```sql
  SELECT indexdef FROM pg_indexes WHERE tablename = '<name>';
  ```
  If you see a unique on `name` without `user_id`, that's a bug.
- Tables to check first when chasing **"why does this work for one user but 500 for another?"**: any with a `name` column added before `user_id` was retrofitted onto the schema. Confirmed already-dropped: `recipes.name`, `regulars.name`, `learning_dismissed`. Other candidates worth probing if a similar bug surfaces: `pantry`, `stores`, `nearby_stores`.
- The `_migrate_drop_legacy_single_user_uniques` pattern in `db.py` is the right shape — pg_constraint probe → `DROP CONSTRAINT IF EXISTS`, idempotent, runs unconditionally on startup. Reuse if more leftovers surface.
- **Don't rush to ADD a replacement `UNIQUE(user_id, name)`** — app-level dedup is already in place, and adding a constraint is risky if any pre-existing rows violate it. Only add if there's a real correctness need.

---

## `release_db_during_io` for long external HTTP

When an endpoint makes long external HTTP calls (Kroger, Open Food Facts, Claude Vision), wrap them in `with release_db_during_io():` to free the request's pool slot.

```python
with release_db_during_io():
    # external HTTP work, no DB reads/writes inside
    results = call_kroger(...)
conn = _conn()  # contextvar holds a fresh conn now
conn.execute(...)  # uses the new conn
```

### Why

Per-request middleware opens a DB connection at request start and closes at finally. With a 15-conn pool and ~2-3s Kroger latency, 15 concurrent searches lock the entire pool for the full external-HTTP wait. The release pattern drops connection-held time on `/order/search` from ~2-3s to ~500ms.

### Rules

1. **Import the helper from `mealrunner.database`.** Already imported at the top of `api.py`. Don't inline-import inside the with-block.
2. **Wrap only long blocks** — Kroger search/HTTP, OFF lookups, Claude Vision. Don't wrap quick operations (~200ms) — the ceremony costs more than the gain.
3. **Refresh the local `conn` after the block.** The variable held a reference to the now-closed connection; the contextvar was swapped to a new one. Forgetting `conn = _conn()` is the #1 way to break the endpoint.
4. **Don't touch the DB inside the with-block.** No conn in the contextvar (set to None on entry). Reads/writes will fail. Do DB work before or after.
5. **Don't use this in background threads** — they don't have a contextvar conn to swap; the helper is a no-op outside a request.

### Architecture detail (DO NOT undo)

The middleware (`app.py:ConnectionMiddleware`) closes `get_request_connection()` (whatever's currently in the contextvar), NOT the local `conn` variable it captured at request start. This was the critical change in commit `9fe941a` that makes mid-request connection swap safe. **If you "fix" the middleware to go back to closing the local var, the helper leaks the swapped-in conn and the original (already-closed) conn gets a double-close.**

### Locations

Currently using the pattern:
- `/order/search` — wraps OFF score-fetch ThreadPool and per-UPC Kroger pref-lookup ThreadPool

Should adopt but haven't yet:
- `/receipt/upload-file` — Claude Vision call is 2-5s
- Any future endpoint making Stripe API calls
