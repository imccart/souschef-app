"""FastAPI application for mealrunner web frontend."""

from __future__ import annotations

from pathlib import Path

import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text

import sys

from mealrunner.db import ensure_db_initialized
from mealrunner.web.api import router as api_router
from mealrunner.web.auth import (
    _is_public,
    get_user_id_from_request,
    is_email_allowed,
    find_or_create_user,
    create_magic_link,
    send_magic_link_email,
    verify_magic_link,
    create_session,
    set_session_cookie,
    clear_session_cookie,
    delete_session,
    get_user_from_session,
    get_household_owner_id,
    ensure_household,
    SESSION_COOKIE,
    BASE_URL,
)
from mealrunner.database import (
    get_connection,
    get_request_connection,
    set_request_connection,
    reset_request_connection,
)

_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"

_CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173"
).split(",")


# ── Connection Middleware ─────────────────────────────────


class ConnectionMiddleware(BaseHTTPMiddleware):
    """Open a DB connection for each request and close it when done."""

    async def dispatch(self, request: Request, call_next):
        conn = get_connection()
        token = set_request_connection(conn)
        try:
            response = await call_next(request)
            return response
        finally:
            try:
                conn.close()
            except Exception:
                pass
            reset_request_connection(token)


# ── Auth Middleware ───────────────────────────────────────


class AuthMiddleware(BaseHTTPMiddleware):
    """Global auth check. Rejects unauthenticated API requests with 401."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Public paths and non-API paths (static files, SPA) don't need auth
        if _is_public(path) or not path.startswith("/api/"):
            return await call_next(request)

        # Check session
        user_id = get_user_id_from_request(request)
        if not user_id:
            return JSONResponse({"error": "Not authenticated"}, status_code=401)

        # Resolve to household owner's user_id so all members share data
        conn = get_request_connection()
        try:
            effective_user_id = get_household_owner_id(conn, user_id)
        except Exception as e:
            print(f"[auth] Household resolution failed for {user_id}: {e}")
            effective_user_id = user_id  # fall back to own user_id

        # Attach user_id to request state for endpoints to use
        request.state.user_id = effective_user_id
        request.state.real_user_id = user_id  # actual logged-in user (for feedback, household mgmt)
        return await call_next(request)


app = FastAPI(title="MealRunner")

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        print("[startup] Initializing database...", flush=True)
        sys.stdout.flush()
        ensure_db_initialized()
        print("[startup] Database initialized successfully", flush=True)
        sys.stdout.flush()
    except Exception as e:
        print(f"[startup] FATAL: {type(e).__name__}: {e}", flush=True)
        import traceback
        traceback.print_exc(file=sys.stdout)
        sys.stdout.flush()
        raise

app.add_middleware(AuthMiddleware)
app.add_middleware(ConnectionMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)

# Serve React static assets if the build exists
if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="react-assets")

# Serve root-level static files (favicon, manifest, icons)
_ROOT_STATIC = ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.json", "sw.js"]
for _fname in _ROOT_STATIC:
    _fpath = _FRONTEND_DIST / _fname
    if _fpath.exists():
        @app.get(f"/{_fname}", include_in_schema=False)
        async def _serve_static(path=str(_fpath)):
            return FileResponse(path)


# Serve legal pages (must be before SPA catch-all)
@app.get("/app/terms", include_in_schema=False)
async def serve_terms():
    f = _FRONTEND_DIST / "terms.html"
    if f.exists():
        return FileResponse(str(f), media_type="text/html")
    return JSONResponse({"error": "Not found"}, status_code=404)

@app.get("/app/privacy", include_in_schema=False)
async def serve_privacy():
    f = _FRONTEND_DIST / "privacy.html"
    if f.exists():
        return FileResponse(str(f), media_type="text/html")
    return JSONResponse({"error": "Not found"}, status_code=404)


# ── Health Check ──────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check for Railway / load balancers."""
    try:
        conn = get_request_connection()
        conn.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        return JSONResponse({"status": "error"}, status_code=503)



def _process_household_invite(conn, user_id: str, email: str) -> None:
    """Check for pending household invites and join if found."""
    invite = conn.execute(
        text("""SELECT household_id FROM household_invites
                WHERE LOWER(email) = LOWER(:email) AND status = 'pending'
                ORDER BY created_at DESC LIMIT 1"""),
        {"email": email},
    ).fetchone()
    if not invite:
        return

    target_hh = invite["household_id"]

    # Find the owner of the target household
    owner = conn.execute(
        text("SELECT user_id FROM household_members WHERE household_id = :hh_id AND role = 'owner'"),
        {"hh_id": target_hh},
    ).fetchone()
    if not owner:
        return

    owner_user_id = owner["user_id"]

    # Reassign all of this user's data to the household owner
    tables = [
        "meals", "grocery_trips", "regulars", "pantry",
        "product_preferences", "learning_dismissed",
        "meal_item_overrides", "settings", "recipes",
    ]
    for table in tables:
        try:
            conn.execute(
                text(f"UPDATE {table} SET user_id = :owner_id WHERE user_id = :user_id"),
                {"owner_id": owner_user_id, "user_id": user_id},
            )
        except Exception as e:
            print(f"[household] Failed to migrate {table}: {e}")

    # Remove existing household membership and join the new one
    conn.execute(
        text("DELETE FROM household_members WHERE user_id = :user_id"),
        {"user_id": user_id},
    )
    conn.execute(
        text("""INSERT INTO household_members (household_id, user_id, role)
           VALUES (:hh_id, :user_id, 'member')"""),
        {"hh_id": target_hh, "user_id": user_id},
    )

    # Mark invite as accepted
    conn.execute(
        text("""UPDATE household_invites SET status = 'accepted'
           WHERE household_id = :hh_id AND LOWER(email) = LOWER(:email) AND status = 'pending'"""),
        {"hh_id": target_hh, "email": email},
    )
    conn.commit()
    print(f"[auth] User {user_id} joined household {target_hh} (owner: {owner_user_id})")


def _claim_default_data(conn, user_id: str) -> None:
    """One-time: reassign orphaned 'default' user data to a real user."""
    # Only run if there's actually default data to claim
    row = conn.execute(
        text("SELECT COUNT(*) AS n FROM meals WHERE user_id = 'default'"),
    ).fetchone()
    if not row or row["n"] == 0:
        return

    tables = [
        "meals", "grocery_trips", "regulars", "pantry",
        "product_preferences", "learning_dismissed",
        "meal_item_overrides", "settings", "recipes",
    ]
    for table in tables:
        try:
            conn.execute(
                text(f"UPDATE {table} SET user_id = :uid WHERE user_id = 'default'"),
                {"uid": user_id},
            )
        except Exception as e:
            print(f"[auth] Failed to claim {table}: {e}")
    conn.commit()
    print(f"[auth] Claimed default user data for {user_id}")


# ── Auth Endpoints ───────────────────────────────────────

@app.post("/api/auth/login")
async def auth_login(body: dict):
    """Send a magic link to the given email (if whitelisted)."""
    from mealrunner.web.api import _check_throttle

    email = body.get("email", "").strip().lower()
    if not email:
        return {"ok": False, "error": "Email required"}

    # Rate limit: max 3 attempts per email per 15 minutes (DB-backed)
    throttled = _check_throttle(email, "magic_link", 3, 900)
    if throttled:
        return {"ok": False, "error": "Too many login attempts. Please try again later."}

    conn = get_request_connection()
    if not is_email_allowed(conn, email):
        # Save to waitlist for future approval
        conn.execute(
            text("INSERT INTO waitlist (email) VALUES (:email) ON CONFLICT DO NOTHING"),
            {"email": email},
        )
        conn.commit()
        return {"ok": False, "waitlist": True}

    user_id = find_or_create_user(conn, email)
    token = create_magic_link(conn, user_id)
    send_magic_link_email(email, token)

    return {"ok": True, "sent": True}


@app.get("/api/auth/google-client-id")
async def google_client_id():
    """Return the Google OAuth client ID for the frontend."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    return {"client_id": client_id}


@app.post("/api/auth/google")
async def auth_google(body: dict):
    """Verify a Google ID token and create a session."""
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    credential = body.get("credential")
    if not credential:
        return JSONResponse({"error": "Missing credential"}, status_code=400)

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        return JSONResponse({"error": "Google auth not configured"}, status_code=500)

    try:
        idinfo = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except ValueError:
        return JSONResponse({"error": "Invalid token"}, status_code=401)

    email = idinfo.get("email", "").lower()
    if not idinfo.get("email_verified") or not email:
        return JSONResponse({"error": "Email not verified"}, status_code=401)

    conn = get_request_connection()
    if not is_email_allowed(conn, email):
        conn.execute(
            text("INSERT INTO waitlist (email) VALUES (:email) ON CONFLICT DO NOTHING"),
            {"email": email},
        )
        conn.commit()
        return {"ok": False, "waitlist": True}

    user_id = find_or_create_user(conn, email)
    _claim_default_data(conn, user_id)
    ensure_household(conn, user_id)
    session_id = create_session(conn, user_id)

    response = JSONResponse({"ok": True})
    set_session_cookie(response, session_id)
    return response


@app.get("/api/auth/verify")
async def auth_verify(token: str):
    """Verify a magic link token, create session, redirect to app."""
    conn = get_request_connection()
    user_id = verify_magic_link(conn, token)
    if not user_id:
        return RedirectResponse(url="/app?auth=expired", status_code=302)

    # One-time: claim orphaned 'default' user data for the first real user
    _claim_default_data(conn, user_id)

    # Ensure user has a household (creates one if needed)
    # Note: pending household invites are handled via UI prompt, not auto-accepted
    ensure_household(conn, user_id)

    session_id = create_session(conn, user_id)

    response = RedirectResponse(url="/app", status_code=302)
    set_session_cookie(response, session_id)
    return response


@app.get("/api/auth/me")
async def auth_me(request: Request):
    """Return current user info, or 401 if not authenticated."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    conn = get_request_connection()
    user_id = get_user_from_session(conn, session_id)
    if not user_id:
        return JSONResponse({"error": "Session expired"}, status_code=401)

    user = conn.execute(
        text("SELECT id, email, display_name, first_name, last_name, tos_accepted_at, tos_version FROM users WHERE id = :id"),
        {"id": user_id},
    ).fetchone()

    if not user:
        return JSONResponse({"error": "User not found"}, status_code=401)

    home_zip_row = conn.execute(
        text("SELECT value FROM settings WHERE user_id = :uid AND key = 'home_zip'"),
        {"uid": user_id},
    ).fetchone()
    return {
        "id": user["id"], "email": user["email"], "display_name": user["display_name"],
        "first_name": user["first_name"], "last_name": user["last_name"],
        "tos_accepted_at": user["tos_accepted_at"], "tos_version": user["tos_version"],
        "home_zip": home_zip_row["value"] if home_zip_row else "",
    }


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """Clear the session."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        conn = get_request_connection()
        delete_session(conn, session_id)

    response = JSONResponse({"ok": True})
    clear_session_cookie(response)
    return response


# ── Kroger OAuth ──────────────────────────────────────────

@app.get("/api/kroger/status")
async def kroger_status(request: Request):
    """Check if the current user has a linked Kroger account."""
    user_id = request.state.real_user_id
    conn = get_request_connection()
    row = conn.execute(
        text("SELECT expires_at FROM user_kroger_tokens WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchone()
    return {"connected": bool(row)}


@app.get("/api/kroger/connect")
async def kroger_connect(request: Request):
    """Start Kroger OAuth flow. Returns auth URL for frontend to open."""
    import secrets as _secrets
    from mealrunner.kroger import get_kroger_auth_url

    user_id = request.state.real_user_id
    state = _secrets.token_urlsafe(32)

    # Store state → user_id mapping in session-like table (reuse settings)
    conn = get_request_connection()
    try:
        conn.execute(
            text("""INSERT INTO settings (user_id, key, value)
                VALUES (:uid, :key, :val)
                ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"""),
            {"uid": user_id, "key": "kroger_oauth_state", "val": state},
        )
        conn.commit()
    except Exception:
        return JSONResponse({"error": "Kroger not configured"}, status_code=503)

    redirect_uri = f"{BASE_URL}/api/kroger/callback"
    try:
        auth_url = get_kroger_auth_url(redirect_uri, state)
    except FileNotFoundError:
        return JSONResponse({"error": "Kroger not configured"}, status_code=503)
    return {"url": auth_url}


@app.get("/api/kroger/callback")
async def kroger_callback(code: str = "", state: str = "", error: str = ""):
    """Handle Kroger OAuth callback — exchange code for tokens, store in DB."""
    if error or not code:
        return RedirectResponse(url="/app?kroger=error", status_code=302)

    from mealrunner.kroger import exchange_code_for_token
    from datetime import datetime, timedelta, timezone

    conn = get_request_connection()
    try:
        # Look up which user initiated this flow via state
        row = conn.execute(
            text("SELECT user_id FROM settings WHERE key = 'kroger_oauth_state' AND value = :state"),
            {"state": state},
        ).fetchone()
        if not row:
            return RedirectResponse(url="/app?kroger=error", status_code=302)

        user_id = row["user_id"]

        # Exchange code for tokens
        redirect_uri = f"{BASE_URL}/api/kroger/callback"
        token_data = exchange_code_for_token(code, redirect_uri)

        # Clean up state only after successful exchange
        conn.execute(
            text("DELETE FROM settings WHERE user_id = :uid AND key = 'kroger_oauth_state'"),
            {"uid": user_id},
        )

        expires_in = token_data.get("expires_in", 1800)
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in - 60)).isoformat()

        # Store tokens (encrypted)
        from mealrunner.kroger import _encrypt_token
        conn.execute(
            text("""INSERT INTO user_kroger_tokens (user_id, access_token, refresh_token, expires_at, scope)
                VALUES (:uid, :at, :rt, :exp, :scope)
                ON CONFLICT (user_id) DO UPDATE SET
                    access_token = excluded.access_token,
                    refresh_token = excluded.refresh_token,
                    expires_at = excluded.expires_at,
                    scope = excluded.scope,
                    updated_at = CURRENT_TIMESTAMP"""),
            {
                "uid": user_id,
                "at": _encrypt_token(token_data["access_token"]),
                "rt": _encrypt_token(token_data.get("refresh_token", "")),
                "exp": expires_at,
                "scope": token_data.get("scope", ""),
            },
        )
        conn.commit()
    except Exception as e:
        print(f"[kroger] OAuth callback error: {e}")
        return RedirectResponse(url="/app?kroger=error", status_code=302)

    return RedirectResponse(url="/app?kroger=connected", status_code=302)


@app.post("/api/kroger/disconnect")
async def kroger_disconnect(request: Request):
    """Remove Kroger connection for the current user."""
    user_id = request.state.real_user_id
    conn = get_request_connection()
    conn.execute(
        text("DELETE FROM user_kroger_tokens WHERE user_id = :uid"),
        {"uid": user_id},
    )
    conn.commit()
    return {"ok": True}


@app.get("/api/kroger/locations")
async def kroger_locations(zip: str = "", request: Request = None):
    """Search Kroger store locations by zip code."""
    if not zip or len(zip) < 5:
        return {"locations": [], "error": "Valid zip code required"}
    try:
        from mealrunner.kroger import search_kroger_locations
        locations = search_kroger_locations(zip)
        return {"locations": locations}
    except Exception as e:
        return {"locations": [], "error": str(e)}


@app.get("/api/kroger/location")
async def kroger_location_get(request: Request):
    """Get the user's current Kroger store location with name/address."""
    user_id = request.state.user_id
    conn = get_request_connection()
    row = conn.execute(
        text("SELECT location_id FROM stores WHERE user_id = :uid AND api = 'kroger' AND location_id != '' LIMIT 1"),
        {"uid": user_id},
    ).fetchone()
    if not row:
        return {"location_id": "", "name": "", "address": ""}
    loc_id = row["location_id"]
    # Try to look up store details from Kroger API
    try:
        from mealrunner.kroger import _headers, BASE_URL
        import requests as _requests
        resp = _requests.get(f"{BASE_URL}/locations/{loc_id}", headers=_headers(), timeout=10)
        if resp.ok:
            data = resp.json().get("data", {})
            addr = data.get("address", {})
            return {
                "location_id": loc_id,
                "name": data.get("name", "Kroger"),
                "address": f"{addr.get('addressLine1', '')}, {addr.get('city', '')} {addr.get('state', '')} {addr.get('zipCode', '')}",
            }
    except Exception:
        pass
    return {"location_id": loc_id, "name": "Kroger", "address": ""}


@app.post("/api/kroger/location")
async def kroger_location_set(body: dict, request: Request):
    """Set the user's Kroger store location."""
    from mealrunner.stores import set_kroger_location_id, refresh_nearby_stores
    user_id = request.state.user_id
    location_id = body.get("location_id", "").strip()
    if not location_id:
        return {"ok": False, "error": "location_id required"}
    conn = get_request_connection()
    set_kroger_location_id(conn, user_id, location_id)
    # Cache nearby stores — prefer user's home zip over store search zip
    zip_code = body.get("zip_code", "").strip()
    home_zip_row = conn.execute(
        text("SELECT value FROM settings WHERE user_id = :uid AND key = 'home_zip'"),
        {"uid": user_id},
    ).fetchone()
    nearby_zip = (home_zip_row["value"] if home_zip_row else None) or zip_code
    if nearby_zip:
        try:
            refresh_nearby_stores(conn, user_id, location_id, nearby_zip)
        except Exception:
            pass
    return {"ok": True, "location_id": location_id}


@app.get("/api/kroger/household-accounts")
async def kroger_household_accounts(request: Request):
    """Return household members who have linked Kroger accounts."""
    real_user_id = request.state.real_user_id
    conn = get_request_connection()
    # Find the user's household
    hh_row = conn.execute(
        text("SELECT household_id FROM household_members WHERE user_id = :uid"),
        {"uid": real_user_id},
    ).fetchone()
    if not hh_row:
        return {"accounts": []}

    # Get household members with Kroger tokens — only show others if they opted in
    rows = conn.execute(
        text("""SELECT hm.user_id, u.display_name, u.email, ukt.allow_household
            FROM household_members hm
            JOIN users u ON u.id = hm.user_id
            JOIN user_kroger_tokens ukt ON ukt.user_id = hm.user_id
            WHERE hm.household_id = :hh_id
              AND (ukt.user_id = :real_user_id OR ukt.allow_household = 1)
            ORDER BY hm.role ASC, hm.joined_at ASC"""),
        {"hh_id": hh_row["household_id"], "real_user_id": real_user_id},
    ).fetchall()

    accounts = []
    for r in rows:
        name = r["display_name"] or r["email"].split("@")[0]
        acct = {
            "user_id": r["user_id"],
            "display_name": name,
            "is_you": r["user_id"] == real_user_id,
        }
        if r["user_id"] == real_user_id:
            acct["allow_household"] = bool(r["allow_household"])
        accounts.append(acct)
    return {"accounts": accounts}


@app.post("/api/store/allow-household")
async def store_allow_household(request: Request):
    """Toggle whether household members can order through this account."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    body = await request.json()
    allow = 1 if body.get("allow") else 0
    conn = get_request_connection()
    result = conn.execute(
        text("UPDATE user_kroger_tokens SET allow_household = :allow WHERE user_id = :uid"),
        {"allow": allow, "uid": real_user_id},
    )
    conn.commit()
    if result.rowcount == 0:
        return {"ok": False, "error": "No linked account found"}
    return {"ok": True}


# ── Routes ────────────────────────────────────────────────

@app.get("/")
async def index():
    """Landing page — redirect to React app."""
    return RedirectResponse(url="/app", status_code=302)


# ── React SPA catch-all (must be last) ───────────────────

@app.get("/app/{rest:path}")
@app.get("/app")
async def react_spa(request: Request, rest: str = ""):
    """Serve the React SPA for any /app route."""
    index = _FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"error": "Frontend not built"}, status_code=404)
