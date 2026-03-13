"""JSON API endpoints for the React frontend."""

from __future__ import annotations

from fastapi import APIRouter, Request, UploadFile, File
from sqlalchemy import text

from souschef.db import ensure_db

router = APIRouter(prefix="/api")


def _conn():
    return ensure_db()


# ── Meals ────────────────────────────────────────────────


@router.get("/meals")
async def get_meals(request: Request):
    """Get rolling 7-day meals."""
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    status = workflow.get_workflow_status(conn, user_id)
    return {
        "start_date": mw.start_date,
        "end_date": mw.end_date,
        "days": [
            {
                "date": d["date"],
                "day_short": d["day_short"],
                "meal": _meal_dict(d["meal"]) if d["meal"] else None,
            }
            for d in mw.all_days
        ],
        "status": {
            "has_meals": status.has_meals,
            "meals_on_grocery": status.meals_on_grocery,
            "total_meals": status.total_meals,
            "grocery_built": status.grocery_built,
            "order_placed": status.order_placed,
            "reconcile_count": status.reconcile_count,
        },
    }


@router.get("/meals/past")
async def get_past_meals(request: Request):
    """Get the 7 days before today."""
    from datetime import date, timedelta
    from souschef.planner import load_meals

    user_id = request.state.user_id
    conn = _conn()
    today = date.today()
    end = today - timedelta(days=1)
    start = today - timedelta(days=7)
    meals = load_meals(conn, user_id, start.isoformat(), end.isoformat())
    meal_map = {m.slot_date: m for m in meals}

    days = []
    for i in range(7):
        d = start + timedelta(days=i)
        ds = d.isoformat()
        day_short = d.strftime("%a").upper()[:3]
        m = meal_map.get(ds)
        days.append({
            "date": ds,
            "day_short": day_short,
            "meal": _meal_dict(m) if m else None,
        })
    return {"days": days}


@router.post("/meals/{date}/swap")
async def swap_meal(date: str, request: Request):
    """Quick swap — replaces a meal, sets on_grocery=False."""
    from souschef.planner import swap_meal as do_swap

    user_id = request.state.user_id
    conn = _conn()
    do_swap(conn, user_id, date)
    return await get_meals(request)


@router.post("/meals/{date}/swap-smart")
async def swap_meal_smart(date: str, request: Request, body: dict = None):
    """Smart swap with grocery list awareness.

    Step 1 (no body or body.action='preview'):
      Swap the meal, then return info about ingredients to remove/add.
    Step 2 (body.action='confirm'):
      Apply the user's choices: remove_items, add_to_list (bool).
    """
    from souschef.planner import swap_meal as do_swap
    from souschef.grocery import build_grocery_list, split_by_store
    from souschef import workflow

    user_id = request.state.user_id
    body = body or {}
    action = body.get("action", "preview")
    conn = _conn()

    if action == "preview":
        # Get the old meal's info before swapping
        old_meal = conn.execute(
            text("SELECT recipe_id, recipe_name, on_grocery FROM meals WHERE slot_date = :date AND user_id = :user_id"),
            {"date": date, "user_id": user_id},
        ).fetchone()
        old_was_on_list = old_meal and old_meal["on_grocery"]

        # Find old meal's unique ingredients (not shared by other on-list meals)
        removable = []
        if old_was_on_list and old_meal["recipe_id"]:
            mw = workflow.get_rolling_meals(conn, user_id)
            # Get all ingredients for the OLD meal
            old_ingredients = set()
            rows = conn.execute(
                text("""SELECT i.name FROM recipe_ingredients ri
                   JOIN ingredients i ON ri.ingredient_id = i.id
                   WHERE ri.recipe_id = :recipe_id"""),
                {"recipe_id": old_meal["recipe_id"]},
            ).fetchall()
            old_ingredients = {r["name"].lower() for r in rows}

            # Get ingredients shared by OTHER on-list meals
            shared = set()
            for m in mw.meals:
                if m.on_grocery and m.recipe_id and m.slot_date != date:
                    other_rows = conn.execute(
                        text("""SELECT i.name FROM recipe_ingredients ri
                           JOIN ingredients i ON ri.ingredient_id = i.id
                           WHERE ri.recipe_id = :recipe_id"""),
                        {"recipe_id": m.recipe_id},
                    ).fetchall()
                    shared |= {r["name"].lower() for r in other_rows}

            # Removable = old ingredients not shared, not already checked/ordered
            trip = _get_active_trip(conn, user_id)
            if trip:
                for name_lower in old_ingredients - shared:
                    item = conn.execute(
                        text("SELECT checked, ordered FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = :name"),
                        {"trip_id": trip["id"], "name": name_lower},
                    ).fetchone()
                    if item and not item["checked"] and not item["ordered"]:
                        # Get display name from trip_items
                        display = conn.execute(
                            text("SELECT name FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = :name"),
                            {"trip_id": trip["id"], "name": name_lower},
                        ).fetchone()
                        removable.append(display["name"] if display else name_lower)

        # Now do the swap
        do_swap(conn, user_id, date)
        meals_data = await get_meals(request)

        # Get the new meal's name
        new_meal = conn.execute(
            text("SELECT recipe_name FROM meals WHERE slot_date = :date AND user_id = :user_id"),
            {"date": date, "user_id": user_id},
        ).fetchone()

        return {
            **meals_data,
            "swap_prompt": {
                "date": date,
                "old_meal": old_meal["recipe_name"] if old_meal else None,
                "new_meal": new_meal["recipe_name"] if new_meal else None,
                "removable": removable,
                "old_was_on_list": bool(old_was_on_list),
            },
        }

    elif action == "confirm":
        # Apply user's choices
        remove_items = body.get("remove_items", [])
        add_to_list = body.get("add_to_list", False)

        trip = _get_active_trip(conn, user_id)
        if trip:
            # Remove specified items from trip
            for name in remove_items:
                conn.execute(
                    text("DELETE FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
                    {"trip_id": trip["id"], "name": name},
                )

        if add_to_list:
            # Toggle on_grocery for the new meal
            conn.execute(
                text("UPDATE meals SET on_grocery = 1 WHERE slot_date = :date AND user_id = :user_id"),
                {"date": date, "user_id": user_id},
            )
        else:
            # "No" = mark cart as done (on_grocery stays false — "I've got this covered")
            conn.execute(
                text("UPDATE meals SET on_grocery = 1 WHERE slot_date = :date AND user_id = :user_id"),
                {"date": date, "user_id": user_id},
            )
            # Mark it as on_grocery but we won't add ingredients since refresh handles it

        conn.commit()

        # Refresh trip items if there's an active trip
        if trip:
            mw = workflow.get_rolling_meals(conn, user_id)
            _refresh_trip_meal_items(conn, trip["id"], mw, user_id)

        return await get_meals(request)


@router.get("/meals/{date}/sides")
async def get_sides(date: str, request: Request):
    """Return available side options for a date's meal."""
    from souschef.planner import SIDE_OPTIONS, NO_SIDE, FIXED_SIDES, load_meals, rolling_range

    user_id = request.state.user_id
    conn = _conn()
    meal_row = conn.execute(
        text("SELECT recipe_name, side FROM meals WHERE slot_date = :date AND user_id = :user_id"),
        {"date": date, "user_id": user_id},
    ).fetchone()
    if not meal_row:
        return {"sides": [], "current": None, "fixed": False}

    recipe_name = meal_row["recipe_name"]
    if recipe_name in NO_SIDE:
        return {"sides": [], "current": None, "fixed": True}
    if recipe_name in FIXED_SIDES:
        return {"sides": [], "current": FIXED_SIDES[recipe_name], "fixed": True}

    s, e = rolling_range()
    week_meals = load_meals(conn, user_id, s, e)
    used_sides = [m.side for m in week_meals if m.slot_date != date and m.side]

    sides = []
    for side in SIDE_OPTIONS:
        sides.append({
            "name": side,
            "in_use": side in used_sides,
            "current": side == meal_row["side"],
        })
    return {"sides": sides, "current": meal_row["side"], "fixed": False}


@router.post("/meals/{date}/set-side")
async def set_side(date: str, body: dict, request: Request):
    """Set a specific side for a date's meal."""
    from souschef.planner import load_meals, save_meal, rolling_range, _row_to_meal

    user_id = request.state.user_id
    conn = _conn()
    row = conn.execute(
        text("SELECT * FROM meals WHERE slot_date = :date AND user_id = :user_id"),
        {"date": date, "user_id": user_id},
    ).fetchone()
    if not row:
        return await get_meals(request)

    meal = _row_to_meal(row)
    meal.side = body.get("side", "")
    save_meal(conn, user_id, meal)
    return await get_meals(request)


@router.post("/meals/{date}/swap-side")
async def swap_side(date: str, request: Request):
    from souschef.planner import swap_meal_side

    user_id = request.state.user_id
    conn = _conn()
    swap_meal_side(conn, user_id, date)
    return await get_meals(request)


@router.post("/meals/{date}/toggle-grocery")
async def toggle_grocery(date: str, request: Request):
    from souschef.planner import toggle_grocery as do_toggle

    user_id = request.state.user_id
    conn = _conn()
    do_toggle(conn, user_id, date)
    return await get_meals(request)


@router.post("/meals/{date}/set")
async def set_meal(date: str, body: dict, request: Request):
    from souschef.planner import set_meal as do_set
    from souschef.recipes import get_recipe

    user_id = request.state.user_id
    conn = _conn()
    recipe = get_recipe(conn, body["recipe_id"])
    if recipe:
        do_set(conn, user_id, date, recipe.name)
    return await get_meals(request)


@router.post("/meals/suggest")
async def suggest_meals(request: Request):
    from souschef.planner import fill_dates

    user_id = request.state.user_id
    conn = _conn()
    from souschef import workflow

    mw = workflow.get_rolling_meals(conn, user_id)
    fill_dates(conn, user_id, mw.start_date, mw.end_date)
    return await get_meals(request)


@router.post("/meals/all-to-grocery")
async def all_to_grocery(request: Request):
    from souschef.planner import set_all_grocery

    user_id = request.state.user_id
    conn = _conn()
    from souschef import workflow

    mw = workflow.get_rolling_meals(conn, user_id)
    if mw.meals:
        set_all_grocery(conn, user_id, mw.start_date, mw.end_date, on=True)
    return await get_meals(request)


@router.delete("/meals/{date}")
async def remove_meal(date: str, request: Request):
    from souschef.planner import remove_meal as do_remove

    user_id = request.state.user_id
    conn = _conn()
    do_remove(conn, user_id, date)
    return await get_meals(request)


@router.post("/meals/{date}/set-freeform")
async def set_freeform(date: str, body: dict, request: Request):
    from souschef.planner import set_freeform_meal

    user_id = request.state.user_id
    conn = _conn()
    set_freeform_meal(conn, user_id, date, body["name"])
    return await get_meals(request)


@router.post("/meals/swap-days")
async def swap_days(body: dict, request: Request):
    from souschef.planner import swap_dates

    user_id = request.state.user_id
    conn = _conn()
    swap_dates(conn, user_id, body["date_a"], body["date_b"])
    return await get_meals(request)


@router.get("/meals/{date}/candidates")
async def get_candidates(date: str, request: Request):
    from souschef.planner import get_candidates as do_get
    from souschef.recipes import list_recipes

    user_id = request.state.user_id
    conn = _conn()
    candidates = do_get(conn, user_id, date)
    all_recipes = list_recipes(conn)
    return {
        "candidates": [_recipe_dict(r) for r in candidates],
        "all_recipes": [_recipe_dict(r) for r in all_recipes],
    }


# ── Grocery (trip-based) ──────────────────────────────────


def _get_active_trip(conn, user_id: str):
    """Return the most recent active trip row, or None."""
    return conn.execute(
        text("SELECT * FROM grocery_trips WHERE active = 1 AND user_id = :user_id ORDER BY id DESC LIMIT 1"),
        {"user_id": user_id},
    ).fetchone()


def _infer_item_group(conn, name: str, user_id: str) -> str:
    """Resolve shopping group for an item name via ingredients, regulars, or keyword inference."""
    from souschef.regulars import _infer_group

    row = conn.execute(
        text("SELECT aisle FROM ingredients WHERE LOWER(name) = LOWER(:name)"),
        {"name": name},
    ).fetchone()
    if row and row["aisle"]:
        return row["aisle"]

    row = conn.execute(
        text("SELECT shopping_group FROM regulars WHERE LOWER(name) = LOWER(:name) AND user_id = :user_id"),
        {"name": name, "user_id": user_id},
    ).fetchone()
    if row and row["shopping_group"]:
        return row["shopping_group"]

    return _infer_group(name)


def _build_trip_from_meals(conn, trip_id: int, mw, user_id: str) -> None:
    """Populate trip_items from current meal grocery build + saved extras."""
    from souschef import workflow
    from souschef.feedback import get_skips_for_meal, get_adds_for_meal
    from souschef.grocery import build_grocery_list, split_by_store

    grocery_meals = [m for m in mw.meals if m.on_grocery]

    if grocery_meals:
        # Collect skip overrides for all meals on the plan
        skip_pairs: set[tuple[str, str]] = set()
        for meal in grocery_meals:
            for item_name in get_skips_for_meal(conn, user_id, meal.recipe_name):
                skip_pairs.add((item_name, meal.recipe_name))

        gl = build_grocery_list(conn, grocery_meals, mw.start_date, mw.end_date, user_id=user_id)
        by_store = split_by_store(gl)
        for items in by_store.values():
            for item in items:
                # Check if ALL meals for this item have a skip override
                item_meals = item.meals or []
                if item_meals and all(
                    (item.ingredient_name.lower(), m) in skip_pairs for m in item_meals
                ):
                    continue

                group = item.aisle or "Other"
                for_meals = ",".join(item_meals) if item_meals else ""
                conn.execute(
                    text("""INSERT INTO trip_items
                       (trip_id, name, shopping_group, source, for_meals, meal_count)
                       VALUES (:trip_id, :name, :group, 'meal', :for_meals, :meal_count)
                       ON CONFLICT DO NOTHING"""),
                    {"trip_id": trip_id, "name": item.ingredient_name.lower(),
                     "group": group, "for_meals": for_meals,
                     "meal_count": len(item_meals)},
                )

        # Add auto-include overrides
        seen_adds: set[str] = set()
        for meal in grocery_meals:
            for add in get_adds_for_meal(conn, user_id, meal.recipe_name):
                name = add["item_name"]
                if name in seen_adds:
                    continue
                seen_adds.add(name)
                group = _infer_item_group(conn, name, user_id)
                conn.execute(
                    text("""INSERT INTO trip_items
                       (trip_id, name, shopping_group, source, for_meals, meal_count)
                       VALUES (:trip_id, :name, :group, 'meal', :for_meals, 1)
                       ON CONFLICT DO NOTHING"""),
                    {"trip_id": trip_id, "name": name, "group": group,
                     "for_meals": meal.recipe_name},
                )

    conn.commit()


def _ensure_active_trip(conn, mw, user_id: str):
    """Find or create an active trip for the current rolling window. Returns trip row."""
    trip = _get_active_trip(conn, user_id)

    if trip:
        # If date range shifted, deactivate old trip and create fresh one
        if trip["start_date"] != mw.start_date or trip["end_date"] != mw.end_date:
            conn.execute(
                text("UPDATE grocery_trips SET active = 0 WHERE id = :id"),
                {"id": trip["id"]},
            )
            conn.commit()
            trip = None

    if trip is None:
        cursor = conn.execute(
            text("""INSERT INTO grocery_trips (trip_type, start_date, end_date, active, user_id)
               VALUES ('plan', :start_date, :end_date, 1, :user_id)
               RETURNING id"""),
            {"start_date": mw.start_date, "end_date": mw.end_date, "user_id": user_id},
        )
        conn.commit()
        trip_id = cursor.fetchone()["id"]
        _build_trip_from_meals(conn, trip_id, mw, user_id)
        trip = conn.execute(
            text("SELECT * FROM grocery_trips WHERE id = :id"),
            {"id": trip_id},
        ).fetchone()
    else:
        # Refresh meal-sourced items (meals may have changed) but preserve extras and checked state
        _refresh_trip_meal_items(conn, trip["id"], mw, user_id)

    return trip


def _refresh_trip_meal_items(conn, trip_id: int, mw, user_id: str) -> None:
    """Re-derive meal-sourced items while preserving extras and checked state."""
    from souschef.grocery import build_grocery_list, split_by_store

    grocery_meals = [m for m in mw.meals if m.on_grocery]

    # Build fresh meal items
    fresh_meal_items: dict[str, dict] = {}
    if grocery_meals:
        gl = build_grocery_list(conn, grocery_meals, mw.start_date, mw.end_date, user_id=user_id)
        by_store = split_by_store(gl)
        for items in by_store.values():
            for item in items:
                group = item.aisle or "Other"
                for_meals = ",".join(item.meals) if item.meals else ""
                fresh_meal_items[item.ingredient_name.lower()] = {
                    "name": item.ingredient_name.lower(),
                    "shopping_group": group,
                    "for_meals": for_meals,
                    "meal_count": len(item.meals),
                }

    # Get existing meal-sourced items and their checked state
    existing = conn.execute(
        text("SELECT id, name, checked FROM trip_items WHERE trip_id = :trip_id AND source = 'meal'"),
        {"trip_id": trip_id},
    ).fetchall()
    existing_map = {r["name"].lower(): r for r in existing}

    # Remove meal items no longer needed
    for name_lower, row in existing_map.items():
        if name_lower not in fresh_meal_items:
            conn.execute(
                text("DELETE FROM trip_items WHERE id = :id"),
                {"id": row["id"]},
            )

    # Add or update meal items
    for name_lower, info in fresh_meal_items.items():
        if name_lower in existing_map:
            # Update for_meals/meal_count but keep checked state
            conn.execute(
                text("""UPDATE trip_items SET for_meals = :for_meals, meal_count = :meal_count, shopping_group = :group
                   WHERE id = :id"""),
                {"for_meals": info["for_meals"], "meal_count": info["meal_count"],
                 "group": info["shopping_group"], "id": existing_map[name_lower]["id"]},
            )
        else:
            conn.execute(
                text("""INSERT INTO trip_items
                   (trip_id, name, shopping_group, source, for_meals, meal_count)
                   VALUES (:trip_id, :name, :group, 'meal', :for_meals, :meal_count)
                   ON CONFLICT DO NOTHING"""),
                {"trip_id": trip_id, "name": info["name"], "group": info["shopping_group"],
                 "for_meals": info["for_meals"], "meal_count": info["meal_count"]},
            )

    conn.commit()


@router.get("/grocery")
async def get_grocery(request: Request):
    """Get the grocery list from the active trip."""
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    # Read all items from the trip
    rows = conn.execute(
        text("SELECT * FROM trip_items WHERE trip_id = :trip_id ORDER BY shopping_group, name"),
        {"trip_id": trip["id"]},
    ).fetchall()

    items_by_group: dict[str, list[dict]] = {}
    checked_names: list[str] = []
    ordered_names: list[str] = []

    for r in rows:
        group = r["shopping_group"] or "Other"
        for_meals_str = r["for_meals"]
        for_meals = [m for m in for_meals_str.split(",") if m] if for_meals_str else []
        items_by_group.setdefault(group, []).append({
            "name": r["name"],
            "for_meals": for_meals,
            "meal_count": r["meal_count"],
            "source": r["source"],
        })
        if r["checked"]:
            checked_names.append(r["name"].lower())
        if r["ordered"]:
            ordered_names.append(r["name"].lower())

    return {
        "start_date": mw.start_date,
        "end_date": mw.end_date,
        "items_by_group": items_by_group,
        "checked": checked_names,
        "ordered": ordered_names,
    }


@router.post("/grocery/add")
async def add_grocery_item(body: dict, request: Request):
    """Add a free-form item to the active trip."""
    from souschef import workflow

    user_id = request.state.user_id
    name = body.get("name", "").strip().lower()
    if not name:
        return {"ok": False}

    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    group = _infer_item_group(conn, name, user_id)
    conn.execute(
        text("""INSERT INTO trip_items
           (trip_id, name, shopping_group, source, for_meals, meal_count)
           VALUES (:trip_id, :name, :group, 'extra', '', 0)
           ON CONFLICT DO NOTHING"""),
        {"trip_id": trip["id"], "name": name, "group": group},
    )
    conn.commit()

    return await get_grocery(request)


@router.post("/grocery/toggle/{item_name:path}")
async def toggle_grocery_item(item_name: str, request: Request):
    """Toggle an item's checked state on the active trip."""
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"name": item_name, "checked": False}

    row = conn.execute(
        text("SELECT id, checked, ordered FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
        {"trip_id": trip["id"], "name": item_name},
    ).fetchone()

    if row:
        new_checked = 0 if row["checked"] else 1
        if new_checked:
            conn.execute(
                text("UPDATE trip_items SET checked = 1, checked_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": row["id"]},
            )
            # If checking off an item not ordered via Kroger, it's in-store
            if not row["ordered"]:
                conn.execute(
                    text("""UPDATE grocery_trips SET order_source = CASE
                           WHEN order_source IN ('none', 'in_store') THEN 'in_store'
                           ELSE 'mixed'
                       END WHERE id = :id"""),
                    {"id": trip["id"]},
                )
        else:
            conn.execute(
                text("UPDATE trip_items SET checked = 0, checked_at = NULL WHERE id = :id"),
                {"id": row["id"]},
            )
        conn.commit()
        checked = bool(new_checked)
    else:
        checked = False

    return {"name": item_name, "checked": checked}


@router.get("/grocery/carryover")
async def get_carryover(request: Request):
    """Check for unchecked items on the active trip (for carryover prompt)."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"has_carryover": False, "items": []}

    rows = conn.execute(
        text("""SELECT name, shopping_group FROM trip_items WHERE trip_id = :trip_id
            AND (
                (checked = 0 AND ordered = 0)
                OR (ordered = 1 AND receipt_status = 'not_fulfilled')
            )"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    items = [{"name": r["name"], "shopping_group": r["shopping_group"]} for r in rows]
    return {"has_carryover": len(items) > 0, "items": items}


@router.post("/grocery/build")
async def build_my_list(request: Request, body: dict = None):
    """Create a new grocery trip. Deactivates old trip, creates new one with meal ingredients + carryover."""
    from souschef import workflow
    from souschef.planner import set_all_grocery

    user_id = request.state.user_id
    body = body or {}
    carryover_items = body.get("carryover", [])
    regular_items = body.get("regulars", [])
    pantry_items = body.get("pantry_items", [])

    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)

    # First, toggle all meals to grocery list
    if mw.meals:
        set_all_grocery(conn, user_id, mw.start_date, mw.end_date, on=True)
        # Refresh mw to pick up the on_grocery changes
        mw = workflow.get_rolling_meals(conn, user_id)

    # Deactivate current active trip
    old_trip = _get_active_trip(conn, user_id)
    if old_trip:
        conn.execute(
            text("UPDATE grocery_trips SET active = 0, completed_at = CURRENT_TIMESTAMP WHERE id = :id"),
            {"id": old_trip["id"]},
        )
        conn.commit()

    # Create new trip
    cursor = conn.execute(
        text("""INSERT INTO grocery_trips (trip_type, start_date, end_date, active, user_id)
           VALUES ('plan', :start_date, :end_date, 1, :user_id)
           RETURNING id"""),
        {"start_date": mw.start_date, "end_date": mw.end_date, "user_id": user_id},
    )
    conn.commit()
    trip_id = cursor.fetchone()["id"]

    # Build meal items
    _build_trip_from_meals(conn, trip_id, mw, user_id)

    # Add carryover items
    for name in carryover_items:
        name_lower = name.lower()
        group = _infer_item_group(conn, name_lower, user_id)
        conn.execute(
            text("""INSERT INTO trip_items
               (trip_id, name, shopping_group, source, for_meals, meal_count)
               VALUES (:trip_id, :name, :group, 'carryover', '', 0)
               ON CONFLICT DO NOTHING"""),
            {"trip_id": trip_id, "name": name_lower, "group": group},
        )

    # Add selected regulars
    for name in regular_items:
        name_lower = name.lower()
        group = _infer_item_group(conn, name_lower, user_id)
        conn.execute(
            text("""INSERT INTO trip_items
               (trip_id, name, shopping_group, source, for_meals, meal_count)
               VALUES (:trip_id, :name, :group, 'regular', '', 0)
               ON CONFLICT DO NOTHING"""),
            {"trip_id": trip_id, "name": name_lower, "group": group},
        )

    # Add selected pantry items (running low)
    for name in pantry_items:
        name_lower = name.lower()
        group = _infer_item_group(conn, name_lower, user_id)
        conn.execute(
            text("""INSERT INTO trip_items
               (trip_id, name, shopping_group, source, for_meals, meal_count)
               VALUES (:trip_id, :name, :group, 'pantry', '', 0)
               ON CONFLICT DO NOTHING"""),
            {"trip_id": trip_id, "name": name_lower, "group": group},
        )

    conn.commit()

    return await get_grocery(request)


@router.get("/grocery/trips")
async def get_grocery_trips(request: Request):
    """Return all grocery trips with summary stats."""
    user_id = request.state.user_id
    conn = _conn()
    trips = conn.execute(
        text("SELECT * FROM grocery_trips WHERE user_id = :user_id ORDER BY id DESC"),
        {"user_id": user_id},
    ).fetchall()

    result = []
    for t in trips:
        items = conn.execute(
            text("SELECT name, checked FROM trip_items WHERE trip_id = :trip_id"),
            {"trip_id": t["id"]},
        ).fetchall()
        total = len(items)
        checked = sum(1 for i in items if i["checked"])
        preview = ", ".join(i["name"] for i in items[:4])
        if total > 4:
            preview += "..."

        result.append({
            "id": t["id"],
            "trip_type": t["trip_type"],
            "created_at": t["created_at"],
            "completed_at": t["completed_at"],
            "start_date": t["start_date"],
            "end_date": t["end_date"],
            "active": bool(t["active"]),
            "total_items": total,
            "checked_items": checked,
            "preview": preview,
        })

    return {"trips": result}


# ── Order ────────────────────────────────────────────────


@router.get("/order")
async def get_order(request: Request):
    """Get order state: pending items, selected items, and summary."""
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    rows = conn.execute(
        text("""SELECT * FROM trip_items WHERE trip_id = :trip_id
           AND checked = 0
           ORDER BY shopping_group, name"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    pending = []
    selected = []
    for r in rows:
        item = {
            "name": r["name"],
            "shopping_group": r["shopping_group"],
            "source": r["source"],
            "for_meals": [m for m in r["for_meals"].split(",") if m] if r["for_meals"] else [],
        }
        if r["product_upc"]:
            item["product"] = {
                "upc": r["product_upc"],
                "name": r["product_name"],
                "brand": r["product_brand"],
                "size": r["product_size"],
                "price": r["product_price"],
                "image": r["product_image"],
            }
            selected.append(item)
        else:
            pending.append(item)

    total_price = sum(
        r["product_price"] for r in rows
        if r["product_upc"] and r["product_price"]
    )

    return {
        "pending": pending,
        "selected": selected,
        "total_items": len(selected),
        "total_price": round(total_price, 2),
    }


_search_cache: dict[str, tuple[float, dict]] = {}  # {term: (timestamp, response)}
_SEARCH_CACHE_TTL = 300  # 5 minutes

@router.get("/order/search/{item_name:path}")
async def search_order_products(item_name: str, request: Request):
    """Search Kroger products for a grocery item. Returns products + preferences."""
    import time as _time
    from concurrent.futures import ThreadPoolExecutor
    from souschef.kroger import (
        search_products_fast, fill_prices, _lookup_food_score,
        get_preferred_products,
    )

    user_id = request.state.user_id

    # Return cached response if fresh
    cache_key = item_name.lower().strip()
    if cache_key in _search_cache:
        ts, resp = _search_cache[cache_key]
        if _time.time() - ts < _SEARCH_CACHE_TTL:
            return resp

    conn = _conn()

    # Use ingredient root as search term if available
    ing = conn.execute(
        text("SELECT root FROM ingredients WHERE LOWER(name) = :name"),
        {"name": item_name.lower()},
    ).fetchone()
    search_term = (ing["root"] if ing and ing["root"] else item_name).strip()

    # Get preferences first
    prefs = get_preferred_products(conn, user_id, item_name, limit=3)
    pref_list = [{
        "upc": p.upc,
        "name": p.description,
        "brand": p.brand,
        "size": p.size,
        "rating": p.rating,
        "image": f"https://www.kroger.com/product/images/medium/front/{p.upc}",
    } for p in prefs]

    # Search Kroger
    try:
        products = search_products_fast(search_term, limit=12)
    except Exception as e:
        import traceback
        traceback.print_exc()
        products = []

    # Check cache for prices (today) and scores (90 days)
    import datetime as _dt
    _SCORE_TTL_DAYS = 90
    _today = _dt.date.today().isoformat()
    _score_cutoff = (_dt.datetime.now() - _dt.timedelta(days=_SCORE_TTL_DAYS)).isoformat()

    cached = {}
    if products:
        upcs = [p.upc for p in products[:6]]
        placeholders = ", ".join(f":p{i}" for i in range(len(upcs)))
        params = {f"p{i}": upc for i, upc in enumerate(upcs)}
        rows = conn.execute(
            text(f"SELECT upc, nova_group, nutriscore, price, promo_price, "
                 f"in_stock, curbside, score_fetched_at, price_fetched_at "
                 f"FROM product_scores "
                 f"WHERE upc IN ({placeholders})"),
            params,
        ).fetchall()
        cached = {r["upc"]: dict(r) for r in rows}

    # --- Prices: use today's cache or fill from Kroger ---
    need_price = []
    for p in products[:6]:
        c = cached.get(p.upc)
        if c and c["price_fetched_at"] and c["price_fetched_at"][:10] == _today:
            p.price = c["price"] if c["price"] is not None else p.price
            p.promo_price = c["promo_price"]
            p.in_stock = bool(c["in_stock"]) if c["in_stock"] is not None else p.in_stock
            p.curbside = bool(c["curbside"]) if c["curbside"] is not None else p.curbside
        else:
            need_price.append(p)

    if need_price:
        try:
            fill_prices(need_price)
        except Exception:
            pass

    # --- Scores: use cached or fetch from Open Food Facts ---
    need_scores = []
    for p in products[:6]:
        c = cached.get(p.upc)
        if c and c["nova_group"] is not None and c["score_fetched_at"] > _score_cutoff:
            p.nova_group = c["nova_group"]
            p.nutriscore = c["nutriscore"] or ""
        else:
            need_scores.append(p)

    def _fetch_score(p):
        nova, nutri = _lookup_food_score(p.description, p.brand)
        p.nova_group = nova
        p.nutriscore = nutri or ""

    if need_scores:
        with ThreadPoolExecutor(max_workers=6) as pool:
            pool.map(_fetch_score, need_scores)

    # --- Save everything to cache ---
    for p in products[:6]:
        conn.execute(
            text("""INSERT INTO product_scores
               (upc, nova_group, nutriscore, score_fetched_at, price, promo_price, in_stock, curbside, price_fetched_at)
               VALUES (:upc, :nova_group, :nutriscore, CURRENT_TIMESTAMP, :price, :promo_price, :in_stock, :curbside, CURRENT_TIMESTAMP)
               ON CONFLICT(upc) DO UPDATE SET
               nova_group=COALESCE(excluded.nova_group, nova_group),
               nutriscore=CASE WHEN excluded.nova_group IS NOT NULL THEN excluded.nutriscore ELSE nutriscore END,
               score_fetched_at=CASE WHEN excluded.nova_group IS NOT NULL THEN excluded.score_fetched_at ELSE score_fetched_at END,
               price=excluded.price, promo_price=excluded.promo_price,
               in_stock=excluded.in_stock, curbside=excluded.curbside,
               price_fetched_at=excluded.price_fetched_at"""),
            {"upc": p.upc, "nova_group": p.nova_group, "nutriscore": p.nutriscore or "",
             "price": p.price, "promo_price": p.promo_price,
             "in_stock": int(p.in_stock), "curbside": int(p.curbside)},
        )
    conn.commit()

    result = []
    for p in products:
        result.append({
            "upc": p.upc,
            "product_id": p.product_id,
            "name": p.description,
            "brand": p.brand,
            "size": p.size,
            "price": p.price,
            "promo_price": p.promo_price,
            "in_stock": p.in_stock,
            "curbside": p.curbside,
            "nova": p.nova_group,
            "nutriscore": p.nutriscore,
            "image": p.image_url,
            "rating": p.rating,
        })

    response = {
        "item_name": item_name,
        "search_term": search_term,
        "preferences": pref_list,
        "products": result,
    }
    _search_cache[cache_key] = (_time.time(), response)
    return response


@router.post("/order/select")
async def select_product(body: dict, request: Request):
    """Select a Kroger product for a grocery item."""
    from souschef.kroger import save_preference, KrogerProduct
    from souschef import workflow

    user_id = request.state.user_id
    item_name = body["item_name"]
    product = body["product"]  # {upc, name, brand, size, price, image}

    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    conn.execute(
        text("""UPDATE trip_items SET
               product_upc = :upc, product_name = :name, product_brand = :brand,
               product_size = :size, product_price = :price, product_image = :image,
               ordered = 1, ordered_at = CURRENT_TIMESTAMP, selected_at = CURRENT_TIMESTAMP
           WHERE trip_id = :trip_id AND LOWER(name) = :item_name"""),
        {"upc": product["upc"], "name": product["name"], "brand": product.get("brand", ""),
         "size": product.get("size", ""), "price": product.get("price"),
         "image": product.get("image", ""),
         "trip_id": trip["id"], "item_name": item_name.lower()},
    )
    # Update trip source based on what's happening
    conn.execute(
        text("""UPDATE grocery_trips SET order_source = CASE
               WHEN order_source IN ('none', 'kroger') THEN 'kroger'
               ELSE 'mixed'
           END WHERE id = :id"""),
        {"id": trip["id"]},
    )
    conn.commit()

    # Save preference for future searches
    kp = KrogerProduct(
        product_id="", upc=product["upc"],
        description=product["name"], brand=product.get("brand", ""),
        size=product.get("size", ""),
    )
    save_preference(conn, user_id, item_name, kp, source="picked")

    return await get_order(request)


@router.post("/order/deselect/{item_name:path}")
async def deselect_product(item_name: str, request: Request):
    """Remove product selection for a grocery item."""
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    conn.execute(
        text("""UPDATE trip_items SET
               product_upc = '', product_name = '', product_brand = '',
               product_size = '', product_price = NULL, product_image = '',
               ordered = 0, ordered_at = NULL, selected_at = NULL
           WHERE trip_id = :trip_id AND LOWER(name) = :name"""),
        {"trip_id": trip["id"], "name": item_name.lower()},
    )
    conn.commit()

    return await get_order(request)


@router.post("/order/submit")
async def submit_order(request: Request):
    """Submit all selected products to Kroger cart."""
    from souschef.kroger import add_to_cart
    from souschef import workflow

    user_id = request.state.user_id
    conn = _conn()
    mw = workflow.get_rolling_meals(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    rows = conn.execute(
        text("""SELECT product_upc FROM trip_items
           WHERE trip_id = :trip_id AND product_upc != '' AND ordered = 1"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    if not rows:
        return {"ok": False, "error": "No products selected"}

    items = [{"upc": r["product_upc"]} for r in rows]
    try:
        add_to_cart(items)
        return {"ok": True, "count": len(items)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Receipt ───────────────────────────────────────────────


@router.get("/receipt")
async def get_receipt(request: Request):
    """Get receipt/reconciliation state for the active trip."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"has_trip": False}

    order_source = trip["order_source"] if "order_source" in trip.keys() else "none"
    has_receipt = bool(trip["receipt_data"]) if "receipt_data" in trip.keys() and trip["receipt_data"] else False

    # Get all trip items with their states (single query)
    rows = conn.execute(
        text("SELECT * FROM trip_items WHERE trip_id = :trip_id ORDER BY shopping_group, name"),
        {"trip_id": trip["id"]},
    ).fetchall()

    items = []
    has_ordered = False
    has_checked = False
    for r in rows:
        if r["checked"]:
            has_checked = True
        if r["ordered"]:
            has_ordered = True
        items.append({
            "name": r["name"],
            "shopping_group": r["shopping_group"],
            "checked": bool(r["checked"]),
            "ordered": bool(r["ordered"]),
            "product_upc": r["product_upc"],
            "product_name": r["product_name"],
            "product_price": r["product_price"],
            "receipt_item": r["receipt_item"],
            "receipt_price": r["receipt_price"],
            "receipt_upc": r["receipt_upc"],
            "receipt_status": r["receipt_status"],
        })

    # Categorize
    matched = [i for i in items if i["receipt_status"] == "matched"]
    substituted = [i for i in items if i["receipt_status"] == "substituted"]
    not_fulfilled = [i for i in items if i["receipt_status"] == "not_fulfilled"]
    unresolved = [i for i in items if (i["checked"] or i["ordered"]) and not i["receipt_status"]]

    return {
        "has_trip": True,
        "trip_id": trip["id"],
        "order_source": order_source,
        "has_receipt": has_receipt,
        "has_ordered": has_ordered,
        "has_checked": has_checked,
        "matched": matched,
        "substituted": substituted,
        "not_fulfilled": not_fulfilled,
        "unresolved": unresolved,
    }


@router.post("/receipt/upload")
async def upload_receipt(body: dict, request: Request):
    """Upload and parse a receipt. Accepts {type: 'text'|'pdf_path'|'image_path', content: str}."""
    from souschef.reconcile import (
        parse_receipt_text, parse_receipt_pdf, parse_receipt_image,
        parse_receipt_email, diff_order, diff_grocery_list,
    )

    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    receipt_type = body.get("type", "text")
    content = body.get("content", "")

    # Parse receipt
    try:
        if receipt_type == "pdf_path":
            receipt_items = parse_receipt_pdf(content)
        elif receipt_type == "image_path":
            receipt_items = parse_receipt_image(content)
        elif receipt_type == "eml_path":
            receipt_items = parse_receipt_email(content)
        else:
            receipt_items = parse_receipt_text(content)
    except Exception as e:
        return {"ok": False, "error": f"Failed to parse receipt: {e}"}

    if not receipt_items:
        return {"ok": False, "error": "No items found on receipt"}

    # Append receipt data (support multiple receipts per trip)
    import json
    existing_data = trip["receipt_data"] if "receipt_data" in trip.keys() and trip["receipt_data"] else None
    if existing_data:
        try:
            all_receipts = json.loads(existing_data)
            if isinstance(all_receipts, list) and all_receipts and not isinstance(all_receipts[0], list):
                # First receipt was stored as flat list — wrap it
                all_receipts = [all_receipts]
            all_receipts.append(receipt_items)
        except (json.JSONDecodeError, TypeError):
            all_receipts = [receipt_items]
    else:
        all_receipts = [receipt_items]
    conn.execute(
        text("UPDATE grocery_trips SET receipt_data = :data, receipt_parsed_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"data": json.dumps(all_receipts), "id": trip["id"]},
    )

    # Get trip items that still need matching (unresolved or not_fulfilled from prior receipt)
    rows = conn.execute(
        text("""SELECT * FROM trip_items WHERE trip_id = :trip_id
           AND (ordered = 1 OR checked = 1)
           AND receipt_status IN ('', 'not_fulfilled')
           ORDER BY name"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    # Choose diff method based on whether we have UPC data
    has_upcs = any(r["product_upc"] for r in rows)
    if has_upcs:
        submitted = [{"upc": r["product_upc"], "product": r["product_name"], "item": r["name"]} for r in rows]
        diff = diff_order(submitted, receipt_items)

        # Apply matches
        for m in diff["matched"]:
            r = m["receipt"]
            conn.execute(
                text("""UPDATE trip_items SET
                       receipt_item = :receipt_item, receipt_price = :receipt_price, receipt_upc = :receipt_upc,
                       receipt_status = 'matched'
                   WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                {"receipt_item": r.get("item", ""), "receipt_price": r.get("price"),
                 "receipt_upc": r.get("upc", ""),
                 "trip_id": trip["id"], "name": m["submitted"]["item"]},
            )

        # Mark removed items as not fulfilled
        for r in diff["removed"]:
            conn.execute(
                text("""UPDATE trip_items SET receipt_status = 'not_fulfilled'
                   WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                {"trip_id": trip["id"], "name": r.get("item", r.get("product", ""))},
            )

        # Added items are potential substitutions — mark as substituted
        # (these are receipt items that didn't match any order item)
        extra_items = diff.get("added", [])
    else:
        grocery_names = [r["name"] for r in rows]
        diff = diff_grocery_list(grocery_names, receipt_items)

        for m in diff["matched"]:
            r = m["receipt"]
            conn.execute(
                text("""UPDATE trip_items SET
                       receipt_item = :receipt_item, receipt_price = :receipt_price, receipt_upc = :receipt_upc,
                       receipt_status = 'matched'
                   WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                {"receipt_item": r.get("item", ""), "receipt_price": r.get("price"),
                 "receipt_upc": r.get("upc", ""),
                 "trip_id": trip["id"], "name": m["grocery_name"]},
            )

        # Items checked/ordered but not on receipt
        matched_names = {m["grocery_name"].lower() for m in diff["matched"]}
        for r in rows:
            if r["name"].lower() not in matched_names:
                conn.execute(
                    text("UPDATE trip_items SET receipt_status = 'not_fulfilled' WHERE id = :id"),
                    {"id": r["id"]},
                )

        extra_items = diff.get("unmatched", [])

    conn.commit()

    return {
        "ok": True,
        "matched": len(diff.get("matched", [])),
        "not_fulfilled": len(diff.get("removed", [])) if has_upcs else sum(1 for r in rows if r["name"].lower() not in {m["grocery_name"].lower() for m in diff.get("matched", [])}),
        "extra_items": extra_items,
    }


@router.post("/receipt/upload-file")
async def upload_receipt_file(request: Request, file: UploadFile = File(...)):
    """Upload a receipt file (PDF, image, or .eml) and parse + reconcile it."""
    import tempfile
    import os

    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    # Save uploaded file to temp location
    suffix = os.path.splitext(file.filename or "")[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Route to correct parser
        if suffix == ".pdf":
            body = {"type": "pdf_path", "content": tmp_path}
        elif suffix == ".eml":
            body = {"type": "eml_path", "content": tmp_path}
        elif suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            body = {"type": "image_path", "content": tmp_path}
        else:
            # Try as text
            text_content = content.decode("utf-8", errors="replace")
            body = {"type": "text", "content": text_content}

        return await upload_receipt(body, request)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@router.post("/receipt/resolve")
async def resolve_receipt_item(body: dict, request: Request):
    """Resolve a receipt item. {name: str, status: 'matched'|'substituted'|'not_fulfilled', note: str?}"""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False}

    name = body["name"]
    status = body["status"]

    if status == "recover":
        # Put item back on the active grocery list (un-order it)
        conn.execute(
            text("""UPDATE trip_items SET ordered = 0, receipt_status = ''
               WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
            {"trip_id": trip["id"], "name": name},
        )
    elif status == "dismissed":
        # Acknowledged as not needed — mark so it doesn't keep prompting
        conn.execute(
            text("UPDATE trip_items SET receipt_status = 'dismissed' WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
            {"trip_id": trip["id"], "name": name},
        )
    else:
        conn.execute(
            text("UPDATE trip_items SET receipt_status = :status WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
            {"status": status, "trip_id": trip["id"], "name": name},
        )
    conn.commit()
    return {"ok": True}


@router.post("/receipt/close")
async def close_receipt(request: Request):
    """Finalize the receipt — update preferences, return unfulfilled to list."""
    from souschef.kroger import save_preference, KrogerProduct

    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    # Update preferences from receipt data (confirmed purchases)
    matched = conn.execute(
        text("""SELECT * FROM trip_items WHERE trip_id = :trip_id AND receipt_status = 'matched'
           AND receipt_upc != ''"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    for r in matched:
        kp = KrogerProduct(
            product_id="", upc=r["receipt_upc"],
            description=r["receipt_item"], brand="",
            size=r["product_size"] if "product_size" in r.keys() and r["product_size"] else "",
        )
        kp.price = r["receipt_price"]
        try:
            save_preference(conn, user_id, r["name"], kp, source="receipt")
        except Exception:
            pass

    # Mark trip complete
    conn.execute(
        text("UPDATE grocery_trips SET active = 0, completed_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"id": trip["id"]},
    )
    conn.commit()

    return {"ok": True}


@router.post("/receipt/close-no-receipt")
async def close_no_receipt(request: Request):
    """Close trip without receipt — just mark complete with whatever state exists."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    conn.execute(
        text("UPDATE grocery_trips SET active = 0, completed_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"id": trip["id"]},
    )
    conn.commit()

    return {"ok": True}


# ── Regulars ─────────────────────────────────────────────


@router.get("/regulars")
async def get_regulars(request: Request):
    """Get all regulars, grouped by shopping_group."""
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    conn = _conn()
    regulars = list_regulars(conn, user_id, active_only=False)
    return {
        "regulars": [
            {
                "id": r.id,
                "name": r.name,
                "shopping_group": r.shopping_group,
                "store_pref": r.store_pref,
                "active": r.active,
            }
            for r in regulars
        ]
    }


@router.post("/regulars")
async def add_regular(body: dict, request: Request):
    """Add a new regular item."""
    from souschef.regulars import add_regular as do_add

    user_id = request.state.user_id
    conn = _conn()
    r = do_add(conn, user_id, body["name"], body.get("shopping_group", ""), body.get("store_pref", "either"))
    return {
        "id": r.id,
        "name": r.name,
        "shopping_group": r.shopping_group,
        "store_pref": r.store_pref,
        "active": r.active,
    }


@router.post("/regulars/{regular_id}/toggle")
async def toggle_regular(regular_id: int, request: Request):
    """Toggle a regular's active state."""
    from souschef.regulars import toggle_regular as do_toggle

    user_id = request.state.user_id
    conn = _conn()
    r = do_toggle(conn, user_id, regular_id)
    if r is None:
        return {"ok": False}
    return {
        "id": r.id,
        "name": r.name,
        "shopping_group": r.shopping_group,
        "store_pref": r.store_pref,
        "active": r.active,
    }


@router.delete("/regulars/{name:path}")
async def remove_regular(name: str, request: Request):
    """Soft-delete a regular."""
    from souschef.regulars import remove_regular as do_remove

    user_id = request.state.user_id
    conn = _conn()
    ok = do_remove(conn, user_id, name)
    return {"ok": ok}


@router.get("/grocery/suggestions")
async def grocery_suggestions(request: Request):
    """Return all known item names for autocomplete."""
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    conn = _conn()
    names: set[str] = set()

    # Regulars
    for r in list_regulars(conn, user_id, active_only=False):
        names.add(r.name)

    # All ingredients
    rows = conn.execute(text("SELECT name FROM ingredients")).fetchall()
    for row in rows:
        names.add(row["name"])

    return {"suggestions": sorted(names, key=str.lower)}


# ── Recipes ──────────────────────────────────────────────


@router.get("/recipes")
async def get_recipes(request: Request):
    from souschef.recipes import list_recipes

    conn = _conn()
    recipes = list_recipes(conn)
    return {"recipes": [_recipe_dict(r) for r in recipes]}


# ── Pantry ──────────────────────────────────────────────


@router.get("/pantry")
async def get_pantry(request: Request):
    """List all pantry items."""
    from souschef.pantry import list_pantry

    user_id = request.state.user_id
    conn = _conn()
    items = list_pantry(conn, user_id)
    return {
        "items": [
            {
                "id": p.id,
                "ingredient_id": p.ingredient_id,
                "name": p.ingredient_name,
                "quantity": p.quantity,
                "unit": p.unit,
            }
            for p in items
        ]
    }


@router.post("/pantry")
async def add_pantry(body: dict, request: Request):
    """Add a pantry item by ingredient name."""
    from souschef.pantry import add_pantry_item

    user_id = request.state.user_id
    conn = _conn()
    name = body.get("name", "").strip()
    quantity = body.get("quantity", 1.0)
    unit = body.get("unit", "count")

    # If ingredient doesn't exist, create it
    ing = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = :name"),
        {"name": name.lower()},
    ).fetchone()
    if not ing:
        conn.execute(
            text("INSERT INTO ingredients (name, aisle) VALUES (:name, :aisle)"),
            {"name": name.lower(), "aisle": body.get("shopping_group", "Other")},
        )
        conn.commit()

    result = add_pantry_item(conn, user_id, name.lower(), quantity, unit)
    if result is None:
        return {"ok": False}
    return {"ok": True, "id": result.id, "name": result.ingredient_name}


@router.delete("/pantry/{item_id}")
async def remove_pantry(item_id: int, request: Request):
    """Remove a pantry item."""
    conn = _conn()
    user_id = request.state.user_id
    conn.execute(
        text("DELETE FROM pantry WHERE id = :id AND user_id = :user_id"),
        {"id": item_id, "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


# ── Stores ─────────────────────────────────────────────


@router.get("/stores")
async def get_stores(request: Request):
    """List configured stores."""
    from souschef.stores import list_stores

    return {"stores": list_stores()}


@router.post("/stores")
async def add_store(body: dict, request: Request):
    """Add a store."""
    from souschef.stores import add_store as do_add

    name = body.get("name", "").strip()
    key = body.get("key", name[:1].lower() if name else "x")
    mode = body.get("mode", "in-person")
    api_type = body.get("api", "none")

    try:
        store = do_add(name, key, mode, api_type)
        return {"ok": True, "store": store}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


@router.delete("/stores/{key}")
async def remove_store(key: str, request: Request):
    """Remove a store by key."""
    from souschef.stores import remove_store as do_remove

    removed = do_remove(key)
    return {"ok": bool(removed), "name": removed}


# ── Onboarding ─────────────────────────────────────────


@router.get("/onboarding/status")
async def onboarding_status(request: Request):
    """Check whether onboarding has been completed."""
    user_id = request.state.user_id
    conn = _conn()
    row = conn.execute(
        text("SELECT value FROM settings WHERE key = 'onboarding_complete' AND user_id = :user_id"),
        {"user_id": user_id},
    ).fetchone()
    return {"completed": row is not None and row["value"] == "true"}


@router.post("/onboarding/complete")
async def onboarding_complete(request: Request):
    """Mark onboarding as done."""
    user_id = request.state.user_id
    conn = _conn()
    conn.execute(
        text("""INSERT INTO settings (user_id, key, value, updated_at)
           VALUES (:user_id, 'onboarding_complete', 'true', CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP"""),
        {"user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


@router.post("/meals/add-to-pool")
async def add_meal_to_pool(body: dict, request: Request):
    """Create a recipe stub (name only) for onboarding. No ingredients."""
    conn = _conn()
    name = body.get("name", "").strip()
    if not name:
        return {"ok": False}

    # Check if recipe already exists
    existing = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = :name"),
        {"name": name.lower()},
    ).fetchone()
    if existing:
        return {"ok": True, "id": existing["id"], "name": name}

    cursor = conn.execute(
        text("""INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
           prep_minutes, cook_minutes, servings)
           VALUES (:name, '', 'medium', 'medium', 0, 1, 0, 0, 0, 4)
           RETURNING id"""),
        {"name": name},
    )
    conn.commit()
    return {"ok": True, "id": cursor.fetchone()["id"], "name": name}


# ── Grocery Active Trip ────────────────────────────────


@router.get("/grocery/active-trip")
async def get_active_trip_info(request: Request):
    """Return info about the active trip, or null if none."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"active_trip": None}

    item_count = conn.execute(
        text("SELECT COUNT(*) as c FROM trip_items WHERE trip_id = :trip_id"),
        {"trip_id": trip["id"]},
    ).fetchone()["c"]
    checked_count = conn.execute(
        text("SELECT COUNT(*) as c FROM trip_items WHERE trip_id = :trip_id AND checked = 1"),
        {"trip_id": trip["id"]},
    ).fetchone()["c"]

    return {
        "active_trip": {
            "id": trip["id"],
            "start_date": trip["start_date"],
            "end_date": trip["end_date"],
            "created_at": trip["created_at"],
            "total_items": item_count,
            "checked_items": checked_count,
        }
    }


# ── Meal History & Suggestions ─────────────────────────


@router.get("/meals/history")
async def get_meal_history(request: Request):
    """Get meal frequency stats from all history."""
    user_id = request.state.user_id
    conn = _conn()
    rows = conn.execute(
        text("""SELECT recipe_id, recipe_name, COUNT(*) as cook_count,
                  MAX(slot_date) as last_made
           FROM meals
           WHERE recipe_id IS NOT NULL AND user_id = :user_id
           GROUP BY recipe_id, recipe_name
           ORDER BY cook_count DESC"""),
        {"user_id": user_id},
    ).fetchall()
    return {
        "history": [
            {
                "recipe_id": r["recipe_id"],
                "recipe_name": r["recipe_name"],
                "cook_count": r["cook_count"],
                "last_made": r["last_made"],
            }
            for r in rows
        ]
    }


# ── Learning ───────────────────────────────────────────


@router.get("/learning/suggestions")
async def get_learning_suggestions(request: Request):
    """Suggest regulars additions/removals based on trip patterns."""
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    conn = _conn()

    # Get completed trips (last 5)
    trips = conn.execute(
        text("SELECT id FROM grocery_trips WHERE active = 0 AND user_id = :user_id ORDER BY id DESC LIMIT 5"),
        {"user_id": user_id},
    ).fetchall()

    if len(trips) < 3:
        return {"add": [], "remove": []}

    trip_ids = [t["id"] for t in trips]

    # Items that appear on 3+ consecutive trips but aren't regulars
    regulars = list_regulars(conn, user_id, active_only=False)
    regular_names = {r.name.lower() for r in regulars}

    item_freq = {}
    for tid in trip_ids:
        items = conn.execute(
            text("SELECT DISTINCT LOWER(name) as name FROM trip_items WHERE trip_id = :trip_id"),
            {"trip_id": tid},
        ).fetchall()
        for item in items:
            item_freq[item["name"]] = item_freq.get(item["name"], 0) + 1

    add_suggestions = []
    for name, count in item_freq.items():
        if count >= 3 and name not in regular_names:
            # Check not dismissed
            dismissed = conn.execute(
                text("SELECT 1 FROM learning_dismissed WHERE name = :name AND user_id = :user_id"),
                {"name": name, "user_id": user_id},
            ).fetchone()
            if not dismissed:
                add_suggestions.append({"name": name, "trip_count": count})

    # Regulars that are active but unchecked on recent trips
    remove_suggestions = []
    active_regulars = [r for r in regulars if r.active]
    for reg in active_regulars:
        name_lower = reg.name.lower()
        # Check if it was on the trip and unchecked for 3+ trips
        unchecked_count = 0
        for tid in trip_ids[:3]:
            item = conn.execute(
                text("""SELECT checked FROM trip_items
                   WHERE trip_id = :trip_id AND LOWER(name) = :name AND source = 'regular'"""),
                {"trip_id": tid, "name": name_lower},
            ).fetchone()
            if item and not item["checked"]:
                unchecked_count += 1
            elif not item:
                unchecked_count += 1  # not even on the trip
        if unchecked_count >= 3:
            dismissed = conn.execute(
                text("SELECT 1 FROM learning_dismissed WHERE name = :name AND user_id = :user_id"),
                {"name": name_lower, "user_id": user_id},
            ).fetchone()
            if not dismissed:
                remove_suggestions.append({"name": reg.name, "id": reg.id})

    return {
        "add": add_suggestions[:5],
        "remove": remove_suggestions[:5],
    }


@router.post("/learning/dismiss/{name:path}")
async def dismiss_learning(name: str, request: Request):
    """Dismiss a learning suggestion so it doesn't appear again."""
    user_id = request.state.user_id
    conn = _conn()
    conn.execute(
        text("INSERT INTO learning_dismissed (name, user_id) VALUES (:name, :user_id) ON CONFLICT DO NOTHING"),
        {"name": name.lower(), "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


# ── Shopping Feedback ─────────────────────────────────────


@router.get("/feedback/patterns")
async def get_feedback_patterns(request: Request):
    """Detect shopping patterns from completed trips."""
    from souschef.feedback import detect_skipped_items, detect_extra_meal_links

    user_id = request.state.user_id
    conn = _conn()
    return {
        "skipped": detect_skipped_items(conn, user_id),
        "extra_links": detect_extra_meal_links(conn, user_id),
    }


@router.post("/feedback/dismiss")
async def dismiss_feedback(body: dict, request: Request):
    """Dismiss a feedback suggestion. Body: {item, meal, kind: 'skip'|'extra_link'}."""
    user_id = request.state.user_id
    item = body.get("item", "").strip().lower()
    meal = body.get("meal", "").strip().lower()
    kind = body.get("kind", "skip")
    if not item or not meal:
        return {"ok": False, "error": "item and meal required"}

    key = f"{item}::{meal}"
    conn = _conn()
    conn.execute(
        text("INSERT INTO learning_dismissed (name, kind, user_id) VALUES (:name, :kind, :user_id) ON CONFLICT DO NOTHING"),
        {"name": key, "kind": kind, "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


@router.post("/feedback/apply")
async def apply_feedback(body: dict, request: Request):
    """Apply a feedback override. Body: {item, meal, action: 'skip'|'add'}."""
    user_id = request.state.user_id
    item = body.get("item", "").strip().lower()
    meal = body.get("meal", "").strip()
    action = body.get("action", "skip")
    if not item or not meal or action not in ("skip", "add"):
        return {"ok": False, "error": "item, meal, and valid action required"}

    conn = _conn()
    conn.execute(
        text("""INSERT INTO meal_item_overrides (recipe_name, item_name, action, user_id)
           VALUES (:meal, :item, :action, :user_id)
           ON CONFLICT (recipe_name, item_name, user_id) DO UPDATE SET action = :action"""),
        {"meal": meal, "item": item, "action": action, "user_id": user_id},
    )
    conn.commit()

    # Also dismiss so it doesn't keep showing up
    kind = "skip" if action == "skip" else "extra_link"
    key = f"{item}::{meal.lower()}"
    conn.execute(
        text("INSERT INTO learning_dismissed (name, kind, user_id) VALUES (:name, :kind, :user_id) ON CONFLICT DO NOTHING"),
        {"name": key, "kind": kind, "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


@router.get("/feedback/overrides")
async def get_feedback_overrides(request: Request):
    """Get all active meal item overrides."""
    from souschef.feedback import get_overrides
    user_id = request.state.user_id
    conn = _conn()
    return {"overrides": get_overrides(conn, user_id)}


@router.delete("/feedback/overrides")
async def remove_feedback_override(body: dict, request: Request):
    """Remove an override. Body: {item, meal}."""
    user_id = request.state.user_id
    item = body.get("item", "").strip().lower()
    meal = body.get("meal", "").strip()
    if not item or not meal:
        return {"ok": False, "error": "item and meal required"}

    conn = _conn()
    conn.execute(
        text("DELETE FROM meal_item_overrides WHERE LOWER(recipe_name) = LOWER(:meal) AND item_name = :item AND user_id = :user_id"),
        {"meal": meal, "item": item, "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


# ── Household ─────────────────────────────────────────────


@router.get("/household/members")
async def get_household_members(request: Request):
    """List members of the current user's household."""
    from souschef.web.auth import get_household_id

    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    hh_id = get_household_id(conn, real_user_id)
    if not hh_id:
        return {"members": [], "household_id": None}

    rows = conn.execute(
        text("""SELECT hm.user_id, hm.role, u.email, u.display_name
               FROM household_members hm
               JOIN users u ON u.id = hm.user_id
               WHERE hm.household_id = :hh_id
               ORDER BY hm.role DESC, hm.joined_at"""),
        {"hh_id": hh_id},
    ).fetchall()

    return {
        "household_id": hh_id,
        "members": [
            {
                "user_id": r["user_id"],
                "email": r["email"],
                "display_name": r["display_name"] or r["email"].split("@")[0],
                "role": r["role"],
                "is_you": r["user_id"] == real_user_id,
            }
            for r in rows
        ],
    }


@router.post("/household/invite")
async def invite_to_household(body: dict, request: Request):
    """Invite someone to share your household."""
    from souschef.web.auth import get_household_id, send_magic_link_email, find_or_create_user, create_magic_link

    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    email = body.get("email", "").strip().lower()
    if not email:
        return {"ok": False, "error": "Email required"}

    conn = _conn()
    hh_id = get_household_id(conn, real_user_id)
    if not hh_id:
        return {"ok": False, "error": "No household found"}

    # Check if already a member
    existing = conn.execute(
        text("""SELECT 1 FROM household_members hm
               JOIN users u ON u.id = hm.user_id
               WHERE hm.household_id = :hh_id AND LOWER(u.email) = :email"""),
        {"hh_id": hh_id, "email": email},
    ).fetchone()
    if existing:
        return {"ok": False, "error": "Already a household member"}

    # Create invite record
    conn.execute(
        text("""INSERT INTO household_invites (household_id, email, invited_by, status)
           VALUES (:hh_id, :email, :user_id, 'pending')"""),
        {"hh_id": hh_id, "email": email, "user_id": real_user_id},
    )

    # Add to allowed_emails so they can sign up
    conn.execute(
        text("INSERT INTO allowed_emails (email) VALUES (:email) ON CONFLICT DO NOTHING"),
        {"email": email},
    )

    # Create user + send magic link
    user_id = find_or_create_user(conn, email)
    token = create_magic_link(conn, user_id)
    send_magic_link_email(email, token)

    conn.commit()
    return {"ok": True}


@router.post("/beta/invite")
async def invite_to_beta(body: dict, request: Request):
    """Invite someone to try souschef (separate account, no household sharing)."""
    from souschef.web.auth import find_or_create_user, create_magic_link, send_magic_link_email

    email = body.get("email", "").strip().lower()
    if not email:
        return {"ok": False, "error": "Email required"}

    conn = _conn()

    # Add to allowed_emails
    conn.execute(
        text("INSERT INTO allowed_emails (email) VALUES (:email) ON CONFLICT DO NOTHING"),
        {"email": email},
    )

    # Create user + send magic link
    user_id = find_or_create_user(conn, email)
    token = create_magic_link(conn, user_id)
    send_magic_link_email(email, token)

    conn.commit()
    return {"ok": True}


# ── Feedback ──────────────────────────────────────────────


@router.post("/feedback")
async def submit_feedback(body: dict, request: Request):
    """Save user feedback."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    message = body.get("message", "").strip()
    page = body.get("page", "")
    if not message:
        return {"ok": False, "error": "Message required"}

    conn = _conn()
    conn.execute(
        text("""INSERT INTO user_feedback (user_id, message, page)
           VALUES (:user_id, :message, :page)"""),
        {"user_id": real_user_id, "message": message, "page": page},
    )
    conn.commit()
    return {"ok": True}


# ── Helpers ──────────────────────────────────────────────


def _meal_dict(m) -> dict:
    return {
        "id": m.id,
        "slot_date": m.slot_date,
        "recipe_id": m.recipe_id,
        "recipe_name": m.recipe_name,
        "side": m.side,
        "locked": m.locked,
        "is_followup": m.is_followup,
        "on_grocery": m.on_grocery,
        "day_name": m.day_name,
        "day_short": m.day_short,
    }


def _recipe_dict(r) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "cuisine": r.cuisine,
        "effort": r.effort,
        "cleanup": r.cleanup,
        "outdoor": r.outdoor,
        "kid_friendly": r.kid_friendly,
        "premade": r.premade,
        "prep_minutes": r.prep_minutes,
        "cook_minutes": r.cook_minutes,
        "servings": r.servings,
    }
