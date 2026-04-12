"""SQLAlchemy Core database setup — PostgreSQL only.

All table definitions live here. Connection management provides dict-like row access
via DictConnection/DictResult wrappers.
"""

from __future__ import annotations

import contextvars
import os

from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    text,
)


# ── Engine Setup ──────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

# Railway uses postgres:// but SQLAlchemy requires postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True,
    pool_size=20, max_overflow=10, pool_timeout=30,
)

metadata = MetaData()


# ── Auth Tables ───────────────────────────────────────────

users = Table(
    "users", metadata,
    Column("id", Text, primary_key=True),
    Column("email", Text, unique=True, nullable=False),
    Column("display_name", Text, nullable=False, server_default=text("''")),
    Column("first_name", Text, nullable=False, server_default=text("''")),
    Column("last_name", Text, nullable=False, server_default=text("''")),
    Column("tos_accepted_at", Text),
    Column("tos_version", Text, nullable=False, server_default=text("''")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("last_login", Text),
)

magic_links = Table(
    "magic_links", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("token", Text, unique=True, nullable=False),
    Column("user_id", Text, ForeignKey("users.id"), nullable=False),
    Column("expires_at", Text, nullable=False),
    Column("used_at", Text),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

sessions = Table(
    "sessions", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Text, ForeignKey("users.id"), nullable=False),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("expires_at", Text, nullable=False),
)

allowed_emails = Table(
    "allowed_emails", metadata,
    Column("email", Text, primary_key=True),
    Column("added_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

waitlist = Table(
    "waitlist", metadata,
    Column("email", Text, primary_key=True),
    Column("requested_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)


# ── Table Definitions ─────────────────────────────────────

ingredients = Table(
    "ingredients", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, unique=True, nullable=False),
    Column("category", Text, nullable=False, server_default=text("''")),
    Column("aisle", Text, nullable=False, server_default=text("''")),
    Column("default_unit", Text, nullable=False, server_default=text("'count'")),
    Column("store_pref", Text, nullable=False, server_default=text("'either'")),
    Column("is_pantry_staple", Integer, nullable=False, server_default=text("0")),
    Column("root", Text, nullable=False, server_default=text("''")),
)

recipes = Table(
    "recipes", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("cuisine", Text, nullable=False, server_default=text("'any'")),
    Column("effort", Text, nullable=False, server_default=text("'medium'")),
    Column("cleanup", Text, nullable=False, server_default=text("'medium'")),
    Column("outdoor", Integer, nullable=False, server_default=text("0")),
    Column("kid_friendly", Integer, nullable=False, server_default=text("1")),
    Column("premade", Integer, nullable=False, server_default=text("0")),
    Column("prep_minutes", Integer, nullable=False, server_default=text("0")),
    Column("cook_minutes", Integer, nullable=False, server_default=text("0")),
    Column("servings", Integer, nullable=False, server_default=text("4")),
    Column("notes", Text, nullable=False, server_default=text("''")),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("recipe_type", Text, nullable=False, server_default=text("'meal'")),
)

recipe_ingredients = Table(
    "recipe_ingredients", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("recipe_id", Integer, ForeignKey("recipes.id"), nullable=False),
    Column("ingredient_id", Integer, ForeignKey("ingredients.id"), nullable=False),
    Column("quantity", Float, nullable=False),
    Column("unit", Text, nullable=False),
    Column("prep_note", Text, nullable=False, server_default=text("''")),
    Column("component", Text, nullable=False, server_default=text("''")),
)

pantry = Table(
    "pantry", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("ingredient_id", Integer, ForeignKey("ingredients.id"), nullable=False),
    Column("quantity", Float, nullable=False),
    Column("unit", Text, nullable=False),
    Column("updated_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

meals = Table(
    "meals", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("slot_date", Text, nullable=False),
    Column("recipe_id", Integer, ForeignKey("recipes.id")),
    Column("recipe_name", Text, nullable=False, server_default=text("''")),
    Column("status", Text, nullable=False, server_default=text("'suggested'")),
    Column("side", Text, nullable=False, server_default=text("''")),
    Column("locked", Integer, nullable=False, server_default=text("0")),
    Column("is_followup", Integer, nullable=False, server_default=text("0")),
    Column("on_grocery", Integer, nullable=False, server_default=text("0")),
    Column("side_recipe_id", Integer, ForeignKey("recipes.id"), nullable=True),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("notes", Text, nullable=False, server_default=text("''")),
)

meal_sides = Table(
    "meal_sides", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("meal_id", Integer, ForeignKey("meals.id", ondelete="CASCADE"), nullable=False),
    Column("side_recipe_id", Integer, ForeignKey("recipes.id"), nullable=True),
    Column("side_name", Text, nullable=False, server_default=text("''")),
    Column("position", Integer, nullable=False, server_default=text("0")),
)

grocery_runs = Table(
    "grocery_runs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("note", Text, nullable=False, server_default=text("''")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

grocery_run_items = Table(
    "grocery_run_items", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("run_id", Integer, ForeignKey("grocery_runs.id"), nullable=False),
    Column("item_name", Text, nullable=False),
    Column("checked", Integer, nullable=False, server_default=text("0")),
)

product_preferences = Table(
    "product_preferences", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("search_term", Text, nullable=False),
    Column("upc", Text, nullable=False),
    Column("product_description", Text, nullable=False),
    Column("size", Text, nullable=False, server_default=text("''")),
    Column("times_picked", Integer, nullable=False, server_default=text("1")),
    Column("last_picked", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("source", Text, nullable=False, server_default=text("'picked'")),
    Column("order_id", Text, nullable=False, server_default=text("''")),
    Column("rating", Integer, nullable=False, server_default=text("0")),
    Column("brand", Text, nullable=False, server_default=text("''")),
    Column("product_key", Text, nullable=False, server_default=text("''")),
    UniqueConstraint("user_id", "search_term", "product_key"),
)

product_ratings = Table(
    "product_ratings", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("upc", Text, nullable=False),
    Column("product_description", Text, nullable=False, server_default=text("''")),
    Column("rating", Integer, nullable=False),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("updated_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("brand", Text, nullable=False, server_default=text("''")),
    Column("product_key", Text, nullable=False, server_default=text("''")),
    UniqueConstraint("user_id", "product_key"),
)

regulars = Table(
    "regulars", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("name", Text, nullable=False),
    Column("ingredient_id", Integer, ForeignKey("ingredients.id")),
    Column("shopping_group", Text, nullable=False, server_default=text("''")),
    Column("store_pref", Text, nullable=False, server_default=text("'either'")),
    Column("active", Integer, nullable=False, server_default=text("0")),
)

product_scores = Table(
    "product_scores", metadata,
    Column("upc", Text, primary_key=True),
    Column("nova_group", Integer),
    Column("nutriscore", Text, nullable=False, server_default=text("''")),
    Column("price", Float),
    Column("promo_price", Float),
    Column("in_stock", Integer),
    Column("curbside", Integer),
    Column("delivery", Integer),
    Column("score_fetched_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("price_fetched_at", Text),
)

product_prices = Table(
    "product_prices", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("upc", Text, nullable=False),
    Column("location_id", Text, nullable=False),
    Column("store_chain", Text, nullable=False, server_default=text("'kroger'")),
    Column("price", Float),
    Column("promo_price", Float),
    Column("in_stock", Integer),
    Column("source", Text, nullable=False),
    Column("user_id", Text),
    Column("fetched_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

community_prices = Table(
    "community_prices", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("upc", Text, nullable=False),
    Column("location_id", Text, nullable=False),
    Column("store_chain", Text, nullable=False, server_default=text("'kroger'")),
    Column("date", Text, nullable=False),
    Column("avg_price", Float),
    Column("min_price", Float),
    Column("max_price", Float),
    Column("promo_price", Float),
    Column("sample_count", Integer, nullable=False, server_default=text("1")),
    UniqueConstraint("upc", "location_id", "date"),
)

grocery_trips = Table(
    "grocery_trips", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("trip_type", Text, nullable=False, server_default=text("'plan'")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("completed_at", Text),
    Column("start_date", Text),
    Column("end_date", Text),
    Column("active", Integer, nullable=False, server_default=text("1")),
    Column("regulars_added", Integer, nullable=False, server_default=text("0")),
    Column("regulars_added_at", Text),
    Column("pantry_checked", Integer, nullable=False, server_default=text("0")),
    Column("pantry_checked_at", Text),
    Column("order_source", Text, nullable=False, server_default=text("'none'")),
    Column("receipt_data", Text),
    Column("receipt_parsed_at", Text),
    Column("stale_checked", Integer, nullable=False, server_default=text("0")),
    Column("stale_checked_at", Text),
)

trip_items = Table(
    "trip_items", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("trip_id", Integer, ForeignKey("grocery_trips.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("shopping_group", Text, nullable=False, server_default=text("'Other'")),
    Column("source", Text, nullable=False, server_default=text("'extra'")),
    Column("for_meals", Text, nullable=False, server_default=text("''")),
    Column("meal_count", Integer, nullable=False, server_default=text("0")),
    Column("checked", Integer, nullable=False, server_default=text("0")),
    Column("checked_at", Text),
    Column("skipped", Integer, nullable=False, server_default=text("0")),
    Column("skipped_at", Text),
    Column("have_it", Integer, nullable=False, server_default=text("0")),
    Column("have_it_at", Text),
    Column("added_at", Text, server_default=text("CURRENT_TIMESTAMP")),
    Column("ordered", Integer, nullable=False, server_default=text("0")),
    Column("ordered_at", Text),
    Column("product_upc", Text, nullable=False, server_default=text("''")),
    Column("product_name", Text, nullable=False, server_default=text("''")),
    Column("product_brand", Text, nullable=False, server_default=text("''")),
    Column("product_size", Text, nullable=False, server_default=text("''")),
    Column("product_price", Float),
    Column("product_image", Text, nullable=False, server_default=text("''")),
    Column("quantity", Integer, nullable=False, server_default=text("1")),
    Column("selected_at", Text),
    Column("submitted_at", Text),
    Column("receipt_item", Text, nullable=False, server_default=text("''")),
    Column("receipt_price", Float),
    Column("receipt_upc", Text, nullable=False, server_default=text("''")),
    Column("receipt_status", Text, nullable=False, server_default=text("''")),
    Column("notes", Text, nullable=False, server_default=text("''")),
    Column("removed", Integer, nullable=False, server_default=text("0")),
    Column("removed_at", Text),
    Column("buy_elsewhere", Integer, nullable=False, server_default=text("0")),
    Column("buy_elsewhere_at", Text),
    UniqueConstraint("trip_id", "name"),
)

rate_limits = Table(
    "rate_limits", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("endpoint", Text, nullable=False),
    Column("user_id", Text, nullable=False),
    Column("count", Integer, nullable=False, server_default=text("0")),
    Column("window_start", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("endpoint", "user_id"),
)

learning_dismissed = Table(
    "learning_dismissed", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("name", Text, nullable=False),
    Column("dismissed_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("kind", Text, nullable=False, server_default=text("'regular'")),
)

meal_item_overrides = Table(
    "meal_item_overrides", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("recipe_name", Text, nullable=False),
    Column("item_name", Text, nullable=False),
    Column("action", Text, nullable=False),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("user_id", "recipe_name", "item_name"),
)

household_members = Table(
    "household_members", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("household_id", Text, nullable=False),
    Column("user_id", Text, ForeignKey("users.id"), unique=True, nullable=False),
    Column("role", Text, nullable=False, server_default=text("'owner'")),
    Column("joined_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

household_invites = Table(
    "household_invites", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("household_id", Text, nullable=False),
    Column("email", Text, nullable=False),
    Column("invited_by", Text, ForeignKey("users.id"), nullable=False),
    Column("status", Text, nullable=False, server_default=text("'pending'")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

user_feedback = Table(
    "user_feedback", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, ForeignKey("users.id"), nullable=False),
    Column("message", Text, nullable=False),
    Column("page", Text, nullable=False, server_default=text("''")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("status", Text, nullable=False, server_default=text("'open'")),
    Column("response", Text, nullable=True),
    Column("responded_at", Text, nullable=True),
    Column("dismissed", Integer, nullable=False, server_default=text("0")),
)

user_item_groups = Table(
    "user_item_groups", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False),
    Column("item_name", Text, nullable=False),
    Column("shopping_group", Text, nullable=False),
    Column("updated_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("user_id", "item_name"),
)

user_kroger_tokens = Table(
    "user_kroger_tokens", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, ForeignKey("users.id"), unique=True, nullable=False),
    Column("access_token", Text, nullable=False),
    Column("refresh_token", Text, nullable=False),
    Column("expires_at", Text, nullable=False),
    Column("scope", Text, nullable=False, server_default=text("''")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("updated_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("allow_household", Integer, nullable=False, server_default=text("0")),
)

community_data = Table(
    "community_data", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Text, ForeignKey("users.id"), nullable=False),
    Column("household_id", Text, nullable=False, server_default=text("''")),
    Column("data_type", Text, nullable=False),
    Column("subject", Text, nullable=False),
    Column("suggested_value", Text, nullable=False),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

receipt_extra_items = Table(
    "receipt_extra_items", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("trip_id", Integer, ForeignKey("grocery_trips.id"), nullable=False),
    Column("item_name", Text, nullable=False),
    Column("price", Float),
    Column("upc", Text, nullable=False, server_default=text("''")),
    Column("brand", Text, nullable=False, server_default=text("''")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("dismissed", Integer, nullable=False, server_default=text("0")),
)

unknown_brands = Table(
    "unknown_brands", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("brand", Text, nullable=False, unique=True),
    Column("times_seen", Integer, nullable=False, server_default=text("1")),
    Column("first_seen", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    Column("last_seen", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

brand_ownership = Table(
    "brand_ownership", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("brand", Text, nullable=False),
    Column("parent_company", Text),  # NULL means self-owned (brand IS the company)
    Column("category", Text, nullable=False, server_default=text("''")),  # '' = all categories
    # Unique constraint: (brand, category) — managed via migration index
)

company_violations = Table(
    "company_violations", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("parent_company", Text, nullable=False),
    Column("agency", Text, nullable=False),  # e.g. 'FDA'
    Column("total_records", Integer, nullable=False, server_default=text("0")),
    Column("class_i", Integer, nullable=False, server_default=text("0")),
    Column("class_ii", Integer, nullable=False, server_default=text("0")),
    Column("class_iii", Integer, nullable=False, server_default=text("0")),
    Column("most_recent_date", Text),
    Column("refreshed_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
)

stores = Table(
    "stores", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False, server_default=text("'default'")),
    Column("name", Text, nullable=False),
    Column("key", Text, nullable=False),
    Column("mode", Text, nullable=False, server_default=text("'in-person'")),
    Column("api", Text, nullable=False, server_default=text("'none'")),
    Column("location_id", Text, nullable=False, server_default=text("''")),
    UniqueConstraint("user_id", "key"),
)

nearby_stores = Table(
    "nearby_stores", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=False),
    Column("location_id", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("address", Text, nullable=False, server_default=text("''")),
    Column("rank", Integer, nullable=False, server_default=text("1")),
    Column("created_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("user_id", "location_id"),
)

settings = Table(
    "settings", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Text),
    Column("key", Text, nullable=False),
    Column("value", Text, nullable=False, server_default=text("''")),
    Column("updated_at", Text, nullable=False, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("user_id", "key"),
)


# ── Connection Wrapper ────────────────────────────────────
# Provides dict-like row access (row["column"]) for backward
# compatibility with the sqlite3.Row pattern used everywhere.


class DictResult:
    """Wraps CursorResult to return dict-like RowMapping objects."""

    __slots__ = ("_result",)

    def __init__(self, result):
        self._result = result

    def fetchone(self):
        if self._result.returns_rows:
            row = self._result.mappings().fetchone()
            return row
        return None

    def fetchall(self):
        if self._result.returns_rows:
            return self._result.mappings().fetchall()
        return []

    @property
    def lastrowid(self):
        return self._result.lastrowid

    @property
    def rowcount(self):
        return self._result.rowcount

    @property
    def inserted_primary_key(self):
        return self._result.inserted_primary_key


class DictConnection:
    """Wraps a SQLAlchemy Connection to return dict-like rows by default.

    This allows existing code that uses row["column"] syntax to work
    unchanged with SQLAlchemy connections.
    """

    __slots__ = ("_conn",)

    def __init__(self, conn):
        self._conn = conn

    def execute(self, stmt, parameters=None):
        if parameters is not None:
            result = self._conn.execute(stmt, parameters)
        else:
            result = self._conn.execute(stmt)
        return DictResult(result)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()

    def begin(self):
        return self._conn.begin()

    @property
    def raw(self):
        """Access the underlying SQLAlchemy connection."""
        return self._conn

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self._conn.close()


# ── Per-request connection (contextvars) ─────────────────

_request_conn: contextvars.ContextVar[DictConnection | None] = contextvars.ContextVar(
    '_request_conn', default=None
)


def set_request_connection(conn: DictConnection) -> contextvars.Token:
    """Set the per-request connection (called by middleware)."""
    return _request_conn.set(conn)


def get_request_connection() -> DictConnection | None:
    """Get the per-request connection, or None if outside request context."""
    return _request_conn.get()


def reset_request_connection(token: contextvars.Token) -> None:
    """Reset the context var (called by middleware in finally)."""
    _request_conn.reset(token)


# ── Public API ────────────────────────────────────────────


def get_connection() -> DictConnection:
    """Get a database connection with dict-like row access."""
    conn = engine.connect()
    return DictConnection(conn)


def create_tables():
    """Create all tables (IF NOT EXISTS)."""
    metadata.create_all(engine)


def now_expr():
    """Return the appropriate 'now' expression for the current dialect."""
    return text("CURRENT_TIMESTAMP")
