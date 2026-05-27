# Order flow + Receipt reconciliation

The two halves of the "buy → reconcile" loop. Order page sends a cart to Kroger; Receipt page closes the loop by matching what arrived against what was on the list.

## Store integrations

- **Store-agnostic model.** Each store row has an `api` field. Kroger is auto-detected from store name.
- **Fulfillment mode** (pickup / delivery) is chosen at order time, not store setup.
- **Household store sharing.** `allow_household` column on `user_kroger_tokens`. Toggle in Account sheet. Server-side check on order/submit. Endpoint name is generic: `/api/store/allow-household`.
- **Shared Kroger account indicator.** Order page and Account sheet show whose account is being used when ordering through a household member's shared Kroger account.

## Order page

Simple ← prev / next → navigation through items.

- Editable search box pre-filled with item name; Enter submits.
- Quantity selector and "Anything else?" as modal popups.
- Paginated search.
- Prior selections enriched with price / NOVA / parent company / FDA violations.
- Thumbs-down products suppressed.
- **End-of-list state:** mobile shows stacked Keep shopping / Send to store (Sheet) / Compare (Sheet). Desktop shows Keep shopping + a hint to use the sidebar.
- **Desktop sidebar:** Active / Ordered / Buying elsewhere section headers, comparison toggle, send button.
- **Mobile:** tappable header counts.

## Order submission

- `submitted_at` timestamp on trip items, set **before** Kroger API call (rolled back on failure) to prevent duplicate submits on crash/deploy.
- Submitted items excluded from future order flows.
- Order page refreshes after submit → empty state.
- **Quantity cap:** clamped to `[1, 24]` in the `select_product` endpoint.
- **Submit chokepoint filter** (session 73): the submit SELECT is the single guard against closed-state rows reaching Kroger. Filter is `product_upc != '' AND ordered = 1 AND submitted_at IS NULL AND checked = 0 AND have_it = 0 AND removed = 0 AND COALESCE(receipt_status, '') = ''`. The rollback path on failure mirrors the same filter. **Why this matters:** `grocery_items` holds both the active list and the purchase log (matched/substituted rows back ratings, spend totals, `/purchases`, receipt dedup, staple suggestions). `select_product`'s UPDATE matches by `LOWER(name)` with no state filter, so it CAN stamp `ordered=1, product_upc=X` onto a hidden matched row sharing a name with the active pick. Without the chokepoint filter, Kroger's additive `/cart/add` sums the duplicate UPC into qty=2.
- **Stuck-row repair gate** (`_ensure_active_trip`, api.py:642): clears `submitted_at` on `ordered=0 AND submitted_at IS NOT NULL` rows but **must** exclude `receipt_status != ''` — matched rows legitimately have `ordered=0` with their original `submitted_at` preserved as a "finalized" marker. Clearing it makes them re-pickable by the chokepoint.

## Meal attribution

Order page "Picking for" section and Walk the Aisles mode both show meal names and notes below each item — helps with protein / variant decisions in context.

## Product ratings

Thumbs up/down on reconciled receipt items. Ratings surface on the Order page (prior selections + search results, sorted by rating).

## Product key system

`product_key = UPC` if available, else `brand|description`. Enables rating / preferences for receipt items without UPCs. `receipt_extra_items` table stores unmatched receipt items. Receipt dedup prevents double-counting on re-upload.

## Receipt upload

- **Take photo** (full-res camera via `getUserMedia` / `ImageCapture` API) + **Choose from library** (file picker). `CameraCapture.jsx` component.
- **Kroger PDFs** parsed structurally via PyMuPDF — no Claude API call.
- **Image receipts** parsed via Claude Vision **single-pass**: ONE call extracts items AND matches against the grocery list simultaneously. Visual context (size, brand, package type) improves matching.
  - Prompt includes a synonym list (Lip Balm = chapstick, Tissue = kleenex, Cotton Swab = q-tip, Plastic Wrap = saran wrap, Aluminum Foil = tin foil, Adhesive Bandage = band-aid, Hand Soap, Dish Soap) plus instruction to apply similar logic.
  - Explicit "match across categories — food, personal care, household, cleaning, pets" and an anti-hallucination check against the list post-response.
  - Unmatched receipt lines dropped (raw abbreviations not useful).
- `ANTHROPIC_API_KEY` env var required for image receipts.

## Receipt page UX

- Upload buttons are card-style ('Take a photo' / 'Choose a file') with icons + subtitle hints, stacked on narrow screens.
- Header subtitle shows "N to confirm" / "N extra to review" / "Upload a receipt..." instead of a misleading lifetime "N confirmed" count.
- All reconciliation items default to **expanded** (collapsed set inverted) so users see what needs confirming.
- Matched items show the **grocery name** as primary label, with "from receipt: {actual line text}" always below.

## Reconciliation scoping

- Matches against all unreconciled items regardless of checked state — auto-prune handles stale.
- Submitted items that fail UPC match get a second pass through `diff_grocery_list` (smarter word-subset matching).
- **Confirming a match** sets `checked=1, ordered=0`.
- **Not-fulfilled** items reset to active so they can be re-ordered. `_not_fulfilled_sql` clears `ordered` / `submitted_at` / `product_*` **and** `receipt_item` / `receipt_upc` / `receipt_price` (session 77 — previously left the latter three populated, so demoted rows carried stale match evidence).
- **`not_fulfilled` sibling suppression** (session 79, feedback #110): `get_grocery` hides a `not_fulfilled` row from the active list when another row with the same `compare_key` was already handled (checked / have-it / matched / substituted). Reconciliation can't always bind a receipt line to the exact planned row — variant names ("flour" vs "large" tortillas) or per-meal duplicate rows — so it demotes the planned row to `not_fulfilled` and it resurfaces as a "grab elsewhere" active item even though the user bought it under a sibling. A genuinely-undelivered item (no handled sibling) still shows. Read-side filter only; the rows are untouched in the DB.

## No match-side dedup on re-upload (session 77)

`_process_receipt` does **not** filter incoming receipt items against past *matched* grocery rows. An earlier `already_matched_names` filter (set of `receipt_item` strings from prior matches) was deleted — it blocked a repeat purchase of the same Kroger description from ever matching again (obvious items like bacon / hot dogs / edamame silently went to Extras). Only `already_extra_names` is kept, which prevents duplicate **extras** inserts on re-upload. Worst case of no match-dedup is a recoverable flood of extras, not a lost match. No order-number / (store,date,total) dedup key was added — re-running reconciliation against the current list is idempotent enough.

## Receipt metadata (session 77)

`parse_receipt_pdf` / `parse_receipt_image` return `(items, footer_count, metadata)`. `metadata` is `{store, store_location, order_date (ISO YYYY-MM-DD), order_number, total_price}` — empty string / null for fields not present. PDF path uses `_extract_kroger_metadata(text)` (regex on the Kroger order block); image path asks Vision via a RECEIPT METADATA prompt block + schema fields. `grocery_state.receipt_data` entries are now dicts (`store / store_location / order_date / order_number / total_price / footer_count / items`) instead of bare item lists; `_process_receipt` wraps any legacy bare-list entry as a dict on read (every upload).

## diff_grocery_list scoring (session 74 restructure)

Match score = `max()` across three independent strategies, not a cascading if/elif. Earlier code's if/elif let a low-coverage substring hit silently block the word-subset fallback: `g_compact in r_compact` could enter the outer branch, fail the inner `coverage >= 0.5` check, and exit without setting score AND without falling through. Production manifestation: "maple syrup" (10-char compact) inside a 54-char Kroger description = coverage 0.18, blocked match. `score` also wasn't initialized per inner iteration, so first hit threw UnboundLocalError; later iterations silently carried stale scores from prior iterations. Repro in `scratch/repro_match_bug.py`.

Strategies (each emits 0 if its predicate fails, score capped at min 0.6 if it fires):
- **Spaceless substring** (either direction): `g_compact in r_compact` (or reverse), >= 4 chars, coverage >= 0.5. Coverage cap blocks "bread" → "breadbutterwine".
- **Word subset**: every grocery word appears as an exact token in r_words. Single-word groceries allowed when the word is >= 4 chars — distinctive head nouns ("bacon", "eggs") match long descriptions; short ambiguous nouns ("tea", "oil") don't false-positive on "Tea Tree Oil". Token comparison protects against "eggs" matching "Eggless Pasta" (eggs not a token in {eggless, pasta}).
- **Stem-aware overlap**: `gw.startswith(rw) or rw.startswith(gw)` (so "banana" matches "bananas"), denominator = max(len(g_words), len(r_words)).

Match threshold remains 0.6. AI fallback (`_ai_match`) still runs on the unmatched remainder.

## Receipt page is a queue, not a log (session 74)

`/receipt` GET has two new behaviors:
- **Lazy auto-ack**: before reading rows, `UPDATE grocery_items SET receipt_acknowledged=1 WHERE user_id=:u AND receipt_status IN ('matched','substituted') AND receipt_acknowledged=0 AND submitted_at IS NOT NULL AND submitted_at < NOW() - INTERVAL '10 days'`. `submitted_at` is the proxy for "match age" since most matched rows came through a Kroger order. Rows without `submitted_at` (rare — e.g. checked-off-list rows matched via receipt) stay unacknowledged until manual dismiss.
- **Acknowledged-purchase filter**: row query excludes `receipt_status IN ('matched','substituted','dismissed') AND receipt_acknowledged=1`. `not_fulfilled` and `''` (active list) always show. The 10-day window matches the rolling plan window for consistency.

Purchase history (`/purchases`), receipt re-upload dedup (`api.py:2826`), and price logging all query `grocery_items` directly and aren't affected by the receipt-page filter.

## Item-count cross-check (shipped session 70)

`_process_receipt` writes `item_count_footer` / `item_count_parsed` / `item_count_gap` into the upload response when a parser returns a footer count, and logs `logger.warning` on mismatch. UI is silent — gap is a backend signal, not a user nag.

- **PDF path:** `parse_receipt_pdf` extracts `Item Details   N Items` via regex on the PyMuPDF text. Compared against `sum(qty)` of structurally-walked items.
- **Image path:** `parse_receipt_image` Vision prompt asks Claude to also return a `footer_count` (recognizing `# ITEMS SOLD`, `NUMBER OF ITEMS`, `TOTAL NUMBER OF ITEMS SOLD`, `BOB Count`, `ITEMS N`, `N Artikel`, etc.). Response shape is `{"footer_count": N|null, "items": [...]}`; legacy bare-array response is still tolerated for backward compat. Compared against `len(items)` (Vision items always have qty=1).

Two distinct failure modes the gap can surface, with different recoveries:
- **Extraction miss (Case A):** parser extracted fewer line items than the footer states. PDF cause is usually a malformed UPC block or new line shape the structural walker doesn't handle; image cause is Vision dropping faint/folded lines. **Recovery not built** — waiting for real gapped uploads in logs to design against. For images the only viable second pass is re-prompting Vision with the footer count as a hint, since Vision *is* the parser.
- **Matching miss (Case B):** parser got everything but matching couldn't bind some lines to grocery rows. Already largely handled — `diff_grocery_list` runs against `all_name_candidates` (every active grocery row, not just submitted-to-Kroger), and the leftover ends up in `receipt_extra_items` for manual "This is..." binding.

## Substitution detection

When `diff_order` matches by name (not UPC), the item is marked `substituted` instead of `matched`. Ratings apply to the **received** product (uses `receipt_upc` first).

## Confirmation flow

- ☰ expand on each item.
- **Matched:** Confirm / Not-this / Rate.
- **Unmatched extras:** "This is..." (manual match to grocery item) / Rate / Dismiss. Dismissed extras are flagged (not deleted) for learning.
- **Previous purchases** toggle with collapsible weeks. Purchase history endpoint at `GET /purchases`.

## Brand + violation enrichment

- `brand_ownership` table seeded from `data/brand_ownership.yaml` on startup (ON CONFLICT DO NOTHING). `brands.py` queries the DB, not YAML. Supports exact, substring, and reverse substring matching.
- `unknown_brands` table logs brand names with no parent company match, with frequency count. Admin endpoint at `/api/admin/unknown-brands`.
- `company_violations` table caches FDA openFDA food recall data per parent company. `violations.py` fetches on startup via `refresh_fda_data()`. Order page shows expandable details (total recalls, Class I count, most recent date) under the parent-company line.

## Behind the Label info

Account sheet section explains data sources (Open Food Facts for NOVA / Nutri-Score). Order page product cards have info toggles on badges.

## Nearby / comparison stores

`nearby_stores` table stores user-selected comparison stores. Selectable during onboarding step 4 and in Account → Online Store Integrations. `POST /stores/nearby` saves; `GET /stores/nearby` retrieves. Used by price comparison on Order page.
