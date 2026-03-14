"""Database initialization, migrations, and seed data loading.

Uses SQLAlchemy Core for PostgreSQL compatibility. Schema is defined
in database.py; this module handles migrations and seeding.
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from sqlalchemy import inspect, text

from souschef.database import (
    DictConnection,
    create_tables,
    engine,
    get_connection,
    is_sqlite,
    metadata,
)

# Legacy exports for backward compat (some modules import DB_PATH)
_DEFAULT_DB = str(Path.home() / ".souschef" / "souschef.db")
DB_PATH = os.environ.get("SOUSCHEF_DB", _DEFAULT_DB)


def get_conn(db_path: str | None = None) -> DictConnection:
    """Get a database connection. db_path is ignored (kept for backward compat)."""
    return get_connection()


def init_db(conn: DictConnection) -> None:
    """Create tables and run additive migrations."""
    create_tables()

    # Additive migrations: add columns that may be missing on older databases.
    # SQLAlchemy's create_all handles new installs, but existing DBs need ALTER TABLE.
    _run_column_migrations(conn)

    # One-time data migrations
    _migrate_accepted_to_on_grocery(conn)
    _migrate_ratings_to_table(conn)
    _migrate_to_regulars(conn)
    _migrate_slots_to_meals(conn)
    _migrate_shopping_groups(conn)
    _migrate_regulars_default_inactive(conn)
    _migrate_grocery_to_trips(conn)
    _migrate_onboarding_marker(conn)
    _migrate_create_default_user(conn)
    _migrate_create_households(conn)
    _migrate_stores_to_db(conn)
    _migrate_default_user_id_rows(conn)
    _migrate_recipes_unique_constraint(conn)

    conn.commit()


def _run_column_migrations(conn: DictConnection) -> None:
    """Add columns that may be missing on older databases."""
    inspector = inspect(engine)

    # Map of table -> list of (column_name, column_def_sqlite, column_def_pg)
    # We check if the column exists first, then add it with the appropriate SQL.
    migrations = [
        ("ingredients", "root", "TEXT NOT NULL DEFAULT ''"),
        ("essentials", "search_term", "TEXT NOT NULL DEFAULT ''"),
        ("product_preferences", "source", "TEXT NOT NULL DEFAULT 'picked'"),
        ("product_preferences", "order_id", "TEXT NOT NULL DEFAULT ''"),
        ("product_preferences", "rating", "INTEGER NOT NULL DEFAULT 0"),
        ("grocery_lists", "start_date", "TEXT NOT NULL DEFAULT ''"),
        ("grocery_lists", "end_date", "TEXT NOT NULL DEFAULT ''"),
        ("meals", "on_grocery", "INTEGER NOT NULL DEFAULT 0"),
        ("trip_items", "ordered", "INTEGER NOT NULL DEFAULT 0"),
        ("trip_items", "ordered_at", "TEXT"),
        ("trip_items", "product_upc", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "product_name", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "product_brand", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "product_size", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "product_price", "REAL" if is_sqlite() else "DOUBLE PRECISION"),
        ("trip_items", "product_image", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "selected_at", "TEXT"),
        ("grocery_trips", "order_source", "TEXT NOT NULL DEFAULT 'none'"),
        ("grocery_trips", "receipt_data", "TEXT"),
        ("grocery_trips", "receipt_parsed_at", "TEXT"),
        ("trip_items", "receipt_item", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "receipt_price", "REAL" if is_sqlite() else "DOUBLE PRECISION"),
        ("trip_items", "receipt_upc", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "receipt_status", "TEXT NOT NULL DEFAULT ''"),
        ("learning_dismissed", "kind", "TEXT NOT NULL DEFAULT 'regular'"),
        ("meals", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("grocery_trips", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("regulars", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("pantry", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("product_preferences", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("learning_dismissed", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("meal_item_overrides", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("recipes", "user_id", "TEXT NOT NULL DEFAULT 'default'"),
        ("stores", "location_id", "TEXT NOT NULL DEFAULT ''"),
        ("recipes", "recipe_type", "TEXT NOT NULL DEFAULT 'meal'"),
        ("meals", "side_recipe_id", "INTEGER"),
    ]

    for table_name, col_name, col_def in migrations:
        try:
            existing = [c["name"] for c in inspector.get_columns(table_name)]
        except Exception:
            continue  # table doesn't exist
        if col_name not in existing:
            try:
                conn.execute(text(
                    f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_def}"
                ))
            except Exception:
                pass


def _migrate_accepted_to_on_grocery(conn: DictConnection) -> None:
    """One-time: accepted meals → on_grocery = 1."""
    try:
        conn.execute(text(
            "UPDATE meals SET on_grocery = 1, status = 'migrated' WHERE status = 'accepted'"
        ))
    except Exception:
        pass


def _migrate_ratings_to_table(conn: DictConnection) -> None:
    """Migrate ratings from product_preferences to product_ratings table."""
    try:
        rows = conn.execute(text(
            "SELECT upc, product_description, rating FROM product_preferences WHERE rating != 0"
        )).fetchall()
        for r in rows:
            try:
                conn.execute(text(
                    """INSERT INTO product_ratings (user_id, upc, product_description, rating)
                       VALUES ('default', :upc, :desc, :rating)
                       ON CONFLICT (user_id, upc) DO NOTHING"""
                ), {"upc": r["upc"], "desc": r["product_description"], "rating": r["rating"]})
            except Exception:
                pass
    except Exception:
        pass


def _migrate_to_regulars(conn: DictConnection) -> None:
    """One-time: merge essentials + pantry staples into regulars."""
    count = conn.execute(text("SELECT COUNT(*) AS n FROM regulars")).fetchone()
    if count["n"] > 0:
        return

    try:
        essentials_rows = conn.execute(text("SELECT * FROM essentials")).fetchall()
        for e in essentials_rows:
            ing = conn.execute(text(
                "SELECT id FROM ingredients WHERE LOWER(name) = LOWER(:name)"
            ), {"name": e["name"]}).fetchone()
            conn.execute(text(
                """INSERT INTO regulars (name, ingredient_id, shopping_group, store_pref, active)
                   VALUES (:name, :ing_id, :group, :store, :active)
                   ON CONFLICT (name) DO NOTHING"""
            ), {
                "name": e["name"],
                "ing_id": ing["id"] if ing else None,
                "group": e["shopping_group"],
                "store": e["store_pref"],
                "active": e["active"],
            })
    except Exception:
        pass

    try:
        staples = conn.execute(text(
            "SELECT id, name, aisle, store_pref FROM ingredients WHERE is_pantry_staple = 1"
        )).fetchall()
        for s in staples:
            conn.execute(text(
                """INSERT INTO regulars (name, ingredient_id, shopping_group, store_pref, active)
                   VALUES (:name, :ing_id, :group, :store, 1)
                   ON CONFLICT (name) DO NOTHING"""
            ), {
                "name": s["name"],
                "ing_id": s["id"],
                "group": s["aisle"] or "Other",
                "store": s["store_pref"],
            })
    except Exception:
        pass


def _migrate_slots_to_meals(conn: DictConnection) -> None:
    """One-time: convert meal_plan_slots to flat meals table."""
    from datetime import date, timedelta

    try:
        old_count = conn.execute(text(
            "SELECT COUNT(*) AS n FROM meal_plan_slots"
        )).fetchone()
        if old_count["n"] == 0:
            return
    except Exception:
        return

    new_count = conn.execute(text("SELECT COUNT(*) AS n FROM meals")).fetchone()
    if new_count["n"] > 0:
        return

    plans = conn.execute(text("SELECT id, week_of FROM meal_plans")).fetchall()
    for plan in plans:
        try:
            week_of = date.fromisoformat(plan["week_of"])
        except (ValueError, TypeError):
            continue

        slots = conn.execute(text(
            """SELECT s.*, COALESCE(r.name, '') AS rname
               FROM meal_plan_slots s
               LEFT JOIN recipes r ON r.id = s.recipe_id
               WHERE s.plan_id = :plan_id"""
        ), {"plan_id": plan["id"]}).fetchall()

        for slot in slots:
            slot_date = (week_of + timedelta(days=slot["day_of_week"])).isoformat()
            recipe_name = slot["rname"] or ""
            if not recipe_name and slot["day_of_week"] == 5:
                recipe_name = "Eating Out"

            conn.execute(text(
                """INSERT INTO meals
                   (slot_date, recipe_id, recipe_name, status, side, locked, is_followup)
                   VALUES (:slot_date, :recipe_id, :recipe_name, :status, :side, :locked, 0)
                   ON CONFLICT DO NOTHING"""
            ), {
                "slot_date": slot_date,
                "recipe_id": slot["recipe_id"],
                "recipe_name": recipe_name,
                "status": slot["status"],
                "side": slot["side"],
                "locked": slot["locked"],
            })

    # Migrate grocery_lists dates
    gl_rows = conn.execute(text(
        """SELECT gl.id, mp.week_of FROM grocery_lists gl
           JOIN meal_plans mp ON mp.id = gl.plan_id
           WHERE gl.start_date = ''"""
    )).fetchall()
    for gl in gl_rows:
        try:
            week_of = date.fromisoformat(gl["week_of"])
            end = (week_of + timedelta(days=6)).isoformat()
            conn.execute(text(
                "UPDATE grocery_lists SET start_date = :start, end_date = :end WHERE id = :id"
            ), {"start": gl["week_of"], "end": end, "id": gl["id"]})
        except (ValueError, TypeError):
            pass


_GROUP_REMAP = {
    "Fruit & Veggie": "Produce",
    "Dairy": "Dairy & Eggs",
    "Bread and Pasta": "Pasta & Grains",
    "Condiments": "Condiments & Sauces",
    "Cans and Soups": "Canned Goods",
    "Snacks and Other": "Snacks",
}

_BREAD_ITEMS = {
    "bread", "bun", "buns", "hamburger buns", "hot dog buns", "tortilla",
    "tortillas", "flour tortillas", "corn tortillas", "pita", "bagel",
    "rolls", "cornbread", "cornbread mix",
}

_SPICE_ITEMS = {
    "cumin", "chili powder", "paprika", "oregano", "cinnamon", "black pepper",
    "garlic powder", "onion powder", "cayenne", "nutmeg", "thyme", "basil",
    "seasoning", "sugar", "flour", "baking powder", "baking soda", "vanilla",
    "vanilla extract", "cocoa", "cocoa powder", "brown sugar", "powdered sugar",
    "all-purpose flour", "cornstarch",
}


def _migrate_shopping_groups(conn: DictConnection) -> None:
    """Remap old shopping group names to new ones."""
    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM ingredients WHERE aisle = 'Produce'"
    )).fetchone()
    if row["n"] > 0:
        return

    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM ingredients WHERE aisle = 'Fruit & Veggie'"
    )).fetchone()
    if row["n"] == 0:
        return

    for old_group, new_group in _GROUP_REMAP.items():
        conn.execute(text(
            "UPDATE ingredients SET aisle = :new WHERE aisle = :old"
        ), {"new": new_group, "old": old_group})

    for item in _BREAD_ITEMS:
        conn.execute(text(
            "UPDATE ingredients SET aisle = 'Bread & Bakery' WHERE LOWER(name) = :name AND aisle = 'Pasta & Grains'"
        ), {"name": item})

    for item in _SPICE_ITEMS:
        conn.execute(text(
            "UPDATE ingredients SET aisle = 'Spices & Baking' WHERE LOWER(name) = :name AND aisle IN ('Condiments & Sauces', 'Pasta & Grains', 'Other')"
        ), {"name": item})

    for old_group, new_group in _GROUP_REMAP.items():
        conn.execute(text(
            "UPDATE regulars SET shopping_group = :new WHERE shopping_group = :old"
        ), {"new": new_group, "old": old_group})

    for item in _BREAD_ITEMS:
        conn.execute(text(
            "UPDATE regulars SET shopping_group = 'Bread & Bakery' WHERE LOWER(name) = :name AND shopping_group = 'Pasta & Grains'"
        ), {"name": item})

    for item in _SPICE_ITEMS:
        conn.execute(text(
            "UPDATE regulars SET shopping_group = 'Spices & Baking' WHERE LOWER(name) = :name AND shopping_group IN ('Condiments & Sauces', 'Pasta & Grains', 'Other')"
        ), {"name": item})

    try:
        for old_group, new_group in _GROUP_REMAP.items():
            conn.execute(text(
                "UPDATE essentials SET shopping_group = :new WHERE shopping_group = :old"
            ), {"new": new_group, "old": old_group})
    except Exception:
        pass


def _migrate_regulars_default_inactive(conn: DictConnection) -> None:
    """One-time: flip all regulars to inactive."""
    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM regulars WHERE active = 0"
    )).fetchone()
    if row["n"] > 0:
        return
    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM regulars WHERE active = 1"
    )).fetchone()
    if row["n"] > 0:
        conn.execute(text("UPDATE regulars SET active = 0"))


def _migrate_grocery_to_trips(conn: DictConnection) -> None:
    """One-time: import file-based grocery state into grocery_trips."""
    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM grocery_trips"
    )).fetchone()
    if row["n"] > 0:
        return

    import json
    config_dir = Path.home() / ".souschef"
    saved_list = config_dir / "current_list.json"
    reconcile_file = config_dir / "reconcile_result.json"

    if not saved_list.exists():
        return

    try:
        with open(saved_list) as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return

    date_key = data.get("date_key", "")
    start_date = ""
    end_date = ""
    if "/" in date_key:
        parts = date_key.split("/")
        if len(parts) == 2:
            start_date, end_date = parts

    checked_names: set[str] = set()
    if reconcile_file.exists():
        try:
            with open(reconcile_file) as f:
                checked_names = {n.lower() for n in json.load(f).get("matched", [])}
        except (json.JSONDecodeError, IOError):
            pass

    result = conn.execute(text(
        """INSERT INTO grocery_trips (trip_type, start_date, end_date, active)
           VALUES ('plan', :start, :end, 1)
           RETURNING id"""
    ), {"start": start_date, "end": end_date})
    trip_id = result.fetchone()["id"]

    extras = data.get("extras", [])
    for name in extras:
        is_checked = 1 if name.lower() in checked_names else 0
        conn.execute(text(
            """INSERT INTO trip_items (trip_id, name, shopping_group, source, checked)
               VALUES (:trip_id, :name, 'Other', 'extra', :checked)
               ON CONFLICT DO NOTHING"""
        ), {"trip_id": trip_id, "name": name, "checked": is_checked})


def _migrate_onboarding_marker(conn: DictConnection) -> None:
    """One-time: move filesystem onboarding marker to settings table."""
    row = conn.execute(text(
        "SELECT 1 FROM settings WHERE key = 'onboarding_complete'"
    )).fetchone()
    if row:
        return

    marker = Path.home() / ".souschef" / "onboarding_complete"
    if marker.exists():
        # Will be updated to real user_id by _migrate_create_default_user
        conn.execute(text(
            """INSERT INTO settings (user_id, key, value, updated_at)
               VALUES ('default', 'onboarding_complete', 'true', CURRENT_TIMESTAMP)
               ON CONFLICT DO NOTHING"""
        ))


def _migrate_create_default_user(conn: DictConnection) -> None:
    """One-time: create a default user and assign all existing data."""
    row = conn.execute(text("SELECT 1 FROM users LIMIT 1")).fetchone()
    if row:
        return

    # Create default user
    conn.execute(text(
        """INSERT INTO users (id, email, display_name, created_at)
           VALUES ('default', 'owner@souschef.app', '', CURRENT_TIMESTAMP)"""
    ))

    # Add to whitelist
    conn.execute(text(
        """INSERT INTO allowed_emails (email)
           VALUES ('owner@souschef.app')
           ON CONFLICT DO NOTHING"""
    ))


def _migrate_create_households(conn: DictConnection) -> None:
    """One-time: create a household for every existing user who doesn't have one."""
    import uuid

    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM household_members"
    )).fetchone()
    if row["n"] > 0:
        return

    users = conn.execute(text("SELECT id FROM users")).fetchall()
    for u in users:
        hh_id = str(uuid.uuid4())
        conn.execute(text(
            """INSERT INTO household_members (household_id, user_id, role)
               VALUES (:hh_id, :user_id, 'owner')
               ON CONFLICT DO NOTHING"""
        ), {"hh_id": hh_id, "user_id": u["id"]})


def _migrate_stores_to_db(conn: DictConnection) -> None:
    """One-time: move filesystem stores.json into stores table."""
    row = conn.execute(text("SELECT 1 FROM stores LIMIT 1")).fetchone()
    if row:
        return

    import json
    stores_file = Path.home() / ".souschef" / "stores.json"
    if not stores_file.exists():
        return

    try:
        with open(stores_file) as f:
            stores = json.load(f)
    except (json.JSONDecodeError, IOError):
        return

    for s in stores:
        conn.execute(text(
            """INSERT INTO stores (user_id, name, key, mode, api)
               VALUES ('default', :name, :key, :mode, :api)
               ON CONFLICT DO NOTHING"""
        ), {"name": s["name"], "key": s["key"], "mode": s.get("mode", "in-person"), "api": s.get("api", "none")})


def _migrate_default_user_id_rows(conn: DictConnection) -> None:
    """One-time: reassign rows with user_id='default' to the first real user."""
    # Check if any 'default' rows exist
    row = conn.execute(text(
        "SELECT 1 FROM recipes WHERE user_id = 'default' LIMIT 1"
    )).fetchone()
    if not row:
        return

    # Find the first real user (oldest account)
    user = conn.execute(text(
        "SELECT id FROM users ORDER BY created_at ASC LIMIT 1"
    )).fetchone()
    if not user:
        return

    real_uid = user["id"]
    for table in ("recipes", "meals", "regulars", "pantry", "grocery_trips",
                  "product_preferences", "learning_dismissed", "meal_item_overrides", "stores"):
        try:
            conn.execute(
                text(f"UPDATE {table} SET user_id = :uid WHERE user_id = 'default'"),
                {"uid": real_uid},
            )
        except Exception:
            pass


def _migrate_recipes_unique_constraint(conn: DictConnection) -> None:
    """Drop global unique on recipes.name, add UNIQUE(name, user_id)."""
    try:
        conn.execute(text(
            "ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_name_key"
        ))
    except Exception:
        pass
    try:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS recipes_name_user_id_key ON recipes(name, user_id)"
        ))
    except Exception:
        pass


def _migrate_side_text_to_recipe_id(conn: DictConnection) -> None:
    """Backfill meals.side_recipe_id from meals.side text by looking up side recipes."""
    try:
        rows = conn.execute(text(
            """SELECT m.id, m.side, m.user_id FROM meals m
               WHERE m.side != '' AND m.side_recipe_id IS NULL"""
        )).fetchall()
    except Exception:
        return
    for r in rows:
        side_name = r["side"].strip()
        if not side_name:
            continue
        # Look up the side recipe for this user
        side_recipe = conn.execute(text(
            """SELECT id FROM recipes
               WHERE LOWER(name) = LOWER(:name) AND user_id = :user_id AND recipe_type = 'side'
               LIMIT 1"""
        ), {"name": side_name, "user_id": r["user_id"]}).fetchone()
        if side_recipe:
            conn.execute(text(
                "UPDATE meals SET side_recipe_id = :sid WHERE id = :mid"
            ), {"sid": side_recipe["id"], "mid": r["id"]})


# ── Seed Data ─────────────────────────────────────────────


def seed_from_yaml(conn: DictConnection, data_dir: str | None = None) -> None:
    if data_dir is None:
        data_dir = str(Path(__file__).resolve().parents[2] / "data")

    ingredients_file = Path(data_dir) / "seed_ingredients.yaml"
    recipes_file = Path(data_dir) / "seed_recipes.yaml"
    ingredient_db_file = Path(data_dir) / "seed_ingredient_database.yaml"
    common_recipes_file = Path(data_dir) / "seed_recipes_common.yaml"

    if ingredients_file.exists():
        _seed_ingredients(conn, ingredients_file)
    if ingredient_db_file.exists():
        _seed_ingredient_database(conn, ingredient_db_file)
    # Library recipes (user_id='__library__') loaded first
    if common_recipes_file.exists():
        _seed_recipes(conn, common_recipes_file, user_id="__library__")
    if recipes_file.exists():
        _seed_recipes(conn, recipes_file)

    # Backfill side_recipe_id on existing meals
    _migrate_side_text_to_recipe_id(conn)

    conn.commit()


def _seed_ingredients(conn: DictConnection, path: Path) -> None:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    for ing in data.get("ingredients", []):
        conn.execute(text(
            """INSERT INTO ingredients
               (name, category, aisle, default_unit, store_pref, is_pantry_staple, root)
               VALUES (:name, :category, :aisle, :unit, :store, :staple, :root)
               ON CONFLICT (name) DO NOTHING"""
        ), {
            "name": ing["name"],
            "category": ing.get("category", "pantry"),
            "aisle": ing.get("aisle", ""),
            "unit": ing.get("default_unit", "count"),
            "store": ing.get("store_pref", "either"),
            "staple": int(ing.get("is_pantry_staple", False)),
            "root": ing.get("root", ""),
        })


def _seed_ingredient_database(conn: DictConnection, path: Path) -> None:
    """Seed the canonical ingredient database (~600 common grocery items).

    Inserts ingredients that don't already exist (ON CONFLICT DO NOTHING by name).
    This runs after _seed_ingredients so family-specific entries take precedence.
    """
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    for ing in data.get("ingredients", []):
        conn.execute(text(
            """INSERT INTO ingredients (name, aisle, is_pantry_staple, root)
               VALUES (:name, :aisle, :staple, :root)
               ON CONFLICT (name) DO NOTHING"""
        ), {
            "name": ing["name"],
            "aisle": ing.get("aisle", "Other"),
            "staple": int(ing.get("is_pantry_staple", 0)),
            "root": ing.get("root", ""),
        })


def _seed_recipes(conn: DictConnection, path: Path, user_id: str | None = None) -> None:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    for rec in data.get("recipes", []):
        params = {
            "name": rec["name"],
            "cuisine": rec.get("cuisine", "any"),
            "effort": rec.get("effort", "medium"),
            "cleanup": rec.get("cleanup", "medium"),
            "outdoor": int(rec.get("outdoor", False)),
            "kid": int(rec.get("kid_friendly", True)),
            "premade": int(rec.get("premade", False)),
            "prep": rec.get("prep_minutes", 0),
            "cook": rec.get("cook_minutes", 0),
            "servings": rec.get("servings", 4),
            "notes": rec.get("notes", ""),
            "recipe_type": rec.get("recipe_type", "meal"),
        }
        if user_id:
            params["user_id"] = user_id
            result = conn.execute(text(
                """INSERT INTO recipes
                   (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
                    prep_minutes, cook_minutes, servings, notes, recipe_type, user_id)
                   VALUES (:name, :cuisine, :effort, :cleanup, :outdoor, :kid, :premade,
                            :prep, :cook, :servings, :notes, :recipe_type, :user_id)
                   ON CONFLICT (name, user_id) DO NOTHING
                   RETURNING id"""
            ), params)
        else:
            result = conn.execute(text(
                """INSERT INTO recipes
                   (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
                    prep_minutes, cook_minutes, servings, notes, recipe_type)
                   VALUES (:name, :cuisine, :effort, :cleanup, :outdoor, :kid, :premade,
                            :prep, :cook, :servings, :notes, :recipe_type)
                   ON CONFLICT (name, user_id) DO NOTHING
                   RETURNING id"""
            ), params)

        row = result.fetchone()
        if row is None:
            continue

        recipe_id = row["id"]
        for item in rec.get("ingredients", []):
            ing_row = conn.execute(text(
                "SELECT id FROM ingredients WHERE name = :name"
            ), {"name": item["name"]}).fetchone()
            if ing_row is None:
                continue
            conn.execute(text(
                """INSERT INTO recipe_ingredients
                   (recipe_id, ingredient_id, quantity, unit, prep_note, component)
                   VALUES (:recipe_id, :ing_id, :qty, :unit, :prep, :comp)"""
            ), {
                "recipe_id": recipe_id,
                "ing_id": ing_row["id"],
                "qty": item.get("quantity", 1),
                "unit": item.get("unit", "count"),
                "prep": item.get("prep_note", ""),
                "comp": item.get("component", ""),
            })


def _seed_library_if_missing(conn: DictConnection) -> None:
    """Seed library recipes on existing databases that don't have them yet."""
    row = conn.execute(text(
        "SELECT COUNT(*) AS n FROM recipes WHERE user_id = '__library__'"
    )).fetchone()
    if row["n"] > 0:
        return
    data_dir = str(Path(__file__).resolve().parents[2] / "data")
    common_file = Path(data_dir) / "seed_recipes_common.yaml"
    if common_file.exists():
        _seed_recipes(conn, common_file, user_id="__library__")
        _migrate_side_text_to_recipe_id(conn)
        conn.commit()


_db_initialized = False


def ensure_db(db_path: str | None = None) -> DictConnection:
    """Create tables, run migrations, seed if empty. Returns a connection."""
    global _db_initialized
    conn = get_connection()
    if not _db_initialized:
        try:
            init_db(conn)
            row = conn.execute(text("SELECT COUNT(*) AS n FROM recipes")).fetchone()
            if row["n"] == 0:
                seed_from_yaml(conn)
            else:
                # Ensure library recipes exist even on existing databases
                _seed_library_if_missing(conn)
            _db_initialized = True
        except Exception as e:
            print(f"[db] ensure_db error: {e}")
            import traceback
            traceback.print_exc()
            raise
    return conn
