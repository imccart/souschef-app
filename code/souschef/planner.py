"""Meal plan generation engine — date-based flat model."""

from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import text

from souschef.database import DictConnection
from souschef.models import Meal, MealWeek
from souschef.recipes import filter_recipes, get_recipe_by_name

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Day themes keyed by weekday (0=Mon .. 6=Sun)
DAY_THEMES: dict[int, dict] = {
    0: {"effort": "easy", "cleanup": "easy"},           # Monday
    1: {"cuisine": "mexican"},                            # Tuesday
    2: {"cuisine": "italian"},                            # Wednesday
    3: {},                                                # Thursday — anything non-themed
    4: {"outdoor": True},                                 # Friday
    5: None,                                              # Saturday = eat out
    6: {"outdoor": True},                                 # Sunday
}

RESERVED_CUISINES = {"mexican", "italian"}

LEFTOVER_PRODUCERS = {
    "Pulled Pork": {
        "protein": "pork shoulder",
        "follows": [
            "Pulled Pork Tacos", "Mac and Cheese Plate", "Loaded Baked Potatoes",
        ],
    },
    "Rotisserie Chicken Dinner": {
        "protein": "rotisserie chicken",
        "follows": [
            "Chicken Tacos", "Chicken Fried Rice", "Chicken Alfredo",
            "Big Salad", "Loaded Baked Potatoes",
        ],
    },
}

FOLLOWUP_OFFSETS = (2, 3)

LIGHT_MEALS = {"Mac and Cheese Plate", "Grilled Cheese with Soup", "Big Salad"}

FOLLOWUP_ONLY = {"Pulled Pork Tacos"}

SIDE_OPTIONS = [
    "green beans", "mixed veggies", "black beans", "side salad",
    "roasted broccoli", "roasted chickpeas", "mashed potatoes",
    "refried beans", "corn on the cob", "corn", "green peas", "roasted carrots", "edamame",
]

SIDE_INGREDIENTS = {
    "green beans": ("green beans", 12, "oz"),
    "mixed veggies": ("mixed veggies", 12, "oz"),
    "black beans": ("black beans", 15, "oz"),
    "side salad": ("lettuce", 1, "count"),
    "roasted broccoli": ("broccoli", 1, "lb"),
    "roasted chickpeas": ("chickpeas", 15, "oz"),
    "mashed potatoes": ("potato", 2, "lb"),
    "refried beans": ("refried beans", 15, "oz"),
    "corn on the cob": ("corn on the cob", 4, "count"),
    "corn": ("corn", 12, "oz"),
    "green peas": ("green peas", 12, "oz"),
    "roasted carrots": ("carrot", 1, "lb"),
    "edamame": ("edamame", 12, "oz"),
}

FIXED_SIDES = {
    "Enchiladas": "black beans",
}

NO_SIDE = {
    "Beans, Rice, and Sausage", "Beef Tacos", "Big Salad", "Breakfast for Dinner",
    "Chicken Fried Rice", "Chicken Nuggets and Edamame", "Chicken Tacos",
    "Chili and Cornbread", "Frozen Pizza Night", "Grilled Cheese with Soup",
    "Lasagna", "Loaded Baked Potatoes", "Mac and Cheese Plate",
    "Pulled Pork Tacos", "Stuffed Peppers", "Taco Bowls", "Veggie Tacos",
}


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


def _assign_side(recipe_name: str, used_sides: list[str]) -> str:
    if recipe_name in NO_SIDE:
        return ""
    if recipe_name in FIXED_SIDES:
        return FIXED_SIDES[recipe_name]
    available = [s for s in SIDE_OPTIONS if s not in used_sides]
    if not available:
        available = list(SIDE_OPTIONS)
    return random.choice(available)


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
    return [
        Meal(
            id=r["id"], slot_date=r["slot_date"], recipe_id=r["recipe_id"],
            recipe_name=r["rname"] or "", status=r["status"],
            side=r["side"], locked=bool(r["locked"]),
            is_followup=bool(r["is_followup"]),
            on_grocery=bool(r["on_grocery"]),
            created_at=r["created_at"],
        )
        for r in rows
    ]


def load_current_week(conn: DictConnection, user_id: str) -> list[Meal]:
    start, end = week_range()
    return load_meals(conn, user_id, start, end)


def load_meal_week(conn: DictConnection, user_id: str, start: str | None = None) -> MealWeek:
    """Load a MealWeek view for display."""
    s, e = week_range(start)
    meals = load_meals(conn, user_id, s, e)
    return MealWeek(start_date=s, end_date=e, meals=meals)


def save_meals(conn: DictConnection, user_id: str, meals: list[Meal]) -> list[Meal]:
    """Insert or update meals."""
    for meal in meals:
        if meal.id:
            conn.execute(
                text("""UPDATE meals SET recipe_id = :recipe_id, recipe_name = :recipe_name, status = :status,
                   side = :side, locked = :locked, is_followup = :is_followup, on_grocery = :on_grocery
                   WHERE id = :id AND user_id = :user_id"""),
                {"recipe_id": meal.recipe_id, "recipe_name": meal.recipe_name, "status": meal.status,
                 "side": meal.side, "locked": int(meal.locked), "is_followup": int(meal.is_followup),
                 "on_grocery": int(meal.on_grocery), "id": meal.id, "user_id": user_id},
            )
        else:
            cur = conn.execute(
                text("""INSERT INTO meals (user_id, slot_date, recipe_id, recipe_name, status, side, locked, is_followup, on_grocery)
                   VALUES (:user_id, :slot_date, :recipe_id, :recipe_name, :status, :side, :locked, :is_followup, :on_grocery)
                   RETURNING id"""),
                {"user_id": user_id, "slot_date": meal.slot_date, "recipe_id": meal.recipe_id, "recipe_name": meal.recipe_name,
                 "status": meal.status, "side": meal.side, "locked": int(meal.locked),
                 "is_followup": int(meal.is_followup), "on_grocery": int(meal.on_grocery)},
            )
            meal.id = cur.fetchone()["id"]
    conn.commit()
    return meals


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


# ── Plan generation ─────────────────────────────────────

def fill_dates(
    conn: DictConnection, user_id: str, start_date: str, end_date: str
) -> list[Meal]:
    """Fill empty dates in a range with suggested meals. Returns all meals in the range."""
    existing = load_meals(conn, user_id, start_date, end_date)
    filled_dates = {m.slot_date for m in existing}

    # Build date list for the range
    s = date.fromisoformat(start_date)
    e = date.fromisoformat(end_date)
    all_dates = []
    d = s
    while d <= e:
        all_dates.append(d)
        d += timedelta(days=1)

    empty_dates = [d for d in all_dates if d.isoformat() not in filled_dates]
    if not empty_dates:
        return existing

    # Gather used recipe IDs from existing meals in range + recent history
    used_ids = {m.recipe_id for m in existing if m.recipe_id}
    used_ids |= _get_recent_recipe_ids(conn, user_id, start_date)

    producer_ids = _get_producer_recipe_ids(conn, user_id)
    has_producer = any(m.recipe_id in producer_ids for m in existing)

    # Check for carryover follow-ups from meals just before this range
    new_meals: list[Meal] = []
    _schedule_carryover_followups(conn, user_id, start_date, empty_dates, new_meals, used_ids)
    newly_filled = {m.slot_date for m in new_meals}

    # Fill remaining empty dates
    for d in empty_dates:
        if d.isoformat() in newly_filled:
            continue

        weekday = d.weekday()
        theme = DAY_THEMES.get(weekday)

        # Eat-out day (theme is None)
        if theme is None:
            new_meals.append(Meal(
                id=None, slot_date=d.isoformat(),
                recipe_id=None, recipe_name="Eating Out", status="suggested",
            ))
            continue

        effective_exclude = used_ids | (producer_ids if has_producer else set())
        recipe = _pick_recipe(conn, theme, effective_exclude, user_id)
        if recipe is None:
            recipe = _pick_recipe(conn, {}, effective_exclude, user_id)

        recipe_id = recipe.id if recipe else None
        recipe_name = recipe.name if recipe else "No match"
        if recipe_id:
            used_ids.add(recipe_id)
            if recipe_id in producer_ids:
                has_producer = True

        new_meals.append(Meal(
            id=None, slot_date=d.isoformat(),
            recipe_id=recipe_id, recipe_name=recipe_name, status="suggested",
        ))

    # Guarantee light meal
    all_meals = existing + new_meals
    _ensure_light_meal(conn, all_meals, new_meals, used_ids, user_id)

    # Schedule same-range follow-ups
    _schedule_same_range_followups(conn, all_meals, new_meals, used_ids, user_id)

    # Assign sides
    used_sides = [m.side for m in existing if m.side]
    for meal in new_meals:
        if meal.recipe_name:
            side = _assign_side(meal.recipe_name, used_sides)
            meal.side = side
            if side:
                used_sides.append(side)

    # Save new meals
    save_meals(conn, user_id, new_meals)

    return load_meals(conn, user_id, start_date, end_date)


def _schedule_carryover_followups(
    conn: DictConnection, user_id: str, start_date: str,
    empty_dates: list[date], new_meals: list[Meal], used_ids: set[int]
) -> None:
    """If days just before this range had a big cook, place a follow-up."""
    lookback = date.fromisoformat(start_date) - timedelta(days=4)
    recent = load_meals(conn, user_id, lookback.isoformat(), start_date)

    for meal in recent:
        if meal.recipe_name not in LEFTOVER_PRODUCERS:
            continue
        producer = LEFTOVER_PRODUCERS[meal.recipe_name]
        meal_date = date.fromisoformat(meal.slot_date)

        for offset in FOLLOWUP_OFFSETS:
            target = meal_date + timedelta(days=offset)
            if target not in empty_dates:
                continue
            weekday = target.weekday()
            if DAY_THEMES.get(weekday) is None:
                continue

            followup = _pick_followup(conn, producer["follows"], used_ids, weekday, user_id)
            if followup is None:
                continue

            used_ids.add(followup.id)
            new_meals.append(Meal(
                id=None, slot_date=target.isoformat(),
                recipe_id=followup.id, recipe_name=followup.name,
                status="suggested", is_followup=True,
            ))
            break


def _schedule_same_range_followups(
    conn: DictConnection, all_meals: list[Meal],
    new_meals: list[Meal], used_ids: set[int], user_id: str = ""
) -> None:
    """If a big cook is in this range, replace a later slot with a follow-up."""
    filled_dates = {m.slot_date for m in all_meals}
    new_dates = {m.slot_date for m in new_meals}

    for meal in list(all_meals):
        if meal.recipe_name not in LEFTOVER_PRODUCERS:
            continue
        producer = LEFTOVER_PRODUCERS[meal.recipe_name]
        meal_date = date.fromisoformat(meal.slot_date)

        for offset in FOLLOWUP_OFFSETS:
            target = meal_date + timedelta(days=offset)
            target_iso = target.isoformat()
            weekday = target.weekday()
            if DAY_THEMES.get(weekday) is None:
                continue

            # Find the meal on the target date
            target_meal = next((m for m in all_meals if m.slot_date == target_iso), None)
            if target_meal is None:
                continue
            if target_meal.is_followup:
                continue  # already a follow-up

            old_id = target_meal.recipe_id
            if old_id:
                used_ids.discard(old_id)

            followup = _pick_followup(conn, producer["follows"], used_ids, weekday, user_id)
            if followup is None:
                if old_id:
                    used_ids.add(old_id)
                continue

            target_meal.recipe_id = followup.id
            target_meal.recipe_name = followup.name
            target_meal.is_followup = True
            used_ids.add(followup.id)
            break


def _ensure_light_meal(
    conn: DictConnection, all_meals: list[Meal],
    new_meals: list[Meal], used_ids: set[int], user_id: str = ""
) -> None:
    has_light = any(m.recipe_name in LIGHT_MEALS for m in all_meals)
    if has_light:
        return

    light_recipe = None
    for name in LIGHT_MEALS:
        r = get_recipe_by_name(conn, name, user_id=user_id)
        if r and r.id not in used_ids:
            light_recipe = r
            break
    if light_recipe is None:
        return

    # Prefer Monday or Thursday for the swap
    for meal in new_meals:
        if meal.weekday not in (0, 3):
            continue
        if meal.recipe_id is None:
            continue
        if meal.recipe_name in LEFTOVER_PRODUCERS:
            continue
        old_id = meal.recipe_id
        meal.recipe_id = light_recipe.id
        meal.recipe_name = light_recipe.name
        used_ids.add(light_recipe.id)
        used_ids.discard(old_id)
        return


# ── Swap / edit operations ──────────────────────────────

def swap_meal(conn: DictConnection, user_id: str, slot_date: str) -> Meal:
    """Swap the meal on a date with a new random pick."""
    s, e = week_range(slot_date)
    week_meals = load_meals(conn, user_id, s, e)
    meal = next((m for m in week_meals if m.slot_date == slot_date), None)

    used_ids = {m.recipe_id for m in week_meals if m.recipe_id and m.slot_date != slot_date}
    used_ids |= _get_recent_recipe_ids(conn, user_id, s)

    weekday = date.fromisoformat(slot_date).weekday()
    theme = DAY_THEMES.get(weekday, {}) or {}

    recipe = _pick_recipe(conn, theme, used_ids, user_id)
    if recipe is None:
        recipe = _pick_recipe(conn, {}, used_ids, user_id)

    if meal is None:
        meal = Meal(id=None, slot_date=slot_date)

    meal.recipe_id = recipe.id if recipe else None
    meal.recipe_name = recipe.name if recipe else "No match"
    meal.on_grocery = False  # new meal needs explicit grocery toggle

    used_sides = [m.side for m in week_meals if m.slot_date != slot_date and m.side]
    meal.side = _assign_side(meal.recipe_name, used_sides)

    save_meal(conn, user_id, meal)
    return meal


def swap_meal_side(conn: DictConnection, user_id: str, slot_date: str) -> Meal:
    """Swap just the side dish for a date."""
    s, e = week_range(slot_date)
    week_meals = load_meals(conn, user_id, s, e)
    meal = next((m for m in week_meals if m.slot_date == slot_date), None)
    if meal is None:
        return None

    if meal.recipe_name in NO_SIDE or meal.recipe_name in FIXED_SIDES:
        return meal

    used_sides = [m.side for m in week_meals if m.slot_date != slot_date and m.side]
    if meal.side:
        used_sides.append(meal.side)
    meal.side = _assign_side(meal.recipe_name, used_sides)

    save_meal(conn, user_id, meal)
    return meal


def swap_dates(conn: DictConnection, user_id: str, date_a: str, date_b: str) -> list[Meal]:
    """Swap meals between two dates. Returns updated week."""
    rows_a = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": date_a},
    ).fetchall()
    rows_b = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": date_b},
    ).fetchall()
    meal_a = _row_to_meal(rows_a[0]) if rows_a else None
    meal_b = _row_to_meal(rows_b[0]) if rows_b else None

    if meal_a and meal_b:
        for attr in ("recipe_id", "recipe_name", "is_followup", "side"):
            val_a = getattr(meal_a, attr)
            val_b = getattr(meal_b, attr)
            setattr(meal_a, attr, val_b)
            setattr(meal_b, attr, val_a)
        save_meals(conn, user_id, [meal_a, meal_b])

    s, e = week_range(date_a)
    return load_meals(conn, user_id, s, e)


def set_meal(conn: DictConnection, user_id: str, slot_date: str, recipe_name: str) -> Meal | str:
    """Manually set a date's recipe by name. No rule enforcement."""
    recipe = get_recipe_by_name(conn, recipe_name, user_id=user_id)
    if recipe is None:
        row = conn.execute(
            text("SELECT * FROM recipes WHERE name LIKE :pattern AND user_id = :user_id ORDER BY name LIMIT 1"),
            {"pattern": f"%{recipe_name}%", "user_id": user_id},
        ).fetchone()
        if row:
            from souschef.recipes import get_recipe
            recipe = get_recipe(conn, row["id"])
        if recipe is None:
            return f"Recipe '{recipe_name}' not found."

    existing = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    ).fetchone()
    if existing:
        meal = _row_to_meal(existing)
    else:
        meal = Meal(id=None, slot_date=slot_date)

    meal.recipe_id = recipe.id
    meal.recipe_name = recipe.name
    meal.is_followup = False
    meal.on_grocery = False  # new meal needs explicit grocery toggle

    # Reassign side to match the new meal
    s, e = rolling_range()
    week_meals = load_meals(conn, user_id, s, e)
    used_sides = [m.side for m in week_meals if m.slot_date != slot_date and m.side]
    meal.side = _assign_side(recipe.name, used_sides)

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
    if existing:
        meal = _row_to_meal(existing)
    else:
        meal = Meal(id=None, slot_date=slot_date)

    meal.recipe_id = None
    meal.recipe_name = name
    meal.side = ""
    meal.is_followup = False
    meal.on_grocery = True
    save_meal(conn, user_id, meal)
    return meal


def get_candidates(conn: DictConnection, user_id: str, slot_date: str) -> list:
    """Return valid recipe candidates for a date, with last-made context."""
    s, e = week_range(slot_date)
    week_meals = load_meals(conn, user_id, s, e)

    used_ids = {m.recipe_id for m in week_meals if m.recipe_id and m.slot_date != slot_date}
    used_ids |= _get_recent_recipe_ids(conn, user_id, s)

    weekday = date.fromisoformat(slot_date).weekday()
    theme = DAY_THEMES.get(weekday, {}) or {}

    cuisine = theme.get("cuisine")
    exclude_cuisines = None if cuisine else RESERVED_CUISINES

    candidates = filter_recipes(
        conn, cuisine=cuisine, effort=theme.get("effort"),
        outdoor=theme.get("outdoor"), kid_friendly=theme.get("kid_friendly"),
        exclude_ids=used_ids, exclude_cuisines=exclude_cuisines,
        user_id=user_id,
    )
    if not candidates:
        candidates = filter_recipes(conn, exclude_ids=used_ids, exclude_cuisines=exclude_cuisines, user_id=user_id)

    candidates = [r for r in candidates if r.name not in FOLLOWUP_ONLY]
    return candidates


def toggle_grocery(conn: DictConnection, user_id: str, slot_date: str) -> Meal | None:
    """Toggle a meal's on_grocery flag. Returns updated meal."""
    row = conn.execute(
        text("SELECT * FROM meals WHERE user_id = :user_id AND slot_date = :slot_date"),
        {"user_id": user_id, "slot_date": slot_date},
    ).fetchone()
    if not row:
        return None
    meal = _row_to_meal(row)
    meal.on_grocery = not meal.on_grocery
    save_meal(conn, user_id, meal)
    return meal


def set_all_grocery(conn: DictConnection, user_id: str, start_date: str, end_date: str, on: bool = True) -> None:
    """Set on_grocery for all meals in a date range."""
    conn.execute(
        text("UPDATE meals SET on_grocery = :on WHERE user_id = :user_id AND slot_date BETWEEN :start_date AND :end_date"),
        {"on": int(on), "user_id": user_id, "start_date": start_date, "end_date": end_date},
    )
    conn.commit()


def accept_meals(conn: DictConnection, user_id: str, start_date: str, end_date: str) -> None:
    """Legacy: accept all meals in a date range. Now also sets on_grocery."""
    conn.execute(
        text("UPDATE meals SET status = 'accepted', on_grocery = 1 WHERE user_id = :user_id AND slot_date BETWEEN :start_date AND :end_date"),
        {"user_id": user_id, "start_date": start_date, "end_date": end_date},
    )
    conn.commit()


# ── Helpers ─────────────────────────────────────────────

def _row_to_meal(row) -> Meal:
    return Meal(
        id=row["id"], slot_date=row["slot_date"],
        recipe_id=row["recipe_id"], recipe_name=row["recipe_name"],
        status=row["status"], side=row["side"],
        locked=bool(row["locked"]), is_followup=bool(row["is_followup"]),
        on_grocery=bool(row["on_grocery"]),
    )


def _get_producer_recipe_ids(conn: DictConnection, user_id: str = "") -> set[int]:
    ids = set()
    for name in LEFTOVER_PRODUCERS:
        recipe = get_recipe_by_name(conn, name, user_id=user_id)
        if recipe:
            ids.add(recipe.id)
    return ids


def _pick_recipe(conn, theme: dict, exclude_ids: set[int], user_id: str = ""):
    cuisine = theme.get("cuisine")
    exclude_cuisines = None if cuisine else RESERVED_CUISINES

    candidates = filter_recipes(
        conn, cuisine=cuisine, effort=theme.get("effort"),
        outdoor=theme.get("outdoor"), kid_friendly=theme.get("kid_friendly"),
        exclude_ids=exclude_ids, exclude_cuisines=exclude_cuisines,
        user_id=user_id,
    )
    candidates = [r for r in candidates if r.name not in FOLLOWUP_ONLY]
    if not candidates:
        return None
    return random.choice(candidates)


def _pick_followup(conn, follow_names: list[str], used_ids: set[int], target_weekday: int, user_id: str = ""):
    theme = DAY_THEMES.get(target_weekday, {}) or {}
    candidates = []
    for name in follow_names:
        recipe = get_recipe_by_name(conn, name, user_id=user_id)
        if recipe is None or recipe.id in used_ids:
            continue
        cuisine = theme.get("cuisine")
        if cuisine and recipe.cuisine != cuisine:
            continue
        if not cuisine and recipe.cuisine in RESERVED_CUISINES:
            continue
        candidates.append(recipe)

    if not candidates:
        for name in follow_names:
            recipe = get_recipe_by_name(conn, name, user_id=user_id)
            if recipe and recipe.id not in used_ids:
                candidates.append(recipe)

    return random.choice(candidates) if candidates else None


BULK_PREPPABLE = {
    "chicken breast", "chicken thighs", "ground beef", "ground turkey",
    "pork shoulder", "steak", "pork chops", "beef sausage",
    "rice", "black beans", "kidney beans",
}


def detect_bulk_components(conn: DictConnection, meals: list[Meal]) -> list[str]:
    """Find ingredients used across multiple meals that could be prepped in bulk."""
    from collections import Counter
    ingredient_meals: Counter = Counter()
    ingredient_names: dict[int, str] = {}

    for meal in meals:
        if not meal.recipe_id:
            continue
        rows = conn.execute(
            text("""SELECT ri.ingredient_id, i.name, ri.component
               FROM recipe_ingredients ri
               JOIN ingredients i ON i.id = ri.ingredient_id
               WHERE ri.recipe_id = :recipe_id AND ri.component NOT IN ('', 'formed')"""),
            {"recipe_id": meal.recipe_id},
        ).fetchall()
        for r in rows:
            if r["name"] in BULK_PREPPABLE:
                ingredient_meals[r["ingredient_id"]] += 1
                ingredient_names[r["ingredient_id"]] = r["name"]

    tips = []
    for ing_id, count in ingredient_meals.items():
        if count >= 2:
            tips.append(f"  {ingredient_names[ing_id]} used in {count} meals — prep in bulk")
    return tips


# ── Legacy compatibility ────────────────────────────────
# These wrap the old API signatures for code that hasn't been migrated yet.

def save_plan(conn, plan):
    """Legacy: save a MealPlan by converting slots to flat meals."""
    from souschef.models import MealPlan
    if not isinstance(plan, MealPlan):
        raise TypeError("Expected MealPlan")
    week_of = date.fromisoformat(plan.week_of)
    meals = []
    for slot in plan.slots:
        slot_date = (week_of + timedelta(days=slot.day_of_week)).isoformat()
        meals.append(Meal(
            id=None, slot_date=slot_date,
            recipe_id=slot.recipe_id, recipe_name=slot.recipe_name,
            status=slot.status, side=slot.side,
            locked=slot.locked, is_followup=slot.is_followup,
        ))
    save_meals(conn, meals)
    # Set plan.id to a synthetic value for backward compat
    plan.id = meals[0].id if meals else None
    return plan


def load_plan(conn, plan_id):
    """Legacy: load by plan_id from old table, or fall back to meals table."""
    from souschef.models import MealPlan, MealPlanSlot
    # Try old table first
    try:
        row = conn.execute(
            text("SELECT * FROM meal_plans WHERE id = :plan_id"),
            {"plan_id": plan_id},
        ).fetchone()
        if row:
            week_of = row["week_of"]
            s, e = week_range(week_of)
            meals = load_meals(conn, s, e)
            plan = MealPlan(id=row["id"], week_of=week_of, created_at=row["created_at"])
            plan.slots = [
                MealPlanSlot(
                    id=m.id, plan_id=row["id"], day_of_week=m.weekday,
                    recipe_id=m.recipe_id, status=m.status,
                    locked=m.locked, recipe_name=m.recipe_name,
                    is_followup=m.is_followup, side=m.side,
                )
                for m in meals
            ]
            return plan
    except Exception:
        pass
    return None


def load_latest_plan(conn):
    """Legacy: load the most recent plan."""
    try:
        row = conn.execute(text("SELECT id FROM meal_plans ORDER BY id DESC LIMIT 1")).fetchone()
        if row:
            return load_plan(conn, row["id"])
    except Exception:
        pass
    return None
