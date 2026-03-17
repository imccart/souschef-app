"""Receipt parsing and order reconciliation."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

_CONFIG_DIR = Path.home() / ".souschef"
_ANTHROPIC_CREDS = _CONFIG_DIR / "anthropic_credentials.json"


def _get_client():
    """Get Anthropic client, using souschef config or env var."""
    import anthropic

    if _ANTHROPIC_CREDS.exists():
        with open(_ANTHROPIC_CREDS) as f:
            creds = json.load(f)
        return anthropic.Anthropic(api_key=creds["api_key"])
    return anthropic.Anthropic()  # falls back to ANTHROPIC_API_KEY env var


def _load_image_for_api(image_path: str) -> tuple[str, str]:
    """Load and prepare an image for the Claude API. Returns (base64_data, media_type)."""
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    suffix = path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    media_type = media_types.get(suffix)
    if not media_type:
        raise ValueError(f"Unsupported image format: {suffix}")

    raw = path.read_bytes()
    if len(raw) > 4 * 1024 * 1024:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(raw))
        max_dim = 2000
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        raw = buf.getvalue()
        media_type = "image/jpeg"
    return base64.standard_b64encode(raw).decode("utf-8"), media_type


def parse_receipt_image(image_path: str, grocery_names: list[str] | None = None) -> list[dict]:
    """Parse a receipt image using Claude Vision (two-step pipeline).

    Step 1: Pure OCR — extract raw text lines and prices from the image.
    Step 2: Text-only decode + match — decode abbreviations and match to grocery list.

    Returns list of {item, raw, qty, price, grocery_match?}.
    """
    image_data, media_type = _load_image_for_api(image_path)
    client = _get_client()

    # ── Step 1: Pure OCR — extract raw text exactly as printed ──
    ocr_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_data,
                    },
                },
                {
                    "type": "text",
                    "text": (
                        "Extract every ITEM LINE from this grocery receipt. Copy the text EXACTLY "
                        "as printed — do NOT decode abbreviations, do NOT guess what words mean.\n\n"
                        "ITEM lines have: abbreviated product name, then a price (like 3.67), "
                        "then usually a tax letter (B, T, or F).\n\n"
                        "SKIP these non-item lines:\n"
                        "- Lines starting with SC (savings/coupons)\n"
                        "- Lines like '1 @ 4/5.00' or weight lines ('2.70 lb @ 0.69')\n"
                        "- TAX, BALANCE DUE, TOTAL, KROGER PLUS, payment info, store header/footer\n"
                        "- 'PC' after a product name is a price code marker, include it in raw text\n\n"
                        "Return ONLY a JSON array (no markdown). Each object:\n"
                        '{"raw": "EXACT text as printed", "price": 3.67}\n\n'
                        "Example: if the receipt says 'NTHN ANG BF FRNKS    4.99 B', return:\n"
                        '{"raw": "NTHN ANG BF FRNKS", "price": 4.99}'
                    ),
                },
            ],
        }],
    )

    ocr_text = ocr_response.content[0].text
    ocr_items = _extract_json(ocr_text)
    if not isinstance(ocr_items, list) or not ocr_items:
        return []

    print(f"[receipt] OCR extracted {len(ocr_items)} lines", flush=True)
    for item in ocr_items:
        print(f"[receipt]   raw={item.get('raw', '?')!r}  price={item.get('price', '?')}", flush=True)

    # ── Step 2: Decode abbreviations + match to grocery list (text-only) ──
    raw_lines = [item.get("raw", "") for item in ocr_items]

    if grocery_names:
        decode_prompt = (
            "I have raw text from a Kroger grocery receipt and a grocery shopping list. "
            "For each receipt line, decode the abbreviation into the full product name, "
            "then decide if it matches something on my grocery list.\n\n"
            "Common Kroger abbreviations:\n"
            "- NTHN = Nathan's, BLPK = Ballpark, OM/OSCM/OSCT = Oscar Mayer\n"
            "- ST = Starbucks, TYFR = Taylor Farms, MICHELINA = Michelina's\n"
            "- BF = Beef, FRNKS = Franks, CHS = Cheese, BCN = Bacon\n"
            "- ORGNC = Organic, STO = Store brand, HNBRG = Hamburger\n"
            "- LNCH/LNCHBL = Lunchable, PBLE = portable, CRR = probably not 'carrot'\n"
            "- SHCS = Sliced Cheese, BNS = Buns\n\n"
            "MATCHING RULES — be strict:\n"
            "- Only match if the product IS the grocery item (same food category)\n"
            "- Hot dog franks → 'hot dogs'. Buns → 'hot dog buns'. Carrots → 'carrot'.\n"
            "- Lunchables are NOT carrot, NOT eggs, NOT any basic ingredient\n"
            "- Starbucks Egg Bites are NOT 'eggs' — they're a prepared snack\n"
            "- Hamburger Buns/Sliced Cheese are NOT 'hot dog buns'\n"
            "- Banana/Organic Bananas are NOT bread, NOT orange juice\n"
            "- Frozen meals do NOT match basic ingredients\n"
            "- A product that CONTAINS an ingredient is NOT a match (egg bites ≠ eggs)\n"
            "- When in doubt, do NOT match. Unmatched items are fine.\n\n"
            f"Receipt lines: {json.dumps(raw_lines)}\n"
            f"Grocery list: {json.dumps(grocery_names)}\n\n"
            "Return ONLY valid JSON (no markdown):\n"
            '{"items": [{"raw": "exact receipt text", "decoded": "full product name", '
            '"grocery_match": "grocery list item or null"}]}'
        )
    else:
        decode_prompt = (
            "Decode these Kroger grocery receipt abbreviations into full product names.\n\n"
            "Common abbreviations: NTHN=Nathan's, BLPK=Ballpark, OM/OSCM/OSCT=Oscar Mayer, "
            "ST=Starbucks, TYFR=Taylor Farms, BF=Beef, FRNKS=Franks, CHS=Cheese, "
            "BCN=Bacon, ORGNC=Organic, STO=Store brand, HNBRG=Hamburger.\n\n"
            f"Receipt lines: {json.dumps(raw_lines)}\n\n"
            "Return ONLY a JSON array (no markdown). Each object:\n"
            '{"raw": "exact receipt text", "decoded": "full product name"}'
        )

    decode_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": decode_prompt}],
    )

    decoded = _extract_json(decode_response.content[0].text)

    # Build price lookup from OCR step
    price_by_raw = {item.get("raw", ""): item.get("price") for item in ocr_items}

    if grocery_names and isinstance(decoded, dict):
        items = []
        for d in decoded.get("items", []):
            raw = d.get("raw", "")
            entry = {
                "item": d.get("decoded", raw),
                "raw": raw,
                "price": price_by_raw.get(raw, d.get("price")),
                "qty": 1,
            }
            match = d.get("grocery_match")
            if match and match != "null" and match.lower() != "null":
                entry["grocery_match"] = match
                print(f"[receipt]   matched: {raw!r} → {d.get('decoded', '?')!r} → {match!r}", flush=True)
            else:
                print(f"[receipt]   extra: {raw!r} → {d.get('decoded', '?')!r}", flush=True)
            items.append(entry)
        return items

    if isinstance(decoded, list):
        items = []
        for d in decoded:
            raw = d.get("raw", "")
            items.append({
                "item": d.get("decoded", raw),
                "raw": raw,
                "price": price_by_raw.get(raw, d.get("price")),
                "qty": 1,
            })
        return items

    return []


def parse_receipt_text(text: str) -> list[dict]:
    """Parse receipt email text using Claude. Returns list of {item, qty, price}."""
    client = _get_client()
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": (
                "Parse this grocery receipt/order confirmation. Extract every purchased item as JSON.\n"
                "Return ONLY a JSON array, no other text. Each object should have:\n"
                '- "item": the FULL interpreted product name. Decode receipt abbreviations into '
                "actual brand and product names (e.g., \"NTHN ANG BF FRNKS\" → \"Nathan's Angus Beef Franks\", "
                "\"BLPK BUN\" → \"Ballpark Buns\", \"KR CRTS CELLO\" → \"Kroger Carrots Cello Bag\"). "
                "Always include the brand if recognizable.\n"
                '- "qty": quantity (integer, default 1)\n'
                '- "price": total price for that line item (float)\n'
                '- "upc": the UPC/barcode number if present (string, omit if not)\n'
                "Ignore subtotals, tax, totals, savings lines, store info, and headers.\n"
                "If an item was substituted, include the substitution (what was actually received).\n\n"
                f"Receipt:\n{text}"
            ),
        }],
    )

    return _extract_json(message.content[0].text)


def parse_receipt_email(eml_path: str) -> list[dict]:
    """Parse a .eml file. Extracts text/HTML body and parses it."""
    import email
    from email import policy

    path = Path(eml_path)
    if not path.exists():
        raise FileNotFoundError(f"Email file not found: {eml_path}")

    with open(path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)

    # Try plain text first, fall back to HTML
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is None:
        raise ValueError("Could not extract email body")

    text = body.get_content()

    # Strip HTML tags if needed
    if "<html" in text.lower():
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)

    return parse_receipt_text(text)


def _extract_json(response_text: str) -> list[dict]:
    """Extract JSON array from Claude's response, handling markdown code blocks."""
    text = response_text.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        text = text.strip()
    return json.loads(text)


def parse_receipt_pdf(pdf_path: str) -> list[dict]:
    """Parse a Kroger PDF receipt. Extracts structured item data directly (no LLM needed).

    Falls back to Claude text parsing if the structured format isn't detected.
    Returns list of {item, qty, price, upc}.
    """
    import fitz  # PyMuPDF

    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    doc = fitz.open(str(path))
    text = "\n".join(page.get_text() for page in doc)
    doc.close()

    # Try structured Kroger format first (has UPC lines)
    items = _parse_kroger_structured(text)
    if items:
        return items

    # Fall back to Claude text parsing
    return parse_receipt_text(text)


def _parse_kroger_structured(text: str) -> list[dict]:
    """Parse Kroger's digital receipt format.

    Expected pattern per item:
      Product Name, size
      $price
      qty x $unit_price each
      [Item Coupon/Sale lines...]
      UPC: 0001234567890
    """
    items = []
    lines = text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # Look for UPC lines — then walk backwards to find the item
        upc_match = re.match(r"UPC:\s*(\d+)", line)
        if upc_match:
            upc = upc_match.group(1)

            # Walk backwards to find qty line and price line
            qty = 1
            price = None
            item_name = None

            for j in range(i - 1, max(i - 10, -1), -1):
                prev = lines[j].strip()
                if prev.startswith("Item Coupon/Sale:"):
                    continue

                # Qty line: "1 x $1.89 each" or "5 x $1.00 $1.50 each"
                qty_match = re.match(r"(\d+)\s*x\s*\$[\d.]+", prev)
                if qty_match:
                    qty = int(qty_match.group(1))
                    continue

                # Price line: "$5.00" alone
                price_match = re.match(r"^\$([\d.]+)$", prev)
                if price_match and price is None:
                    price = float(price_match.group(1))
                    continue

                # If we haven't found the item name yet and this isn't a known pattern,
                # it's the product name (first non-pattern line above the price)
                if item_name is None and prev and not prev.startswith("$"):
                    item_name = prev
                    break

            if item_name:
                items.append({
                    "item": item_name,
                    "qty": qty,
                    "price": price,
                    "upc": upc,
                })

        i += 1

    return items


def diff_order(submitted: list[dict], receipt_items: list[dict]) -> dict:
    """Compare submitted order against receipt. Returns categorized diff.

    Matches by UPC first (exact), then falls back to fuzzy name matching.

    Returns dict with:
      - matched: items in both
      - removed: items in submitted but not on receipt
      - added: items on receipt but not in submitted
    """
    def _norm(name: str) -> str:
        return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()

    # Index receipt items by UPC (if available) and track usage
    receipt_by_upc: dict[str, list[dict]] = {}
    for r in receipt_items:
        if r.get("upc"):
            receipt_by_upc.setdefault(r["upc"], []).append(r)

    receipt_remaining = list(receipt_items)  # items not yet matched
    matched = []
    removed = []

    # Pass 1: UPC match
    for sub in submitted:
        sub_upc = sub.get("upc", "")
        if sub_upc and sub_upc in receipt_by_upc and receipt_by_upc[sub_upc]:
            r_item = receipt_by_upc[sub_upc].pop(0)
            receipt_remaining.remove(r_item)
            matched.append({"submitted": sub, "receipt": r_item, "match": "upc"})
        else:
            removed.append(sub)

    # Pass 2: fuzzy name match for remaining unmatched submitted items
    still_removed = []
    for sub in removed:
        sub_norm = _norm(sub.get("product", sub.get("item", "")))
        sub_words = set(sub_norm.split())

        best_match = None
        best_score = 0

        for r_item in receipt_remaining:
            r_norm = _norm(r_item["item"])
            r_words = set(r_norm.split())
            overlap = len(sub_words & r_words)
            total = max(len(sub_words), len(r_words), 1)
            score = overlap / total
            if score > best_score:
                best_score = score
                best_match = r_item

        if best_match and best_score >= 0.4:
            receipt_remaining.remove(best_match)
            matched.append({"submitted": sub, "receipt": best_match, "match": "name"})
        else:
            still_removed.append(sub)

    # Anything on receipt not matched is an addition
    added = receipt_remaining

    return {
        "matched": matched,
        "removed": still_removed,
        "added": added,
    }


def diff_grocery_list(grocery_names: list[str], receipt_items: list[dict]) -> dict:
    """Match receipt items against grocery list item names.

    Uses fuzzy name matching since grocery names are simple ("avocado", "ground beef")
    and receipt items are full product descriptions.

    Returns dict with:
      - matched: list of {"grocery_name": str, "receipt": dict}
      - unmatched: receipt items that didn't match anything on the list
    """
    def _norm(name: str) -> str:
        return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()

    def _compact(name: str) -> str:
        """Strip everything but alphanumeric — collapses spaces, hyphens, etc."""
        return re.sub(r"[^a-z0-9]", "", name.lower())

    remaining_names = {_norm(n): n for n in grocery_names}
    matched = []
    unmatched = []

    for r_item in receipt_items:
        # Use decoded item name for fuzzy matching, fall back to raw
        r_text = r_item.get("item") or r_item.get("raw") or ""
        r_norm = _norm(r_text)
        r_words = set(r_norm.split())
        r_compact = _compact(r_text)

        best_name = None
        best_score = 0

        for g_norm, g_original in remaining_names.items():
            g_words = set(g_norm.split())
            g_compact = _compact(g_original)

            # Spaceless substring match: "lacroix" in "lacroixlimeflavored..."
            # Require grocery name covers at least 50% of the receipt text to avoid
            # "bread" matching "breadbutterwine"
            if g_compact and len(g_compact) >= 4 and g_compact in r_compact:
                coverage = len(g_compact) / len(r_compact)
                if coverage >= 0.5:
                    score = max(coverage, 0.6)
            elif r_compact and len(r_compact) >= 4 and r_compact in g_compact:
                coverage = len(r_compact) / len(g_compact)
                if coverage >= 0.5:
                    score = max(coverage, 0.6)
            # Word subset match: "ground beef" words in "Kroger 93/7 Ground Beef Tray"
            # Require at least 2 grocery words to avoid single-word false positives
            elif g_words and len(g_words) >= 2 and g_words.issubset(r_words):
                score = max(len(g_words) / len(r_words), 0.6)
            else:
                # Stem-aware overlap: "banana" matches "bananas"
                overlap = 0
                for gw in g_words:
                    for rw in r_words:
                        if gw.startswith(rw) or rw.startswith(gw):
                            overlap += 1
                            break
                # Use the larger word count as denominator to penalize partial matches
                # e.g. "eggs" (1 word) matching 1 of 5 receipt words = 0.2, not 1.0
                total = max(len(g_words), len(r_words), 1)
                score = overlap / total

            if score > best_score:
                best_score = score
                best_name = (g_norm, g_original)

        if best_name and best_score >= 0.6:
            remaining_names.pop(best_name[0])
            matched.append({"grocery_name": best_name[1], "receipt": r_item})
        else:
            unmatched.append(r_item)

    # AI-assisted matching for remaining unmatched receipt items against remaining grocery names
    if unmatched and remaining_names:
        try:
            ai_matches = _ai_match(list(remaining_names.values()), unmatched)
            for grocery_name, r_item in ai_matches:
                g_norm = _norm(grocery_name)
                if g_norm in remaining_names:
                    remaining_names.pop(g_norm)
                    matched.append({"grocery_name": grocery_name, "receipt": r_item})
                    unmatched = [u for u in unmatched if u is not r_item]
        except Exception:
            pass  # fall back to regex-only matches

    return {
        "matched": matched,
        "unmatched": unmatched,
    }


def _ai_match(grocery_names: list[str], receipt_items: list[dict]) -> list[tuple[str, dict]]:
    """Use Claude to match ambiguous receipt items to grocery list names.

    Receipt items may be raw abbreviations (e.g. 'NTHN ANG BF FRNKS') that need
    to be decoded to match against simple grocery names (e.g. 'hot dogs').
    """
    client = _get_client()
    receipt_descriptions = [r.get("raw") or r["item"] for r in receipt_items]

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": (
                "Match these abbreviated grocery receipt items to items on a grocery list. "
                "Receipt items use heavy store abbreviations (e.g. NTHN=Nathan's, BLPK=Ballpark, "
                "OSCM/OM=Oscar Mayer, ST=Starbucks, TYFR=Taylor Farms, MICHELINA=Michelina's, "
                "BF=Beef, FRNKS=Franks, CHS=Cheese, BCN=Bacon, ORGNC=Organic, STO=Store brand). "
                "A receipt item like 'NTHN ANG BF FRNKS' (Nathan's Angus Beef Franks) should match "
                "'hot dogs' on the grocery list.\n\n"
                f"Grocery list: {json.dumps(grocery_names)}\n"
                f"Receipt items: {json.dumps(receipt_descriptions)}\n\n"
                "Return ONLY a JSON array. Each object should have:\n"
                '- "grocery": the exact item name from the grocery list\n'
                '- "receipt": the exact item from the receipt items list\n'
                '- "decoded": your best guess at the full product name\n'
                "Only include CONFIDENT matches. If unsure, leave it out. "
                "Return [] if no matches."
            ),
        }],
    )

    pairs = _extract_json(message.content[0].text)
    if not pairs:
        return []

    # Map receipt descriptions back to full receipt item dicts
    receipt_by_name = {}
    for r in receipt_items:
        key = r.get("raw") or r["item"]
        receipt_by_name.setdefault(key, r)

    results = []
    for pair in pairs:
        g_name = pair.get("grocery", "")
        r_name = pair.get("receipt", "")
        if g_name in grocery_names and r_name in receipt_by_name:
            # Store the decoded name in the receipt item for display
            r_item = receipt_by_name[r_name]
            decoded = pair.get("decoded", "")
            if decoded:
                r_item["item"] = decoded
            results.append((g_name, r_item))

    return results
