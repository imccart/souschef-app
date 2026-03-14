"""FastAPI application for souschef web frontend."""

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

from souschef.db import ensure_db
from souschef.web.api import router as api_router
from souschef.web.auth import (
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
from souschef.database import get_connection

_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"

_CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173"
).split(",")


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
        conn = get_connection()
        try:
            effective_user_id = get_household_owner_id(conn, user_id)
        except Exception as e:
            print(f"[auth] Household resolution failed for {user_id}: {e}")
            effective_user_id = user_id  # fall back to own user_id
        finally:
            conn.close()

        # Attach user_id to request state for endpoints to use
        request.state.user_id = effective_user_id
        request.state.real_user_id = user_id  # actual logged-in user (for feedback, household mgmt)
        return await call_next(request)


app = FastAPI(title="Souschef")

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        print("[startup] Initializing database...", flush=True)
        sys.stdout.flush()
        ensure_db()
        print("[startup] Database initialized successfully", flush=True)
        sys.stdout.flush()
    except Exception as e:
        print(f"[startup] FATAL: {type(e).__name__}: {e}", flush=True)
        import traceback
        traceback.print_exc(file=sys.stdout)
        sys.stdout.flush()
        raise

app.add_middleware(AuthMiddleware)
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


# ── Health Check ──────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check for Railway / load balancers."""
    try:
        conn = get_connection()
        conn.execute(text("SELECT 1"))
        conn.close()
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

_login_attempts: dict[str, list[float]] = {}  # {email: [timestamps]}
_LOGIN_MAX = 3
_LOGIN_WINDOW = 900  # 15 minutes


@app.post("/api/auth/login")
async def auth_login(body: dict):
    """Send a magic link to the given email (if whitelisted)."""
    import time as _time

    email = body.get("email", "").strip().lower()
    if not email:
        return {"ok": False, "error": "Email required"}

    # Rate limit: max 3 attempts per email per 15 minutes
    now = _time.time()
    attempts = _login_attempts.get(email, [])
    attempts = [t for t in attempts if now - t < _LOGIN_WINDOW]
    if len(attempts) >= _LOGIN_MAX:
        return {"ok": False, "error": "Too many login attempts. Please try again later."}
    attempts.append(now)
    _login_attempts[email] = attempts

    conn = get_connection()
    try:
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
    finally:
        conn.close()

    return {"ok": True, "sent": True}


@app.get("/api/auth/verify")
async def auth_verify(token: str):
    """Verify a magic link token, create session, redirect to app."""
    conn = get_connection()
    try:
        user_id = verify_magic_link(conn, token)
        if not user_id:
            return RedirectResponse(url="/app?auth=expired", status_code=302)

        # One-time: claim orphaned 'default' user data for the first real user
        _claim_default_data(conn, user_id)

        # Ensure user has a household (creates one if needed)
        # Note: pending household invites are handled via UI prompt, not auto-accepted
        ensure_household(conn, user_id)

        session_id = create_session(conn, user_id)
    finally:
        conn.close()

    response = RedirectResponse(url="/app", status_code=302)
    set_session_cookie(response, session_id)
    return response


@app.get("/api/auth/me")
async def auth_me(request: Request):
    """Return current user info, or 401 if not authenticated."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)

    conn = get_connection()
    try:
        user_id = get_user_from_session(conn, session_id)
        if not user_id:
            return JSONResponse({"error": "Session expired"}, status_code=401)

        user = conn.execute(
            text("SELECT id, email, display_name FROM users WHERE id = :id"),
            {"id": user_id},
        ).fetchone()
    finally:
        conn.close()

    if not user:
        return JSONResponse({"error": "User not found"}, status_code=401)

    return {"id": user["id"], "email": user["email"], "display_name": user["display_name"]}


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """Clear the session."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        conn = get_connection()
        try:
            delete_session(conn, session_id)
        finally:
            conn.close()

    response = JSONResponse({"ok": True})
    clear_session_cookie(response)
    return response


# ── Kroger OAuth ──────────────────────────────────────────

@app.get("/api/kroger/status")
async def kroger_status(request: Request):
    """Check if the current user has a linked Kroger account."""
    user_id = request.state.real_user_id
    conn = get_connection()
    try:
        row = conn.execute(
            text("SELECT expires_at FROM user_kroger_tokens WHERE user_id = :uid"),
            {"uid": user_id},
        ).fetchone()
    finally:
        conn.close()
    return {"connected": bool(row)}


@app.get("/api/kroger/connect")
async def kroger_connect(request: Request):
    """Start Kroger OAuth flow. Returns auth URL for frontend to open."""
    import secrets as _secrets
    from souschef.kroger import get_kroger_auth_url

    user_id = request.state.real_user_id
    state = _secrets.token_urlsafe(32)

    # Store state → user_id mapping in session-like table (reuse settings)
    conn = get_connection()
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
    finally:
        conn.close()

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

    from souschef.kroger import exchange_code_for_token
    from datetime import datetime, timedelta, timezone

    conn = get_connection()
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

        # Store tokens
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
                "at": token_data["access_token"],
                "rt": token_data.get("refresh_token", ""),
                "exp": expires_at,
                "scope": token_data.get("scope", ""),
            },
        )
        conn.commit()
    except Exception as e:
        print(f"[kroger] OAuth callback error: {e}")
        return RedirectResponse(url="/app?kroger=error", status_code=302)
    finally:
        conn.close()

    return RedirectResponse(url="/app?kroger=connected", status_code=302)


@app.post("/api/kroger/disconnect")
async def kroger_disconnect(request: Request):
    """Remove Kroger connection for the current user."""
    user_id = request.state.real_user_id
    conn = get_connection()
    try:
        conn.execute(
            text("DELETE FROM user_kroger_tokens WHERE user_id = :uid"),
            {"uid": user_id},
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/api/kroger/locations")
async def kroger_locations(zip: str = "", request: Request = None):
    """Search Kroger store locations by zip code."""
    if not zip or len(zip) < 5:
        return {"locations": [], "error": "Valid zip code required"}
    try:
        from souschef.kroger import search_kroger_locations
        locations = search_kroger_locations(zip)
        return {"locations": locations}
    except Exception as e:
        return {"locations": [], "error": str(e)}


@app.get("/api/kroger/location")
async def kroger_location_get(request: Request):
    """Get the user's current Kroger store location with name/address."""
    user_id = request.state.user_id
    conn = get_connection()
    try:
        row = conn.execute(
            text("SELECT location_id FROM stores WHERE user_id = :uid AND api = 'kroger' AND location_id != '' LIMIT 1"),
            {"uid": user_id},
        ).fetchone()
        if not row:
            return {"location_id": "", "name": "", "address": ""}
        loc_id = row["location_id"]
        # Try to look up store details from Kroger API
        try:
            from souschef.kroger import _headers, BASE_URL
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
    finally:
        conn.close()


@app.post("/api/kroger/location")
async def kroger_location_set(body: dict, request: Request):
    """Set the user's Kroger store location."""
    from souschef.stores import set_kroger_location_id
    user_id = request.state.user_id
    location_id = body.get("location_id", "").strip()
    if not location_id:
        return {"ok": False, "error": "location_id required"}
    conn = get_connection()
    try:
        set_kroger_location_id(conn, user_id, location_id)
    finally:
        conn.close()
    return {"ok": True, "location_id": location_id}


@app.get("/api/kroger/household-accounts")
async def kroger_household_accounts(request: Request):
    """Return household members who have linked Kroger accounts."""
    real_user_id = request.state.real_user_id
    conn = get_connection()
    try:
        # Find the user's household
        hh_row = conn.execute(
            text("SELECT household_id FROM household_members WHERE user_id = :uid"),
            {"uid": real_user_id},
        ).fetchone()
        if not hh_row:
            return {"accounts": []}

        # Get all household members who have Kroger tokens
        rows = conn.execute(
            text("""SELECT hm.user_id, u.display_name, u.email
                FROM household_members hm
                JOIN users u ON u.id = hm.user_id
                JOIN user_kroger_tokens ukt ON ukt.user_id = hm.user_id
                WHERE hm.household_id = :hh_id
                ORDER BY hm.role ASC, hm.joined_at ASC"""),
            {"hh_id": hh_row["household_id"]},
        ).fetchall()
    finally:
        conn.close()

    accounts = []
    for r in rows:
        name = r["display_name"] or r["email"].split("@")[0]
        accounts.append({
            "user_id": r["user_id"],
            "display_name": name,
            "is_you": r["user_id"] == real_user_id,
        })
    return {"accounts": accounts}



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
