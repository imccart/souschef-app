# Price tracking

Three layers: passive logging on every user action, optional active polling on a background thread, and anonymized community aggregation.

## Passive logging

Search results, product selections, and receipt items are all logged to `product_prices` whenever the user touches them. This is always on — no setting.

## Active polling (opt-in)

12-hour cycle via background thread.

- Polling updates the **`product_scores` cache**, not just `product_prices`. So repeat searches hit the cache instead of doing individual Kroger lookups for each user.
- User opts in via Account → Price Tracking accordion.

## Community aggregation (opt-in)

Anonymized daily rollup → `community_prices`. Opt-in sharing only. Settings live in Account → Price Tracking.

## Tables

- `product_prices` — raw log of observed prices.
- `community_prices` — daily rollup across opted-in users.
- `product_scores` — cache of polled prices, used by search to skip per-UPC Kroger lookups.

## Insights endpoints

- **`GET /price-tracking/best-day?scope=trip|usuals`** — day-of-week price patterns. Normalizes each UPC to its mean and averages the pct diff across the basket. **Poll-source rows only** — the other sources (search/select/receipt/nearby) fire only on days the app is used, so they inject a collection-timing artifact, not a real price pattern; the background poll runs server-side on a timer regardless of usage. Returns `thin=True` (too little data: <20 samples or <4 days) and `flat=True` (enough data but day-to-day `spread` <1pp, i.e. prices hold steady — no day worth planning around). The UI only shows a "cheapest day" hero when both are false; `flat` renders a "prices hold steady across the week" message. Empirically, cleaned poll-only data for the current single-Kroger setup is flat (~0.2–0.4pp spread), which is the honest answer — the feature is wired to light up automatically if a real weekly pattern ever emerges.
- **`GET /price-tracking/basket-trend`** — sums matched `grocery_items.receipt_price` (no qty multiplication — it's the line total) plus unmatched `receipt_extra_items`, grouped by week. Only "real" shopping weeks (≥10 items or ≥$50) feed the headline average.
