"""Kroger API integration: product search, location lookup, cart, token management."""

from __future__ import annotations

import json
import os
import time
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from sqlalchemy import text

from souschef.database import DictConnection

_CONFIG_DIR = Path.home() / ".souschef"
_CREDS_FILE = _CONFIG_DIR / "kroger_credentials.json"
_USER_TOKEN_FILE = _CONFIG_DIR / "kroger_user_token.json"

BASE_URL = "https://api.kroger.com/v1"
REDIRECT_URI = "http://localhost:8000/callback"

# Cached tokens
_token: str | None = None
_token_expires: float = 0.0


@dataclass
class KrogerProduct:
    product_id: str
    upc: str
    description: str
    brand: str
    size: str
    price: float | None = None
    promo_price: float | None = None
    in_stock: bool = True
    curbside: bool = False
    nova_group: int | None = None  # 1=unprocessed, 4=ultra-processed
    nutriscore: str = ""  # a-e
    categories: list[str] | None = None
    image_url: str = ""
    rating: int = 0  # 1=thumbs up, -1=thumbs down, 0=neutral


def _load_credentials() -> dict:
    # Prefer env vars (Railway), fall back to local credentials file
    client_id = os.environ.get("KROGER_CLIENT_ID", "")
    client_secret = os.environ.get("KROGER_CLIENT_SECRET", "")
    if client_id and client_secret:
        return {"client_id": client_id, "client_secret": client_secret}
    if not _CREDS_FILE.exists():
        raise FileNotFoundError(
            f"Kroger credentials not found at {_CREDS_FILE}\n"
            "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET env vars, or save credentials as:\n"
            f"  {_CREDS_FILE}"
        )
    with open(_CREDS_FILE) as f:
        return json.load(f)


def _get_token() -> str:
    global _token, _token_expires
    if _token and time.time() < _token_expires:
        return _token

    creds = _load_credentials()
    resp = requests.post(
        f"{BASE_URL}/connect/oauth2/token",
        data={"grant_type": "client_credentials", "scope": "product.compact"},
        auth=(creds["client_id"], creds["client_secret"]),
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    _token = data["access_token"]
    _token_expires = time.time() + data.get("expires_in", 1800) - 60
    return _token


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_get_token()}",
        "Accept": "application/json",
    }


def get_location_id() -> str:
    """Legacy fallback — prefer passing location_id explicitly."""
    creds = _load_credentials()
    loc = creds.get("location_id")
    if not loc:
        raise ValueError("No Kroger location_id configured.")
    return loc


def search_kroger_locations(zip_code: str, limit: int = 5) -> list[dict]:
    """Search for Kroger store locations near a zip code."""
    resp = requests.get(
        f"{BASE_URL}/locations",
        params={
            "filter.zipCode.near": zip_code,
            "filter.limit": limit,
            "filter.chain": "Kroger",
        },
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    results = []
    for loc in resp.json().get("data", []):
        addr = loc.get("address", {})
        results.append({
            "location_id": loc.get("locationId", ""),
            "name": loc.get("name", ""),
            "address": f"{addr.get('addressLine1', '')}, {addr.get('city', '')} {addr.get('state', '')} {addr.get('zipCode', '')}",
        })
    return results


def _lookup_food_score(product_name: str, brand: str) -> tuple[int | None, str]:
    """Look up NOVA group and Nutri-Score from Open Food Facts by product name."""
    # Use just brand + short product name for better matching
    # Kroger descriptions are verbose; trim to essentials
    short_name = product_name.split(",")[0].split(" - ")[0].strip()
    query = f"{brand} {short_name}" if brand else short_name
    try:
        resp = requests.get(
            "https://world.openfoodfacts.net/cgi/search.pl",
            params={
                "search_terms": query,
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": 1,
                "countries_tags": "united-states",
            },
            timeout=5,
        )
        products = resp.json().get("products", [])
        if products:
            p = products[0]
            nova = p.get("nova_group")
            nutri = p.get("nutriscore_grade", "")
            if nova is not None:
                nova = int(nova)
            return nova, nutri if nutri != "unknown" else ""
    except Exception:
        pass
    return None, ""


def _extract_image_url(item: dict) -> str:
    """Extract a product image URL from Kroger API response. Prefers front/medium."""
    for img in item.get("images", []):
        if img.get("perspective", "").lower() == "front":
            sizes = {s.get("size", ""): s.get("url", "") for s in img.get("sizes", [])}
            return sizes.get("medium") or sizes.get("small") or sizes.get("large", "")
    return ""


def _parse_search_response(data: dict, fulfillment: str = "curbside") -> list[KrogerProduct]:
    """Parse Kroger search API response into KrogerProduct list."""
    products = []
    for item in data.get("data", []):
        sub = item.get("items", [{}])[0] if item.get("items") else {}
        price_info = sub.get("price", {})
        ff = sub.get("fulfillment", {})
        # Deduplicate categories
        raw_cats = item.get("categories", [])
        cats = list(dict.fromkeys(raw_cats))  # preserve order, remove dupes
        in_stock = ff.get(fulfillment, False) if fulfillment == "delivery" else (ff.get("curbside", False) or ff.get("inStore", False))
        products.append(KrogerProduct(
            product_id=item.get("productId", ""),
            upc=item.get("upc", ""),
            description=item.get("description", ""),
            brand=item.get("brand", ""),
            size=sub.get("size", ""),
            price=price_info.get("regular"),
            promo_price=price_info.get("promo"),
            in_stock=in_stock,
            curbside=ff.get("curbside", False),
            categories=cats,
            image_url=_extract_image_url(item),
        ))
    return products


def search_products_fast(term: str, limit: int = 5, start: int = 1,
                         require_category: str | None = None,
                         exclude_keywords: list[str] | None = None,
                         fulfillment: str = "curbside",
                         location_id: str | None = None) -> list[KrogerProduct]:
    """Fast catalog search — returns products with whatever prices the search API gives.
    No backfill, no retries. Use fill_prices() on a subset for reliable pricing.
    If require_category is set, only returns products whose Kroger categories include it.
    If exclude_keywords is set, drops products whose description contains any of them.
    fulfillment: 'curbside' (pickup) or 'delivery'."""
    if not location_id:
        location_id = get_location_id()
    resp = requests.get(
        f"{BASE_URL}/products",
        params={
            "filter.term": term,
            "filter.locationId": location_id,
            "filter.limit": limit,
            "filter.fulfillment": fulfillment,
            "filter.start": start,
        },
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    if require_category or exclude_keywords:
        products = []
        exc = [kw.lower() for kw in (exclude_keywords or [])]
        for item in resp.json().get("data", []):
            if require_category:
                cats = [c.lower() for c in item.get("categories", [])]
                if require_category.lower() not in cats:
                    continue
            desc_lower = item.get("description", "").lower()
            if any(kw in desc_lower for kw in exc):
                continue
            sub = item.get("items", [{}])[0] if item.get("items") else {}
            price_info = sub.get("price", {})
            ff = sub.get("fulfillment", {})
            raw_cats = item.get("categories", [])
            cats_dedup = list(dict.fromkeys(raw_cats))
            in_stock = ff.get(fulfillment, False) if fulfillment == "delivery" else (ff.get("curbside", False) or ff.get("inStore", False))
            products.append(KrogerProduct(
                product_id=item.get("productId", ""),
                upc=item.get("upc", ""),
                description=item.get("description", ""),
                brand=item.get("brand", ""),
                size=sub.get("size", ""),
                price=price_info.get("regular"),
                promo_price=price_info.get("promo"),
                in_stock=in_stock,
                curbside=ff.get("curbside", False),
                image_url=_extract_image_url(item),
                categories=cats_dedup,
            ))
        return products
    return _parse_search_response(resp.json(), fulfillment)


def fill_prices(products: list[KrogerProduct], location_id: str | None = None) -> None:
    """Fill in missing prices for a list of products via individual lookups."""
    if not location_id:
        location_id = get_location_id()
    missing = [p for p in products if p.price is None and p.product_id]
    if not missing:
        return
    price_data = _get_product_prices([p.product_id for p in missing], location_id)
    for p in missing:
        info = price_data.get(p.product_id, {})
        if info.get("regular") is not None:
            p.price = info["regular"]
        if info.get("promo") is not None:
            p.promo_price = info["promo"]
        if info.get("curbside") is not None:
            p.curbside = info["curbside"]
            p.in_stock = info["curbside"] or info.get("in_store", False)



def _get_product_prices(product_ids: list[str], location_id: str) -> dict[str, dict]:
    """Fetch prices for multiple products with retry + backoff.

    Returns {product_id: {"regular": float|None, "promo": float|None}}.
    """
    headers = _headers()
    results: dict[str, dict] = {}

    def _fetch_price(pid: str) -> dict:
        for attempt in range(3):
            try:
                resp = requests.get(
                    f"{BASE_URL}/products/{pid}",
                    params={"filter.locationId": location_id},
                    headers=headers,
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json().get("data", {})
                    sub = data.get("items", [{}])[0] if data.get("items") else {}
                    price_info = sub.get("price", {})
                    fulfillment = sub.get("fulfillment", {})
                    regular = price_info.get("regular")
                    if regular is not None:
                        return {
                            "regular": regular,
                            "promo": price_info.get("promo"),
                            "curbside": fulfillment.get("curbside", False),
                            "in_store": fulfillment.get("inStore", False),
                        }
                if resp.status_code == 429:
                    time.sleep(1.0 * (attempt + 1))
                    continue
            except Exception:
                pass
            time.sleep(0.3 * (attempt + 1))
        return {"regular": None, "promo": None, "curbside": None, "in_store": None}

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pid: pool.submit(_fetch_price, pid) for pid in product_ids}
        for pid, future in futures.items():
            results[pid] = future.result()

    return results


def get_preferred_products(conn: DictConnection, user_id: str, search_term: str, limit: int = 3) -> list[KrogerProduct]:
    """Get recent preferred products for a search term, ranked by recency then selection > receipt.

    Returns up to `limit` distinct products from the last 3 orders.
    """
    rows = conn.execute(
        text("""SELECT upc, product_description, size, source, last_picked, order_id
           FROM product_preferences
           WHERE user_id = :user_id AND search_term = :search_term
           ORDER BY last_picked DESC"""),
        {"user_id": user_id, "search_term": search_term.lower()},
    ).fetchall()
    if not rows:
        return []

    # Deduplicate by UPC, keeping most recent entry per product
    seen_upcs: set[str] = set()
    unique: list[dict] = []
    for r in rows:
        if r["upc"] not in seen_upcs:
            seen_upcs.add(r["upc"])
            d = dict(r)
            # Look up rating from product_ratings
            ratings = get_product_ratings(conn, d["upc"], user_id)
            d["rating"] = ratings["your_rating"]
            unique.append(d)

    # Sort: thumbs-up first, then neutral, then thumbs-down; within each tier: recency, selection > receipt
    source_rank = {"picked": 0, "receipt": 1}
    unique.sort(key=lambda r: (
        -(r.get("rating", 0)),  # thumbs up (1) first, neutral (0), thumbs down (-1) last
        r["last_picked"],
        -source_rank.get(r["source"], 2),
    ), reverse=True)

    results = []
    for r in unique[:limit]:
        p = KrogerProduct(
            product_id="",
            upc=r["upc"],
            description=r["product_description"],
            brand="",
            size=r["size"],
        )
        p.rating = r.get("rating", 0)
        results.append(p)
    return results


def get_preferred_product(conn: DictConnection, user_id: str, search_term: str) -> KrogerProduct | None:
    """Get the top preferred product for a search term. Convenience wrapper."""
    prefs = get_preferred_products(conn, user_id, search_term, limit=1)
    return prefs[0] if prefs else None


def save_preference(conn: DictConnection, user_id: str, search_term: str, product: KrogerProduct,
                    source: str = "picked", order_id: str = "") -> None:
    """Save or update a product preference for a search term."""
    conn.execute(
        text("""INSERT INTO product_preferences (user_id, search_term, upc, product_description, size, source, order_id)
           VALUES (:user_id, :search_term, :upc, :product_description, :size, :source, :order_id)
           ON CONFLICT(search_term, upc) DO UPDATE SET
               product_description = excluded.product_description,
               size = excluded.size,
               times_picked = product_preferences.times_picked + 1,
               last_picked = CURRENT_TIMESTAMP,
               source = excluded.source,
               order_id = excluded.order_id"""),
        {"user_id": user_id, "search_term": search_term.lower(), "upc": product.upc,
         "product_description": product.description, "size": product.size,
         "source": source, "order_id": order_id},
    )
    conn.commit()


def rate_product(conn: DictConnection, upc: str, rating: int,
                 product_description: str = "", user_id: str = "default") -> None:
    """Rate a product: 1 = thumbs up, -1 = thumbs down, 0 = remove rating."""
    if rating == 0:
        conn.execute(
            text("DELETE FROM product_ratings WHERE user_id = :user_id AND upc = :upc"),
            {"user_id": user_id, "upc": upc},
        )
    else:
        conn.execute(
            text("""INSERT INTO product_ratings (user_id, upc, product_description, rating)
               VALUES (:user_id, :upc, :product_description, :rating)
               ON CONFLICT(user_id, upc) DO UPDATE SET
                   rating = excluded.rating,
                   updated_at = CURRENT_TIMESTAMP"""),
            {"user_id": user_id, "upc": upc,
             "product_description": product_description, "rating": rating},
        )
    conn.commit()


def get_product_ratings(conn: DictConnection, upc: str, user_id: str = "default") -> dict:
    """Get rating summary for a product. Returns {your_rating, up_count, down_count}."""
    your = conn.execute(
        text("SELECT rating FROM product_ratings WHERE user_id = :user_id AND upc = :upc"),
        {"user_id": user_id, "upc": upc},
    ).fetchone()

    counts = conn.execute(
        text("""SELECT
               SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS up_count,
               SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS down_count
           FROM product_ratings WHERE upc = :upc"""),
        {"upc": upc},
    ).fetchone()

    return {
        "your_rating": your["rating"] if your else 0,
        "up_count": counts["up_count"] or 0,
        "down_count": counts["down_count"] or 0,
    }


def get_product_history(conn: DictConnection, search_term: str,
                        user_id: str = "default") -> list[dict]:
    """Get products for a search term, with ratings from product_ratings.

    If any receipt-confirmed products exist, only show those (ground truth).
    Otherwise fall back to selection history.
    """
    # Check if any receipt-confirmed products exist
    has_receipt = conn.execute(
        text("SELECT 1 FROM product_preferences WHERE user_id = :user_id AND search_term = :search_term AND source = 'receipt' LIMIT 1"),
        {"user_id": user_id, "search_term": search_term.lower()},
    ).fetchone()

    if has_receipt:
        rows = conn.execute(
            text("""SELECT p.upc, p.product_description, p.size, p.times_picked, p.last_picked, p.source
               FROM product_preferences p
               WHERE p.user_id = :user_id AND p.search_term = :search_term AND p.source = 'receipt'
               ORDER BY p.last_picked DESC"""),
            {"user_id": user_id, "search_term": search_term.lower()},
        ).fetchall()
    else:
        rows = conn.execute(
            text("""SELECT p.upc, p.product_description, p.size, p.times_picked, p.last_picked, p.source
               FROM product_preferences p
               WHERE p.user_id = :user_id AND p.search_term = :search_term
               ORDER BY p.last_picked DESC"""),
            {"user_id": user_id, "search_term": search_term.lower()},
        ).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        ratings = get_product_ratings(conn, d["upc"], user_id)
        d.update(ratings)
        results.append(d)
    return results



# ── User OAuth (for cart operations) ─────────────────────


def _get_user_token() -> str:
    """Get a user-level access token, refreshing or authorizing as needed."""
    creds = _load_credentials()

    # Try loading cached user token
    if _USER_TOKEN_FILE.exists():
        with open(_USER_TOKEN_FILE) as f:
            token_data = json.load(f)

        # Check if still valid
        if time.time() < token_data.get("expires_at", 0):
            return token_data["access_token"]

        # Try refresh
        if token_data.get("refresh_token"):
            resp = requests.post(
                f"{BASE_URL}/connect/oauth2/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": token_data["refresh_token"],
                },
                auth=(creds["client_id"], creds["client_secret"]),
                timeout=15,
            )
            if resp.status_code == 200:
                new_data = resp.json()
                new_data["expires_at"] = time.time() + new_data.get("expires_in", 1800) - 60
                _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
                with open(_USER_TOKEN_FILE, "w") as f:
                    json.dump(new_data, f, indent=2)
                return new_data["access_token"]

    # Need fresh authorization
    return _authorize_user(creds)


def _authorize_user(creds: dict) -> str:
    """Run the OAuth authorization code flow: open browser, capture callback."""
    auth_url = (
        f"{BASE_URL}/connect/oauth2/authorize"
        f"?scope=cart.basic%3Awrite"
        f"&response_type=code"
        f"&client_id={creds['client_id']}"
        f"&redirect_uri={REDIRECT_URI}"
    )

    # Capture the auth code via a temporary local server
    auth_code = None

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            nonlocal auth_code
            query = parse_qs(urlparse(self.path).query)
            auth_code = query.get("code", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html><body><h2>Kroger login successful!</h2>"
                             b"<p>You can close this tab.</p></body></html>")

        def log_message(self, format, *args):
            pass  # suppress server logs

    server = HTTPServer(("localhost", 8000), CallbackHandler)
    webbrowser.open(auth_url)
    server.handle_request()  # wait for the single callback
    server.server_close()

    if not auth_code:
        raise RuntimeError("Kroger authorization failed — no auth code received.")

    # Exchange code for token
    resp = requests.post(
        f"{BASE_URL}/connect/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": REDIRECT_URI,
        },
        auth=(creds["client_id"], creds["client_secret"]),
        timeout=15,
    )
    resp.raise_for_status()
    token_data = resp.json()
    token_data["expires_at"] = time.time() + token_data.get("expires_in", 1800) - 60

    _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(_USER_TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)

    return token_data["access_token"]


def add_to_cart(items: list[dict], token: str | None = None) -> bool:
    """Add items to the user's Kroger cart. Each item needs a 'upc' key.

    If token is provided, uses it directly. Otherwise falls back to
    file-based user token (CLI flow).
    """
    if token is None:
        token = _get_user_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    cart_items = [{"upc": item["upc"], "quantity": item.get("qty", 1)} for item in items]
    resp = requests.put(
        f"{BASE_URL}/cart/add",
        json={"items": cart_items},
        headers=headers,
        timeout=15,
    )
    resp.raise_for_status()
    return True


# ── DB-backed User OAuth (for web) ────────────────────────


def get_kroger_auth_url(redirect_uri: str, state: str) -> str:
    """Build the Kroger OAuth authorization URL."""
    creds = _load_credentials()
    return (
        f"{BASE_URL}/connect/oauth2/authorize"
        f"?scope=cart.basic%3Awrite"
        f"&response_type=code"
        f"&client_id={creds['client_id']}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )


def exchange_code_for_token(code: str, redirect_uri: str) -> dict:
    """Exchange an OAuth authorization code for tokens. Returns token data dict."""
    creds = _load_credentials()
    resp = requests.post(
        f"{BASE_URL}/connect/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
        auth=(creds["client_id"], creds["client_secret"]),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def refresh_kroger_token(refresh_token: str) -> dict:
    """Refresh a Kroger OAuth token. Returns new token data dict."""
    creds = _load_credentials()
    resp = requests.post(
        f"{BASE_URL}/connect/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        auth=(creds["client_id"], creds["client_secret"]),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_user_token_from_db(conn: DictConnection, user_id: str) -> str | None:
    """Get a valid Kroger user token from DB, refreshing if needed.

    Returns the access token string, or None if not connected.
    """
    row = conn.execute(
        text("SELECT access_token, refresh_token, expires_at FROM user_kroger_tokens WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchone()
    if not row:
        return None

    # Check if still valid (expires_at is ISO timestamp)
    from datetime import datetime, timezone
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if now < expires:
            return row["access_token"]
    except (ValueError, TypeError):
        pass

    # Try refresh
    try:
        new_data = refresh_kroger_token(row["refresh_token"])
        expires_in = new_data.get("expires_in", 1800)
        from datetime import timedelta
        new_expires = datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)
        conn.execute(
            text("""UPDATE user_kroger_tokens
                SET access_token = :at, refresh_token = :rt, expires_at = :exp, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = :uid"""),
            {
                "at": new_data["access_token"],
                "rt": new_data.get("refresh_token", row["refresh_token"]),
                "exp": new_expires.isoformat(),
                "uid": user_id,
            },
        )
        conn.commit()
        return new_data["access_token"]
    except Exception:
        # Refresh failed — token is invalid, remove it
        conn.execute(
            text("DELETE FROM user_kroger_tokens WHERE user_id = :uid"),
            {"uid": user_id},
        )
        conn.commit()
        return None
