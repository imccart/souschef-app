"""Database initialization, migrations, and seed data loading.

Uses SQLAlchemy Core for PostgreSQL compatibility. Schema is defined
in database.py; this module handles migrations and seeding.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from sqlalchemy import text

from souschef.database import (
    DictConnection,
    create_tables,
    engine,
    get_connection,
    metadata,
)



def get_conn(db_path: str | None = None) -> DictConnection:
    """Get a database connection. db_path is ignored (kept for backward compat)."""
    return get_connection()


def init_db(conn: DictConnection) -> None:
    """Create tables and run additive migrations.

    On an established DB, create_tables() and data migrations are all no-ops
    but they still do schema introspection that can hang if the old instance
    holds locks. We check if the DB is already set up and skip them.
    """
    # Check if DB is already established (has users table with data)
    try:
        row = conn.execute(text("SELECT 1 FROM users LIMIT 1")).fetchone()
        db_exists = row is not None
    except Exception:
        db_exists = False

    if not db_exists:
        # Fresh DB — run full init
        print("[db] Fresh DB, creating tables...", flush=True)
        create_tables()
        print("[db] Tables created", flush=True)

        print("[db] Running data migrations...", flush=True)
        for name, fn in [
            ("accepted_to_on_grocery", _migrate_accepted_to_on_grocery),
            ("ratings_to_table", _migrate_ratings_to_table),
            ("to_regulars", _migrate_to_regulars),
            ("slots_to_meals", _migrate_slots_to_meals),
            ("shopping_groups", _migrate_shopping_groups),
            ("regulars_default_inactive", _migrate_regulars_default_inactive),
            ("grocery_to_trips", _migrate_grocery_to_trips),
            ("onboarding_marker", _migrate_onboarding_marker),
            ("create_default_user", _migrate_create_default_user),
            ("create_households", _migrate_create_households),
            ("stores_to_db", _migrate_stores_to_db),
            ("default_user_id_rows", _migrate_default_user_id_rows),
            ("recipes_unique_constraint", _migrate_recipes_unique_constraint),
            ("sides_to_junction", _migrate_sides_to_junction),
        ]:
            print(f"[db] Migration: {name}...", flush=True)
            fn(conn)
        conn.commit()
    else:
        print("[db] DB exists, skipping create_tables and data migrations", flush=True)

    # Column migrations always run (idempotent, fast with IF NOT EXISTS)
    print("[db] Running column migrations...", flush=True)
    _run_column_migrations(conn)
    print("[db] Column migrations done", flush=True)

    print("[db] init_db complete", flush=True)


def _run_column_migrations(conn: DictConnection) -> None:
    """Add columns that may be missing on older databases.

    Uses ADD COLUMN IF NOT EXISTS (PostgreSQL 9.6+) to avoid needing
    the inspector, which can hang when the old instance holds locks.
    Sets a short lock_timeout so ALTER TABLE fails fast instead of blocking.
    """
    # Only new columns that don't yet exist in production.
    # Old columns (pre-session 20) are already in the DB — no need to re-attempt.
    # When adding columns in the future, add them here and remove them once
    # confirmed deployed (they become part of the schema in database.py).
    migrations = [
        ("trip_items", "skipped", "INTEGER NOT NULL DEFAULT 0"),
        ("trip_items", "skipped_at", "TEXT"),
        ("trip_items", "have_it", "INTEGER NOT NULL DEFAULT 0"),
        ("trip_items", "have_it_at", "TEXT"),
        ("trip_items", "added_at", "TEXT DEFAULT CURRENT_TIMESTAMP"),
        ("grocery_trips", "regulars_added", "INTEGER NOT NULL DEFAULT 0"),
        ("grocery_trips", "regulars_added_at", "TEXT"),
        ("grocery_trips", "pantry_checked", "INTEGER NOT NULL DEFAULT 0"),
        ("grocery_trips", "pantry_checked_at", "TEXT"),
        ("trip_items", "quantity", "INTEGER NOT NULL DEFAULT 1"),
        ("trip_items", "submitted_at", "TEXT"),
        ("product_preferences", "brand", "TEXT NOT NULL DEFAULT ''"),
        ("product_preferences", "product_key", "TEXT NOT NULL DEFAULT ''"),
        ("product_ratings", "brand", "TEXT NOT NULL DEFAULT ''"),
        ("product_ratings", "product_key", "TEXT NOT NULL DEFAULT ''"),
        ("grocery_trips", "stale_checked", "INTEGER NOT NULL DEFAULT 0"),
        ("grocery_trips", "stale_checked_at", "TEXT"),
        ("meals", "notes", "TEXT NOT NULL DEFAULT ''"),
        ("trip_items", "notes", "TEXT NOT NULL DEFAULT ''"),
    ]

    for table_name, col_name, col_def in migrations:
        try:
            conn.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_name} {col_def}"
            ))
            conn.commit()
        except Exception as e:
            print(f"[db]   {table_name}.{col_name} skipped: {e}", flush=True)
            try:
                conn.raw.rollback()
            except Exception:
                pass

    # Create receipt_extra_items table if missing
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS receipt_extra_items (
                id SERIAL PRIMARY KEY,
                trip_id INTEGER NOT NULL REFERENCES grocery_trips(id),
                item_name TEXT NOT NULL,
                price FLOAT,
                upc TEXT NOT NULL DEFAULT '',
                brand TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()
    except Exception as e:
        print(f"[db]   receipt_extra_items table skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Create brand_ownership table if missing
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS brand_ownership (
                id SERIAL PRIMARY KEY,
                brand TEXT NOT NULL UNIQUE,
                parent_company TEXT
            )
        """))
        conn.commit()
    except Exception as e:
        print(f"[db]   brand_ownership table skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Create company_violations table if missing
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS company_violations (
                id SERIAL PRIMARY KEY,
                parent_company TEXT NOT NULL,
                agency TEXT NOT NULL,
                total_records INTEGER NOT NULL DEFAULT 0,
                class_i INTEGER NOT NULL DEFAULT 0,
                class_ii INTEGER NOT NULL DEFAULT 0,
                class_iii INTEGER NOT NULL DEFAULT 0,
                most_recent_date TEXT,
                refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(parent_company, agency)
            )
        """))
        conn.commit()
    except Exception as e:
        print(f"[db]   company_violations table skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Backfill product_key from upc where missing
    try:
        conn.execute(text(
            "UPDATE product_preferences SET product_key = upc WHERE product_key = '' AND upc != ''"
        ))
        conn.commit()
    except Exception:
        try:
            conn.raw.rollback()
        except Exception:
            pass
    try:
        conn.execute(text(
            "UPDATE product_ratings SET product_key = upc WHERE product_key = '' AND upc != ''"
        ))
        conn.commit()
    except Exception:
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Swap unique constraints: old (search_term, upc) / (user_id, upc) → new product_key-based
    _migrate_product_key_constraints(conn)


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
                pk = r["upc"] or ""
                conn.execute(text(
                    """INSERT INTO product_ratings (user_id, upc, product_description, rating, product_key)
                       VALUES ('default', :upc, :desc, :rating, :pk)
                       ON CONFLICT (user_id, product_key) DO NOTHING"""
                ), {"upc": r["upc"], "desc": r["product_description"], "rating": r["rating"], "pk": pk})
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
    # Find and drop any unique constraint/index on recipes.name alone
    try:
        rows = conn.execute(text("""
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_attribute att ON att.attrelid = con.conrelid
            JOIN unnest(con.conkey) AS cols(colnum) ON att.attnum = cols.colnum
            WHERE rel.relname = 'recipes'
              AND con.contype = 'u'
              AND att.attname = 'name'
            GROUP BY con.conname
            HAVING COUNT(*) = 1
        """)).fetchall()
        for row in rows:
            conn.execute(text(f'ALTER TABLE recipes DROP CONSTRAINT "{row[0]}"'))
    except Exception:
        pass
    # Also drop any unique index on just name
    try:
        rows = conn.execute(text("""
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'recipes'
              AND indexdef LIKE '%UNIQUE%'
              AND indexdef LIKE '%(name)%'
              AND indexdef NOT LIKE '%(name, user_id)%'
        """)).fetchall()
        for row in rows:
            conn.execute(text(f'DROP INDEX IF EXISTS "{row[0]}"'))
    except Exception:
        pass
    try:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS recipes_name_user_id_key ON recipes(name, user_id)"
        ))
    except Exception:
        pass


def _migrate_sides_to_junction(conn: DictConnection) -> None:
    """Move side data from meals columns to meal_sides junction table."""
    # Check if meal_sides already has data (idempotent)
    try:
        row = conn.execute(text("SELECT COUNT(*) AS n FROM meal_sides")).fetchone()
        if row["n"] > 0:
            return
    except Exception:
        return  # table doesn't exist yet

    # Check if old columns exist
    try:
        rows = conn.execute(text(
            "SELECT id, side, side_recipe_id FROM meals WHERE (side != '' AND side IS NOT NULL) OR side_recipe_id IS NOT NULL"
        )).fetchall()
    except Exception:
        return  # old columns don't exist

    for r in rows:
        side_name = r["side"] or ""
        side_recipe_id = r["side_recipe_id"]
        if side_name or side_recipe_id:
            conn.execute(text(
                "INSERT INTO meal_sides (meal_id, side_recipe_id, side_name, position) VALUES (:meal_id, :sid, :sname, 0)"
            ), {"meal_id": r["id"], "sid": side_recipe_id, "sname": side_name})


def _migrate_product_key_constraints(conn: DictConnection) -> None:
    """Swap old unique constraints to product_key-based ones (idempotent)."""
    # Drop old constraint on product_preferences (search_term, upc)
    try:
        rows = conn.execute(text("""
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'product_preferences'
              AND con.contype = 'u'
        """)).fetchall()
        for row in rows:
            name = row["conname"]
            # Drop old constraints that are NOT the new one
            if "product_key" not in name:
                conn.execute(text(f'ALTER TABLE product_preferences DROP CONSTRAINT IF EXISTS "{name}"'))
        conn.commit()
    except Exception as e:
        print(f"[db]   product_preferences constraint drop skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Drop old constraint on product_ratings (user_id, upc)
    try:
        rows = conn.execute(text("""
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            WHERE rel.relname = 'product_ratings'
              AND con.contype = 'u'
        """)).fetchall()
        for row in rows:
            name = row["conname"]
            if "product_key" not in name:
                conn.execute(text(f'ALTER TABLE product_ratings DROP CONSTRAINT IF EXISTS "{name}"'))
        conn.commit()
    except Exception as e:
        print(f"[db]   product_ratings constraint drop skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass

    # Create new constraints
    try:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS product_preferences_user_search_key "
            "ON product_preferences(user_id, search_term, product_key)"
        ))
        conn.commit()
    except Exception as e:
        print(f"[db]   product_preferences new constraint skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass
    try:
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS product_ratings_user_key "
            "ON product_ratings(user_id, product_key)"
        ))
        conn.commit()
    except Exception as e:
        print(f"[db]   product_ratings new constraint skipped: {e}", flush=True)
        try:
            conn.raw.rollback()
        except Exception:
            pass


# ── Seed Data ─────────────────────────────────────────────


def seed_from_yaml(conn: DictConnection, data_dir: str | None = None) -> None:
    if data_dir is None:
        data_dir = str(Path(__file__).resolve().parents[2] / "data")

    ingredients_file = Path(data_dir) / "seed_ingredients.yaml"
    recipes_file = Path(data_dir) / "seed_recipes.yaml"
    ingredient_db_file = Path(data_dir) / "seed_ingredient_database.yaml"
    common_recipes_file = Path(data_dir) / "seed_recipes_common.yaml"
    brand_file = Path(data_dir) / "brand_ownership.yaml"

    if ingredients_file.exists():
        _seed_ingredients(conn, ingredients_file)
    if ingredient_db_file.exists():
        _seed_ingredient_database(conn, ingredient_db_file)
    if brand_file.exists():
        _seed_brand_ownership(conn, brand_file)
    # Library recipes (user_id='__library__') loaded first
    if common_recipes_file.exists():
        _seed_recipes(conn, common_recipes_file, user_id="__library__")
    if recipes_file.exists():
        _seed_recipes(conn, recipes_file)

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


def _seed_brand_ownership(conn: DictConnection, path: Path) -> None:
    """Seed brand ownership from YAML into the brand_ownership table.

    Idempotent — ON CONFLICT DO NOTHING so manual DB edits take precedence.
    """
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    for entry in data.get("brands", []):
        brand = entry.get("brand", "").strip()
        if not brand:
            continue
        parent = entry.get("parent")  # None means self-owned
        conn.execute(text(
            """INSERT INTO brand_ownership (brand, parent_company)
               VALUES (:brand, :parent)
               ON CONFLICT (brand) DO NOTHING"""
        ), {"brand": brand, "parent": parent})


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
                   ON CONFLICT DO NOTHING
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
        try:
            _seed_recipes(conn, common_file, user_id="__library__")
            conn.commit()
        except Exception as e:
            print(f"[db] _seed_library_if_missing failed: {e}", flush=True)
            # Don't crash the app — library recipes are nice-to-have
            try:
                conn.rollback()
            except Exception:
                pass


_db_initialized = False


def _kill_stale_connections(conn: DictConnection) -> None:
    """Terminate idle-in-transaction connections from previous deploys.

    These hold shared locks that block ALTER TABLE migrations, causing
    cascading lock waits and failed health checks on redeploy.
    """
    try:
        rows = conn.execute(text("""
            SELECT pid FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid != pg_backend_pid()
              AND state = 'idle in transaction'
        """)).fetchall()
        for row in rows:
            conn.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": row["pid"]})
        if rows:
            print(f"[db] Terminated {len(rows)} stale connections", flush=True)
    except Exception:
        pass  # Best-effort — don't block startup if this fails


def ensure_db(db_path: str | None = None) -> DictConnection:
    """Create tables, run migrations, seed if empty. Returns a connection."""
    global _db_initialized
    conn = get_connection()
    if not _db_initialized:
        _kill_stale_connections(conn)

        # Set statement_timeout so migrations fail fast if old instance holds locks.
        try:
            conn.execute(text("SET statement_timeout = '5000'"))
            conn.commit()
        except Exception:
            pass

        try:
            init_db(conn)
            row = conn.execute(text("SELECT COUNT(*) AS n FROM recipes")).fetchone()
            if row["n"] == 0:
                seed_from_yaml(conn)
            else:
                data_dir = str(Path(__file__).resolve().parents[2] / "data")
                ing_db = Path(data_dir) / "seed_ingredient_database.yaml"
                if ing_db.exists():
                    _seed_ingredient_database(conn, ing_db)
                    conn.commit()
                brand_file = Path(data_dir) / "brand_ownership.yaml"
                if brand_file.exists():
                    _seed_brand_ownership(conn, brand_file)
                    conn.commit()
                _seed_library_if_missing(conn)
        except Exception as e:
            print(f"[db] ensure_db error (non-fatal): {e}", flush=True)
            try:
                conn.raw.rollback()
            except Exception:
                pass

        try:
            conn.execute(text("SET statement_timeout = '0'"))
            conn.commit()
        except Exception:
            try:
                conn.raw.rollback()
            except Exception:
                pass
        # Refresh FDA violation data (non-fatal, runs after timeout is cleared)
        try:
            from souschef.violations import refresh_fda_data
            print("[db] Refreshing FDA violation data...", flush=True)
            result = refresh_fda_data(conn)
            print(f"[db] FDA refresh: {result['updated']} companies updated, {result['errors']} errors", flush=True)
        except Exception as e:
            print(f"[db] FDA refresh error (non-fatal): {e}", flush=True)
            try:
                conn.raw.rollback()
            except Exception:
                pass

        _db_initialized = True
    return conn
