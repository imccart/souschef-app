# MealRunner E2E Tests

Playwright-based smoke tests that run against the Railway staging environment.

## Running Locally

Install the Playwright browser once:

```bash
cd frontend
npm install
npx playwright install --with-deps
```

Set the two env vars, then run the suite:

```bash
export PLAYWRIGHT_BASE_URL="https://staging.getmealrunner.app"
export PLAYWRIGHT_TEST_SECRET="<matches Railway staging PLAYWRIGHT_TEST_SECRET>"

npm run test:e2e          # headless
npm run test:e2e:headed   # see the browser
npm run test:e2e:ui       # interactive UI
```

## How It Works

- **Auth bypass**: `POST /api/auth/e2e-login` returns a valid session cookie without magic-link email. Only active when the backend sees `PLAYWRIGHT_TEST_SECRET` in its environment. Production must never set this.
- **Test user emails** are always `e2e-<timestamp>-<rand>@mealrunner-test.invalid`. The login endpoint rejects anything that doesn't match that prefix and TLD, so a leaked secret can't create a real user account.
- **Cleanup**: every run's `globalTeardown` calls `POST /api/admin/e2e-cleanup`, which deletes all users matching the test pattern and cascades their data. If a test crashes mid-run, the next run's teardown still cleans it up.
- **Pollution note**: tests run against the staging DB (not a separate test DB). This is intentional — separating would invite schema drift. Staging feedback/stats counts will be inflated; that's fine.

## Adding a Test

Import from `fixtures.js`, not `@playwright/test`:

```js
import { test, expect } from "./fixtures.js";

test("my flow", async ({ authedPage }) => {
  await authedPage.goto("/app");
  // `authedPage` already has a session cookie for a fresh e2e user.
});
```

Available fixtures:
- `testEmail` — the fresh `e2e-*` email for this test
- `authedPage` — a `Page` with an active session; depends on `testEmail`

## CI

`.github/workflows/e2e.yml` runs the suite on every push to `master` and `staging`. It's **advisory** — failures show up in the Actions tab but don't block merges. Flip to blocking later by making it a required status check.

Required GitHub secrets:
- `STAGING_URL` — e.g. `https://staging.getmealrunner.app`
- `PLAYWRIGHT_TEST_SECRET` — must match the value set on Railway staging

## Deferred — Add Later

These are intentionally not implemented in the first pass. Keep the plan parked here so we don't re-discover it:

### Receipt parsing tests (spec #8 and #9)

**PDF receipts (Kroger)**
- Parsing is deterministic (PyMuPDF), so real fixtures give the best signal.
- Plan: redact 2-3 real Kroger PDFs (regenerate replacing name/address/card last-4/phone), commit to `e2e/fixtures/receipts/`. Cover normal / substitutions / out-of-stock.
- Test seeds a known trip, uploads the PDF, asserts matched items and extras.

**Photo receipts (Claude Vision)**
- Real vision call is expensive and non-deterministic — bad fit for CI.
- Plan: mock at the application boundary. Add a test-only override so when `PLAYWRIGHT_TEST_SECRET` is set and the request includes `X-E2E-Receipt-Fixture: <name>`, the endpoint returns a canned parsed response from `e2e/fixtures/receipts/<name>.json` instead of calling Claude.
- Test uploads any small JPEG, passes the header, asserts matching + UI. Exercises every code path except Claude itself.
- When monetization lands, add a premium-gate check: free user → friendly upsell; premium user → parses.

**Why deferred**: receipt tests need redacted fixtures and a mocking harness that isn't needed for the other 8 critical paths. Build confidence in the base suite first, then layer receipts on.
