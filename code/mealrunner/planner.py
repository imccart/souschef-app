"""Meal plan generation engine — date-based flat model."""

from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import text

from mealrunner.database import DictConnection
from mealrunner.models import Meal, MealSide, MealWeek
from mealrunner.recipes import filter_recipes, get_recipe_by_name

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]




# ── Date helpers ─────────────────────────────────────────

def get_current_week_monday() -> str:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat()


def week_range(start: str | None = None) -> tuple[str, str]:
    """Return (monday, sunday) ISO dates for the week containing start."""
    if start is None:
        monday = date.fromisoformat(get_current_week_monday())
    else:
        d = date.fromisoformat(start)
        monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def rolling_range(days: int = 10) -> tuple[str, str]:
    """Return (today, today+days-1) ISO dates for the rolling window."""
    today = date.today()
    end = today + timedelta(days=days - 1)
    return today.isoformat(), end.isoformat()


def load_rolling_week(conn: DictConnection, user_id: str, days: int = 10) -> MealWeek:
    """Load a MealWeek for the rolling window starting today."""
    s, e = rolling_range(days)
    meals = load_meals(conn, user_id, s, e)
    return MealWeek(start_date=s, end_date=e, meals=meals)


def _resolve_side(conn: DictConnection, user_id: str, side_name: str) -> int:
    """Find or create a side recipe by name. Returns recipe ID."""
    row = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = :name AND user_id = :uid AND recipe_type = 'side'"),
        {"name": side_name.lower(), "uid": user_id},
    ).fetchone()
    if row:
        return row["id"]
    # Title-case for storage
    stored_name = side_name.strip().title()
    # Use ON CONFLICT to handle concurrent requests
    cur = conn.execute(
        text("""INSERT INTO recipes (name, user_id, recipe_type, effort, cleanup)
           VALUES (:name, :uid, 'side', 'easy', 'easy')
           ON CONFLICT (name, user_id) DO NOTHING RETURNING id"""),
        {"name": stored_name, "uid": user_id},
    )
    result = cur.fetchone()
    if result:
        _auto_add_side_ingredient(conn, result["id"], stored_name)
        return result["id"]
    # Race: another request created it first — re-fetch
    row = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = :name AND user_id = :uid AND recipe_type = 'side'"),
        {"name": side_name.lower(), "uid": user_id},
    ).fetchone()
    return row["id"]


def _auto_add_side_ingredient(conn: DictConnection, recipe_id: int, side_name: str) -> None:
    """Auto-link a matching ingredient when the side name IS the ingredient (e.g., Corn → corn)."""
    ingredient_name = side_name.lower()
    row = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = :name"),
        {"name": ingredient_name},
    ).fetchone()
    if not row:
        # Try normalization (e.g., "roasted broccoli" → "broccoli")
        from mealrunner.normalize import normalize_item_name
        _canonical, matched_id = normalize_item_name(conn, ingredient_name)
        if matched_id:
            ingredient_id = matched_id
        else:
            return  # No known ingredient — user adds manually
    else:
        ingredient_id = row["id"]
    # Link to recipe if not already linked
    existing = conn.execute(
        text("SELECT id FROM recipe_ingredients WHERE recipe_id = :rid AND ingredient_id = :iid"),
        {"rid": recipe_id, "iid": ingredient_id},
    ).fetchone()
    if not existing:
        conn.execute(
            text("INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES (:rid, :iid, 1, 'count')"),
            {"rid": recipe_id, "iid": ingredient_id},
        )


def _assign_side(conn: DictConnection, user_id: str, used_side_ids: list[int]) -> tuple[int | None, str]:
    """Pick a random side recipe from user's sides, avoiding recently used ones.
    Returns (side_recipe_id, side_name)."""
    rows = conn.execute(
        text("SELECT id, name FROM recipes WHERE user_id = :uid AND recipe_type = 'side'"),
        {"uid": user_id},
    ).fetchall()
    if not rows:
        return None, ""
    available = [r for r in rows if r["id"] not in used_side_ids]
    if not available:
        available = list(rows)
    pick = random.choice(available)
    return pick["id"], pick["name"]


# ── Load / save meals ───────────────────────────────────

def load_meals(conn: DictConnection, user_id: str, start_date: str, end_date: str) -> list[Meal]:
    """Load all meals in a date range."""
    rows = conn.execute(
        text("""SELECT m.*, COALESCE(r.name, m.recipe_name) AS rname
           FROM meals m
           LEFT JOIN recipes r ON r.id = m.recipe_id
           WHERE m.user_id = :user_id AND m.slot_date BETWEEN :start_date AND :end_date
           ORDER BY m.slot_date"""),
        {"user_id": user_id, "start_date": start_date, "end_date": end_date},
    ).fetchall()
    meals = []
    for r in rows:
        try:
            notes = r["notes"]
        except (KeyError, Exception):
            notes = ""
        meals.append(Meal(
            id=r["id"], slot_date=r["slot_date"], recipe_id=r["recipe_id"],
            recipe_name=r["rname"] or "", status=r["status"],
            locked=bool(r["locked"]),
            is_followup=bool(r["is_followup"]),
            on_grocery=bool(r["on_grocery"]),
            created_at=r["created_at"],
            notes=notes or "",
        ))
    # Bulk-load sides from junction table
    meal_ids = [m.id for m in meals if m.id]
    if meal_ids:
        placeholders = ",".join(str(mid) for mid in meal_ids)
        side_rows = conn.execute(
            text(f"SELECT * FROM meal_sides WHERE meal_id IN ({placeholders}) ORDER BY meal_id, position"),
        ).fetchall()
        sides_by_meal: dict[int, list[MealSide]] = {}
        for sr in side_rows:
            sides_by_meal.setdefault(sr["meal_id"], []).append(
                MealSide(id=sr["id"], side_recipe_id=sr["side_recipe_id"],
                         side_name=sr["side_name"], position=sr["position"])
            )
        for m in meals:
            if m.id in sides_by_meal:
                m.sides = sides_by_meal[m.id]
    return meals



def save_meals(conn: DictConnection, user_id: str, meals: list[Meal]) -> list[Meal]:
    """Insert or update meals."""
    for meal in meals:
        if meal.id:
            conn.execute(
                text("""UPDATE meals SET recipe_id = :recipe_id, recipe_name = :recipe_name, status = :status,
                   locked = :locked, is_followup = :is_followup, on_grocery = :on_grocery, notes = :notes
                   WHERE id = :id AND user_id = :user_id"""),
                {"recipe_id": meal.recipe_id, "recipe_name": meal.recipe_name, "status": meal.status,
                 "locked": int(meal.locked),
                 "is_followup": int(meal.is_followup),
                 "on_grocery": int(meal.on_grocery), "notes": meal.notes, "id": meal.id, "user_id": user_id},
            )
        else:
            cur = conn.execute(
                text("""INSERT INTO meals (user_id, slot_date, recipe_id, recipe_name, status, locked, is_followup, on_grocery, notes)
                   VALUES (:user_id, :slot_date, :recipe_id, :recipe_name, :status, :locked, :is_followup, :on_grocery, :notes)
                   RETURNING id"""),
                {"user_id": user_id, "slot_date": meal.slot_date, "recipe_id": meal.recipe_id, "recipe_name": meal.recipe_name,
                 "status": meal.status, "locked": int(meal.locked),
                 "is_followup": int(meal.is_followup), "on_grocery": int(meal.on_grocery), "notes": meal.notes},
            )
            meal.id = cur.fetchone()["id"]
        # Sync sides to junction table
        _save_meal_sides(conn, meal)
    conn.commit()
    return meals


def _save_meal_sides(conn: DictConnection, meal: Meal) -> None:
    """Sync meal_sides rows for a meal (delete + reinsert)."""
    if not meal.id:
        return
    conn.execute(text("DELETE FROM meal_sides WHERE meal_id = :mid"), {"mid": meal.id})
    for i, side in enumerate(meal.sides):
        cur = conn.execute(
            text("""INSERT INTO meal_sides (meal_id, side_recipe_id, side_name, position)
               VALUES (:mid, :sid, :sname, :pos) RETURNING id"""),
            {"mid": meal.id, "sid": side.side_recipe_id, "sname": side.side_name, "pos": i},
        )
        side.id = cur.fetchone()["id"]
        side.position = i


def save_meal(conn: DictConnection, user_id: str, meal: Meal) -> Meal:
    """Save a single meal."""
    return save_meals(conn, user_id, [meal])[0]


# ── Rotation history ────────────────────────────────────

def _get_recent_recipe_ids(conn: DictConnection, user_id: str, before_date: str,
                           lookback_days: int = 14) -> set[int]:
    """Get recipe IDs from recent accepted meals to avoid repeats."""
    cutoff = (date.fromisoformat(before_date) - timedelta(days=lookback_days)).isoformat()
    rows = conn.execute(
        text("""SELECT DISTINCT recipe_id FROM meals
           WHERE user_id = :user_id AND slot_date < :before_date AND slot_date >= :cutoff AND recipe_id IS NOT NULL"""),
        {"user_id": user_id, "before_date": before_date, "cutoff": cutoff},
    ).fetchall()
    return {r["recipe_id"] for r in rows}


def get_last_made(conn: DictConnection, user_id: str, recipe_id: int) -> str | None:
    """Return the most recent slot_date this recipe was used, or None."""
    row = conn.execute(
        text("SELECT MAX(slot_date) AS last FROM meals WHERE user_id = :user_id AND recipe_id = :recipe_id"),
        {"user_id": user_id, "recipe_id": recipe_id},
    ).fetchone()
    return row["last"] if row and row["last"] else None


def get_last_made_map(conn: DictConnection, user_id: str) -> dict[int, str]:
    """Return {recipe_id: last_slot_date} for all recipes ever used."""
    rows = conn.execute(
        text("SELECT recipe_id, MAX(slot_date) AS last FROM meals WHERE user_id = :user_id AND recipe_id IS NOT NULL GROUP BY recipe_id"),
        {"user_id": user_id},
    ).fetchall()
    return {r["recipe_id"]: r["last"] for r in rows}


# ── Swap / edit operations ──────────────────────────────

def swap_dates(conn: DictConnection, user_id: str, date_a: str, date_b: str) -> list[Meal]:
    """Swap meals between two dates by moving slot_date, not by swapping
    recipe attributes between two meal rows. Preserving each meal's id keeps
    grocery_items.meal_ids stable across the swap, so _refresh_trip_meal_items
    doesn't see the swap as a new occurrence and re-surface ingredients the
    user already bought / checked off.
    """
    row_a = conn.execute(
        text("SELECT id FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": date_a},
    ).fetchone()
    row_b = conn.execute(
        text("SELECT id FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": date_b},
    ).fetchone()
    id_a = row_a["id"] if row_a else None
    id_b = row_b["id"] if row_b else None

    if id_a and id_b:
        conn.execute(text("UPDATE meals SET slot_date = :d WHERE id = :id"),
                     {"d": date_b, "id": id_a})
        conn.execute(text("UPDATE meals SET slot_date = :d WHERE id = :id"),
                     {"d": date_a, "id": id_b})
    elif id_a:
        conn.execute(text("UPDATE meals SET slot_date = :d WHERE id = :id"),
                     {"d": date_b, "id": id_a})
    elif id_b:
        conn.execute(text("UPDATE meals SET slot_date = :d WHERE id = :id"),
                     {"d": date_a, "id": id_b})
    conn.commit()

    s, e = week_range(date_a)
    return load_meals(conn, user_id, s, e)


def set_meal(
    conn: DictConnection, user_id: str, slot_date: str, recipe_name: str,
    sides: list[dict] | None = None,
) -> Meal | str:
    """Manually set a date's recipe by name. No rule enforcement.

    sides: list of {"side_recipe_id": int|None, "side_name": str} dicts, max 3.
           If None, auto-assigns one random side.
    """
    recipe = get_recipe_by_name(conn, recipe_name, user_id=user_id)
    if recipe is None:
        row = conn.execute(
            text("SELECT * FROM recipes WHERE name LIKE :pattern AND user_id = :user_id ORDER BY name LIMIT 1"),
            {"pattern": f"%{recipe_name}%", "user_id": user_id},
        ).fetchone()
        if row:
            from mealrunner.recipes import get_recipe
            recipe = get_recipe(conn, row["id"])
        if recipe is None:
            return f"Recipe '{recipe_name}' not found."

    existing = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    ).fetchone()
    if existing and existing["recipe_id"] == recipe.id:
        # Same recipe — re-save in place. Preserves meal.id so the grocery sync
        # treats this as the same occurrence (state on shared ingredients sticks).
        meal = _row_to_meal(existing)
        side_rows = conn.execute(
            text("SELECT * FROM meal_sides WHERE meal_id = :mid ORDER BY position"),
            {"mid": meal.id},
        ).fetchall()
        meal.sides = [MealSide(id=sr["id"], side_recipe_id=sr["side_recipe_id"],
                               side_name=sr["side_name"], position=sr["position"]) for sr in side_rows]
    else:
        # Different recipe (or empty slot) — delete the existing meal and any
        # sides (CASCADE) and create a fresh one. New meal.id means the grocery
        # sync sees this as a new meal occurrence and re-derives ingredient
        # state from scratch (have_it / removed don't carry over from the
        # prior recipe).
        if existing:
            conn.execute(
                text("DELETE FROM meals WHERE id = :id"),
                {"id": existing["id"]},
            )
            conn.commit()
        meal = Meal(id=None, slot_date=slot_date)

    meal.recipe_id = recipe.id
    meal.recipe_name = recipe.name
    meal.is_followup = False
    meal.on_grocery = True

    if sides is not None:
        # User explicitly chose sides (may be empty list = no sides)
        resolved = []
        for i, s in enumerate(sides[:3]):
            sid = s.get("side_recipe_id")
            sname = s.get("side_name", "")
            if not sid and sname:
                sid = _resolve_side(conn, user_id, sname)
            resolved.append(MealSide(id=None, side_recipe_id=sid, side_name=sname, position=i))
        meal.sides = resolved
    else:
        # Auto-assign a random side
        s, e = rolling_range()
        week_meals = load_meals(conn, user_id, s, e)
        used_side_ids = [sd.side_recipe_id for m in week_meals if m.slot_date != slot_date for sd in m.sides if sd.side_recipe_id]
        sid, sname = _assign_side(conn, user_id, used_side_ids)
        if sid or sname:
            meal.sides = [MealSide(id=None, side_recipe_id=sid, side_name=sname, position=0)]
        else:
            meal.sides = []

    save_meal(conn, user_id, meal)
    return meal


def remove_meal(conn: DictConnection, user_id: str, slot_date: str) -> None:
    """Remove a meal from a date entirely."""
    conn.execute(
        text("DELETE FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    )
    conn.commit()


def set_freeform_meal(conn: DictConnection, user_id: str, slot_date: str, name: str) -> Meal:
    """Set a freeform meal (no recipe) like 'Eating Out' or 'Leftovers'.

    Freeform meals have no ingredients, so they're automatically on_grocery=True
    (nothing to add to the list).
    """
    existing = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    ).fetchone()
    # Going from a real recipe → freeform is a meal change, so delete + insert
    # (new meal.id) so grocery sync drops the old recipe's ingredient rows.
    # Re-saving the same freeform name is a no-op-ish update in place.
    if existing and existing["recipe_id"] is not None:
        conn.execute(text("DELETE FROM meals WHERE id = :id"), {"id": existing["id"]})
        conn.commit()
        meal = Meal(id=None, slot_date=slot_date)
    elif existing:
        meal = _row_to_meal(existing)
    else:
        meal = Meal(id=None, slot_date=slot_date)

    meal.recipe_id = None
    meal.recipe_name = name
    meal.sides = []
    meal.is_followup = False
    meal.on_grocery = True
    save_meal(conn, user_id, meal)
    return meal


def get_candidates(conn: DictConnection, user_id: str, slot_date: str) -> list:
    """Return valid recipe candidates for a date, with last-made context.

    The manual picker shows the full library minus what's already used this
    week or cooked in the last two weeks. Cuisine/effort narrowing is opt-in
    by the user via filter chips (applied client-side), not a silent day-theme
    filter. Day themes still drive auto-generation elsewhere.
    """
    s, e = week_range(slot_date)
    week_meals = load_meals(conn, user_id, s, e)

    used_ids = {m.recipe_id for m in week_meals if m.recipe_id and m.slot_date != slot_date}
    used_ids |= _get_recent_recipe_ids(conn, user_id, s)

    candidates = filter_recipes(conn, exclude_ids=used_ids, user_id=user_id)
    return candidates


def _most_paired_side(conn: DictConnection, user_id: str, recipe_id: int) -> dict | None:
    """The side most often served with a given meal in this user's history.
    Falls back to the user's most-used side overall when there's no pairing."""
    row = conn.execute(
        text("""SELECT ms.side_recipe_id, ms.side_name, COUNT(*) AS c
                FROM meal_sides ms JOIN meals m ON m.id = ms.meal_id
                WHERE m.user_id = :u AND m.recipe_id = :rid
                  AND ms.side_recipe_id IS NOT NULL
                GROUP BY ms.side_recipe_id, ms.side_name
                ORDER BY c DESC LIMIT 1"""),
        {"u": user_id, "rid": recipe_id},
    ).fetchone()
    if not row:
        row = conn.execute(
            text("""SELECT ms.side_recipe_id, ms.side_name, COUNT(*) AS c
                    FROM meal_sides ms JOIN meals m ON m.id = ms.meal_id
                    WHERE m.user_id = :u AND ms.side_recipe_id IS NOT NULL
                    GROUP BY ms.side_recipe_id, ms.side_name
                    ORDER BY c DESC LIMIT 1"""),
            {"u": user_id},
        ).fetchone()
    if not row:
        return None
    return {"side_recipe_id": row["side_recipe_id"], "side_name": row["side_name"]}


def surprise_pick(conn: DictConnection, user_id: str, slot_date: str,
                  cuisine: str | None = None, exclude_ids: set[int] | None = None) -> dict | None:
    """One smart suggestion: a meal not cooked in the last 14 days (optionally
    within a cuisine, or quick/easy), weighted slightly toward familiar
    favorites, paired with its most-frequent side. Returns recipe fields plus
    last_made/cook_count and a suggested side, or None if nothing eligible."""
    exclude_ids = set(exclude_ids or [])

    recent = _get_recent_recipe_ids(conn, user_id, slot_date)
    pool = [r for r in filter_recipes(conn, cuisine=cuisine, user_id=user_id)
            if r.id not in recent and r.id not in exclude_ids]
    if not pool:
        # Re-rolled through everything (or filter too tight): relax exclusions,
        # keeping only the cuisine intent.
        pool = list(filter_recipes(conn, cuisine=cuisine, user_id=user_id))
    if not pool:
        return None

    counts = {r["recipe_id"]: r["c"] for r in conn.execute(
        text("""SELECT recipe_id, COUNT(*) AS c FROM meals
                WHERE user_id = :u AND recipe_id IS NOT NULL GROUP BY recipe_id"""),
        {"u": user_id},
    ).fetchall()}
    weights = [1 + counts.get(r.id, 0) for r in pool]
    meal = random.choices(pool, weights=weights, k=1)[0]

    last_made = get_last_made(conn, user_id, meal.id)
    return {
        "meal": {"id": meal.id, "name": meal.name, "cuisine": meal.cuisine,
                 "cook_count": counts.get(meal.id, 0), "last_made": last_made},
        "side": _most_paired_side(conn, user_id, meal.id),
    }


def toggle_grocery(conn: DictConnection, user_id: str, slot_date: str) -> Meal | None:
    """Toggle a meal's on_grocery flag. Returns updated meal."""
    row = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    ).fetchone()
    if not row:
        return None
    new_val = 0 if row["on_grocery"] else 1
    conn.execute(
        text("UPDATE meals SET on_grocery = :val WHERE id = :id"),
        {"val": new_val, "id": row["id"]},
    )
    conn.commit()
    meal = _row_to_meal(row)
    meal.on_grocery = bool(new_val)
    # Load sides for return value
    _load_meal_sides(conn, meal)
    return meal


def set_all_grocery(conn: DictConnection, user_id: str, start_date: str, end_date: str, on: bool = True) -> None:
    """Set on_grocery for all meals in a date range."""
    conn.execute(
        text("UPDATE meals SET on_grocery = :on WHERE user_id = :user_id AND slot_date BETWEEN :start_date AND :end_date"),
        {"on": int(on), "user_id": user_id, "start_date": start_date, "end_date": end_date},
    )
    conn.commit()



# ── Helpers ─────────────────────────────────────────────

def _load_meal_sides(conn: DictConnection, meal: Meal) -> None:
    """Load sides from junction table into a meal."""
    if not meal.id:
        return
    side_rows = conn.execute(
        text("SELECT * FROM meal_sides WHERE meal_id = :mid ORDER BY position"),
        {"mid": meal.id},
    ).fetchall()
    meal.sides = [
        MealSide(id=sr["id"], side_recipe_id=sr["side_recipe_id"],
                 side_name=sr["side_name"], position=sr["position"])
        for sr in side_rows
    ]


def _row_to_meal(row) -> Meal:
    try:
        notes = row["notes"]
    except (KeyError, Exception):
        notes = ""
    return Meal(
        id=row["id"], slot_date=row["slot_date"],
        recipe_id=row["recipe_id"], recipe_name=row["recipe_name"],
        status=row["status"],
        locked=bool(row["locked"]), is_followup=bool(row["is_followup"]),
        on_grocery=bool(row["on_grocery"]),
        notes=notes or "",
    )




