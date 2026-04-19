"""Authentication: magic link login, sessions, middleware."""

from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from sqlalchemy import text

from mealrunner.database import get_connection, DictConnection

SESSION_COOKIE = "mealrunner_session"
SESSION_TTL_DAYS = 30
MAGIC_LINK_TTL_MINUTES = 15

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "mealrunner <noreply@mealrunner.app>")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")

# Paths that don't require authentication
PUBLIC_PATHS = {
    "/health",
    "/api/auth/login",
    "/api/auth/verify",
    "/api/auth/google",
    "/api/auth/google-client-id",
    "/api/auth/me",
    "/api/kroger/callback",
}

PUBLIC_PREFIXES = (
    "/app",
    "/assets",
    "/api/auth/",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_str() -> str:
    return _now().isoformat()


def _is_public(path: str) -> bool:
    """Check if a request path is public (no auth required)."""
    if path in PUBLIC_PATHS:
        return True
    for prefix in PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


# ── Session Management ───────────────────────────────────


def create_session(conn: DictConnection, user_id: str) -> str:
    """Create a new session and return the session ID."""
    session_id = secrets.token_urlsafe(32)
    expires = _now() + timedelta(days=SESSION_TTL_DAYS)
    conn.execute(
        text("""INSERT INTO sessions (id, user_id, created_at, expires_at)
           VALUES (:id, :user_id, :now, :expires)"""),
        {"id": session_id, "user_id": user_id, "now": _now_str(), "expires": expires.isoformat()},
    )
    conn.commit()
    return session_id


def get_user_from_session(conn: DictConnection, session_id: str) -> str | None:
    """Look up a session and return the user_id, or None if invalid/expired."""
    row = conn.execute(
        text("SELECT user_id, expires_at FROM sessions WHERE id = :id"),
        {"id": session_id},
    ).fetchone()
    if not row:
        return None

    expires = row["expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if _now() > expires:
        # Clean up expired session
        conn.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": session_id})
        conn.commit()
        return None

    return row["user_id"]


def delete_session(conn: DictConnection, session_id: str) -> None:
    """Delete a session."""
    conn.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": session_id})
    conn.commit()


def set_session_cookie(response: Response, session_id: str) -> None:
    """Set the session cookie on a response."""
    is_prod = BASE_URL.startswith("https")
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        max_age=SESSION_TTL_DAYS * 86400,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    """Clear the session cookie."""
    response.delete_cookie(key=SESSION_COOKIE, path="/")


# ── Magic Link ───────────────────────────────────────────


def create_magic_link(conn: DictConnection, user_id: str) -> str:
    """Generate a magic link token and store it."""
    token = secrets.token_urlsafe(32)
    expires = _now() + timedelta(minutes=MAGIC_LINK_TTL_MINUTES)
    conn.execute(
        text("""INSERT INTO magic_links (token, user_id, expires_at, created_at)
           VALUES (:token, :user_id, :expires, :now)"""),
        {"token": token, "user_id": user_id, "expires": expires.isoformat(), "now": _now_str()},
    )
    conn.commit()
    return token


def verify_magic_link(conn: DictConnection, token: str) -> str | None:
    """Verify a magic link token. Returns user_id if valid, None if expired/used.

    Allows a 60-second grace window after first use to handle email client
    link prefetching (Outlook, Gmail scan links before the user clicks).
    """
    row = conn.execute(
        text("SELECT user_id, expires_at, used_at FROM magic_links WHERE token = :token"),
        {"token": token},
    ).fetchone()
    if not row:
        return None

    # If already used, allow within 60-second grace window
    if row["used_at"]:
        try:
            used = row["used_at"]
            if isinstance(used, str):
                used = datetime.fromisoformat(used)
            if used.tzinfo is None:
                used = used.replace(tzinfo=timezone.utc)
            if _now() - used < timedelta(minutes=10):
                return row["user_id"]
        except (ValueError, TypeError):
            pass
        return None

    expires = row["expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if _now() > expires:
        return None

    # Mark as used (don't delete — grace window allows re-use)
    conn.execute(
        text("UPDATE magic_links SET used_at = :now WHERE token = :token"),
        {"now": _now_str(), "token": token},
    )

    # Clean up old tokens (expired or used > 5 minutes ago)
    conn.execute(
        text("""DELETE FROM magic_links WHERE expires_at < :now
           OR (used_at IS NOT NULL AND used_at < :cutoff)"""),
        {"now": _now_str(), "cutoff": (_now() - timedelta(minutes=5)).isoformat()},
    )

    # Update last_login
    conn.execute(
        text("UPDATE users SET last_login = :now WHERE id = :user_id"),
        {"now": _now_str(), "user_id": row["user_id"]},
    )

    conn.commit()
    return row["user_id"]


# ── Email ────────────────────────────────────────────────


def send_magic_link_email(email: str, token: str) -> bool:
    """Send a magic link email via Resend. Returns True on success."""
    import httpx

    if not RESEND_API_KEY:
        # Dev mode: print the link instead
        link = f"{BASE_URL}/api/auth/verify?token={token}"
        print(f"\n{'='*50}")
        print(f"MAGIC LINK (no RESEND_API_KEY set):")
        print(f"  {link}")
        print(f"{'='*50}\n")
        return True

    link = f"{BASE_URL}/api/auth/verify?token={token}"
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": RESEND_FROM,
                "to": [email],
                "subject": "Sign in to mealrunner",
                "html": _magic_link_html(link),
            },
            timeout=10,
        )
        if resp.status_code != 200:
            print(f"[auth] Resend error {resp.status_code}: {resp.text}")
        return resp.status_code == 200
    except Exception as e:
        print(f"[auth] Resend exception: {e}")
        return False


def _magic_link_html(link: str) -> str:
    """Email template for magic link."""
    return f"""
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px; text-align: center;">
        <div style="font-size: 28px; font-weight: 600; color: #2C2420; margin-bottom: 8px;">
            sous<em style="color: #D4623A; font-style: italic;">chef</em>
        </div>
        <div style="color: #8B6F5E; font-size: 14px; margin-bottom: 32px;">
            Meal planning that fits your life
        </div>
        <div style="margin-bottom: 32px;">
            <a href="{link}" style="display: inline-block; background: #D4623A; color: white; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-size: 16px; font-weight: 500;">
                Sign in
            </a>
        </div>
        <div style="color: #9B8B80; font-size: 12px;">
            This link expires in 15 minutes. If you didn't request this, you can ignore it.
        </div>
    </div>
    """


# ── Whitelist ────────────────────────────────────────────


def is_email_allowed(conn: DictConnection, email: str) -> bool:
    """Check if an email is on the beta whitelist."""
    row = conn.execute(
        text("SELECT 1 FROM allowed_emails WHERE LOWER(email) = LOWER(:email)"),
        {"email": email},
    ).fetchone()
    return row is not None


def find_or_create_user(conn: DictConnection, email: str) -> str:
    """Find existing user by email or create a new one. Returns user_id."""
    row = conn.execute(
        text("SELECT id FROM users WHERE LOWER(email) = LOWER(:email)"),
        {"email": email},
    ).fetchone()
    if row:
        return row["id"]

    user_id = str(uuid.uuid4())
    conn.execute(
        text("""INSERT INTO users (id, email, created_at)
           VALUES (:id, :email, :now)"""),
        {"id": user_id, "email": email.lower(), "now": _now_str()},
    )
    conn.commit()
    return user_id


# ── Household Resolution ────────────────────────────────


def get_household_owner_id(conn: DictConnection, user_id: str) -> str:
    """Resolve a user to their household owner's user_id.

    All household members share data under the owner's user_id.
    Returns the user's own ID if they have no household or are the owner.
    """
    row = conn.execute(
        text("SELECT household_id FROM household_members WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).fetchone()
    if not row:
        return user_id

    owner = conn.execute(
        text("SELECT user_id FROM household_members WHERE household_id = :hh_id AND role = 'owner'"),
        {"hh_id": row["household_id"]},
    ).fetchone()
    return owner["user_id"] if owner else user_id


def get_household_id(conn: DictConnection, user_id: str) -> str | None:
    """Get the household_id for a user."""
    row = conn.execute(
        text("SELECT household_id FROM household_members WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).fetchone()
    return row["household_id"] if row else None


def ensure_household(conn: DictConnection, user_id: str) -> str:
    """Ensure a user has a household. Creates one if needed. Returns household_id."""
    row = conn.execute(
        text("SELECT household_id FROM household_members WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).fetchone()
    if row:
        return row["household_id"]

    hh_id = str(uuid.uuid4())
    conn.execute(
        text("""INSERT INTO household_members (household_id, user_id, role)
           VALUES (:hh_id, :user_id, 'owner')"""),
        {"hh_id": hh_id, "user_id": user_id},
    )
    conn.commit()
    return hh_id


# ── Middleware Helper ────────────────────────────────────


def get_user_id_from_request(request: Request) -> str | None:
    """Extract user_id from request session cookie. Returns None if not authenticated."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        return None
    conn = get_connection()
    try:
        return get_user_from_session(conn, session_id)
    finally:
        conn.close()
