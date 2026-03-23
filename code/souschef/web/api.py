"""JSON API endpoints for the React frontend."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy import text

logger = logging.getLogger(__name__)

from souschef.db import ensure_db

router = APIRouter(prefix="/api")


def _conn():
    return ensure_db()


# ── Per-user rate limiting for expensive endpoints ────────

import time as _throttle_time

_user_request_log: dict[str, list[float]] = {}  # {"endpoint:user_id": [timestamps]}


def _check_throttle(user_id: str, endpoint: str, max_requests: int, window_seconds: int):
    """Return a 429 JSONResponse if the user exceeds the rate limit, else None."""
    key = f"{endpoint}:{user_id}"
    now = _throttle_time.time()
    timestamps = _user_request_log.get(key, [])
    # Prune old entries
    timestamps = [t for t in timestamps if now - t < window_seconds]
    if len(timestamps) >= max_requests:
        _user_request_log[key] = timestamps
        return JSONResponse(
            status_code=429,
            content={"ok": False, "error": "Too many requests, please try again later"},
        )
    timestamps.append(now)
    _user_request_log[key] = timestamps
    return None


# ── Meals ────────────────────────────────────────────────


@router.get("/meals")
async def get_meals(request: Request):
    """Get rolling 7-day meals."""
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
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
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    body = body or {}
    action = body.get("action", "preview")
    conn = _conn()

    if action == "preview":
        # Wrap read-swap-read in a transaction to prevent interleaving
        with conn.begin():
            # Get the old meal's info before swapping
            old_meal = conn.execute(
                text("SELECT recipe_id, recipe_name, on_grocery FROM meals WHERE slot_date = :date AND user_id = :user_id"),
                {"date": date, "user_id": user_id},
            ).fetchone()
            old_was_on_list = old_meal and old_meal["on_grocery"]

            # Find old meal's unique ingredients (not shared by other on-list meals)
            removable = []
            if old_was_on_list and old_meal["recipe_id"]:
                mw = load_rolling_week(conn, user_id)
                # Get all ingredients for the OLD meal (including sides)
                old_ingredients = set()
                old_recipe_ids = [old_meal["recipe_id"]]
                # Also gather side recipe IDs
                old_meal_row = conn.execute(
                    text("SELECT id FROM meals WHERE slot_date = :date AND user_id = :user_id"),
                    {"date": date, "user_id": user_id},
                ).fetchone()
                if old_meal_row:
                    side_rows = conn.execute(
                        text("SELECT side_recipe_id FROM meal_sides WHERE meal_id = :mid AND side_recipe_id IS NOT NULL"),
                        {"mid": old_meal_row["id"]},
                    ).fetchall()
                    old_recipe_ids.extend(sr["side_recipe_id"] for sr in side_rows)

                for rid in old_recipe_ids:
                    rows = conn.execute(
                        text("""SELECT i.name FROM recipe_ingredients ri
                           JOIN ingredients i ON ri.ingredient_id = i.id
                           WHERE ri.recipe_id = :recipe_id"""),
                        {"recipe_id": rid},
                    ).fetchall()
                    old_ingredients |= {r["name"].lower() for r in rows}

                # Get ingredients shared by OTHER on-list meals (including their sides)
                shared = set()
                for m in mw.meals:
                    if m.on_grocery and m.slot_date != date:
                        share_ids = [m.recipe_id] if m.recipe_id else []
                        share_ids.extend(s.side_recipe_id for s in m.sides if s.side_recipe_id)
                        for rid in share_ids:
                            other_rows = conn.execute(
                                text("""SELECT i.name FROM recipe_ingredients ri
                                   JOIN ingredients i ON ri.ingredient_id = i.id
                                   WHERE ri.recipe_id = :recipe_id"""),
                                {"recipe_id": rid},
                            ).fetchall()
                            shared |= {r["name"].lower() for r in other_rows}

                # Removable = old ingredients not shared, not already checked/ordered
                trip = _get_active_trip(conn, user_id)
                if trip:
                    for name_lower in old_ingredients - shared:
                        item = conn.execute(
                            text("SELECT name, checked, ordered FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = :name"),
                            {"trip_id": trip["id"], "name": name_lower},
                        ).fetchone()
                        if item and not item["checked"] and not item["ordered"]:
                            removable.append(item["name"])

            # Now do the swap (commits internally)
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

        trip = _get_active_trip(conn, user_id)
        if trip:
            # Remove specified items from trip
            for name in remove_items:
                conn.execute(
                    text("DELETE FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
                    {"trip_id": trip["id"], "name": name},
                )

        conn.execute(
            text("UPDATE meals SET on_grocery = 1 WHERE slot_date = :date AND user_id = :user_id"),
            {"date": date, "user_id": user_id},
        )
        conn.commit()

        # Refresh trip items if there's an active trip
        if trip:
            mw = load_rolling_week(conn, user_id)
            _refresh_trip_meal_items(conn, trip["id"], mw, user_id)

        return await get_meals(request)


@router.get("/meals/{date}/sides")
async def get_sides(date: str, request: Request):
    """Return available side options for a date's meal."""
    from souschef.planner import load_meals, rolling_range

    user_id = request.state.user_id
    conn = _conn()
    meal_row = conn.execute(
        text("SELECT id FROM meals WHERE slot_date = :date AND user_id = :user_id"),
        {"date": date, "user_id": user_id},
    ).fetchone()
    if not meal_row:
        return {"sides": [], "current_ids": [], "fixed": False, "max_sides": 3}

    # Get current sides for this meal
    current_sides = conn.execute(
        text("SELECT side_recipe_id FROM meal_sides WHERE meal_id = :mid ORDER BY position"),
        {"mid": meal_row["id"]},
    ).fetchall()
    current_ids = [cs["side_recipe_id"] for cs in current_sides if cs["side_recipe_id"]]

    # Get user's side recipes
    side_recipes = conn.execute(
        text("SELECT id, name FROM recipes WHERE user_id = :uid AND recipe_type = 'side' ORDER BY name"),
        {"uid": user_id},
    ).fetchall()

    s, e = rolling_range()
    week_meals = load_meals(conn, user_id, s, e)
    used_side_names = set()
    for m in week_meals:
        if m.slot_date != date:
            for sd in m.sides:
                if sd.side_name:
                    used_side_names.add(sd.side_name)

    sides = []
    for sr in side_recipes:
        sides.append({
            "id": sr["id"],
            "name": sr["name"],
            "in_use": sr["name"] in used_side_names,
            "current": sr["id"] in current_ids,
        })
    return {"sides": sides, "current_ids": current_ids, "fixed": False, "max_sides": 3}


@router.post("/meals/{date}/set-side")
async def set_side(date: str, body: dict, request: Request):
    """Set sides for a date's meal. Accepts {sides: [{side_recipe_id, side_name}, ...]}."""
    from souschef.planner import save_meal, _row_to_meal, _resolve_side
    from souschef.models import MealSide

    user_id = request.state.user_id
    conn = _conn()
    row = conn.execute(
        text("SELECT * FROM meals WHERE slot_date = :date AND user_id = :user_id"),
        {"date": date, "user_id": user_id},
    ).fetchone()
    if not row:
        return await get_meals(request)

    meal = _row_to_meal(row)
    sides_data = body.get("sides", [])[:3]
    resolved = []
    for i, s in enumerate(sides_data):
        sid = s.get("side_recipe_id")
        sname = s.get("side_name", "")
        if not sid and sname:
            sid = _resolve_side(conn, user_id, sname)
        resolved.append(MealSide(id=None, side_recipe_id=sid, side_name=sname, position=i))
    meal.sides = resolved
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


@router.post("/meals/{date}/notes")
async def update_meal_notes(date: str, body: dict, request: Request):
    user_id = request.state.user_id
    conn = _conn()
    notes = body.get("notes", "")
    conn.execute(
        text("UPDATE meals SET notes = :notes WHERE user_id = :uid AND slot_date = :date"),
        {"notes": notes, "uid": user_id, "date": date},
    )
    conn.commit()
    return await get_meals(request)


@router.post("/meals/{date}/set")
async def set_meal(date: str, body: dict, request: Request):
    from souschef.planner import set_meal as do_set
    from souschef.recipes import get_recipe

    user_id = request.state.user_id
    conn = _conn()
    if "recipe_id" not in body:
        return {"ok": False, "error": "recipe_id required"}
    recipe = get_recipe(conn, body["recipe_id"])
    if recipe:
        sides = body.get("sides")  # list of {side_recipe_id, side_name} or None
        do_set(conn, user_id, date, recipe.name, sides=sides)
    return await get_meals(request)


@router.post("/meals/suggest")
async def suggest_meals(request: Request):
    from souschef.planner import fill_dates

    user_id = request.state.user_id
    conn = _conn()
    from souschef.planner import load_rolling_week

    mw = load_rolling_week(conn, user_id)
    fill_dates(conn, user_id, mw.start_date, mw.end_date)
    return await get_meals(request)


@router.post("/meals/fresh-start")
async def fresh_start(request: Request):
    """Clear all meals in the rolling window. Grocery list updates on next view."""
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)

    # Delete all meals in the rolling window
    conn.execute(
        text("DELETE FROM meals WHERE slot_date >= :start AND slot_date <= :end AND user_id = :user_id"),
        {"start": mw.start_date, "end": mw.end_date, "user_id": user_id},
    )

    # Refresh grocery list — meal-derived items with no meals will be removed
    trip = _get_active_trip(conn, user_id)
    if trip:
        mw = load_rolling_week(conn, user_id)
        _refresh_trip_meal_items(conn, trip["id"], mw, user_id)

    conn.commit()
    return await get_meals(request)


@router.post("/meals/all-to-grocery")
async def all_to_grocery(request: Request):
    from souschef.planner import set_all_grocery

    user_id = request.state.user_id
    conn = _conn()
    from souschef.planner import load_rolling_week

    mw = load_rolling_week(conn, user_id)
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
    if not body.get("name"):
        return {"ok": False, "error": "name required"}
    set_freeform_meal(conn, user_id, date, body["name"])
    return await get_meals(request)


@router.post("/meals/swap-days")
async def swap_days(body: dict, request: Request):
    from souschef.planner import swap_dates

    user_id = request.state.user_id
    conn = _conn()
    if "date_a" not in body or "date_b" not in body:
        return {"ok": False, "error": "date_a and date_b required"}
    swap_dates(conn, user_id, body["date_a"], body["date_b"])
    return await get_meals(request)


@router.get("/meals/{date}/candidates")
async def get_candidates(date: str, request: Request):
    from souschef.planner import get_candidates as do_get
    from souschef.recipes import list_recipes

    user_id = request.state.user_id
    conn = _conn()
    candidates = do_get(conn, user_id, date)
    all_recipes = list_recipes(conn, user_id=user_id)
    return {
        "candidates": [_recipe_dict(r) for r in candidates],
        "all_recipes": [_recipe_dict(r) for r in all_recipes],
    }


# ── Grocery (trip-based) ──────────────────────────────────


def _parse_ts(ts_str):
    """Parse an ISO timestamp string to a timezone-aware datetime, or None."""
    from datetime import datetime, timezone
    if not ts_str:
        return None
    try:
        t = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t
    except (ValueError, TypeError):
        return None


def _prompt_state(trip, flag_col: str, ts_col: str) -> str:
    """Return 'prompt' (show full card), 'done' (compact), based on flag + age.

    - Not acted on → 'prompt'
    - Acted on within 3 days → 'done'
    - Acted on 3+ days ago → 'prompt' (resurface)
    """
    from datetime import datetime, timedelta, timezone
    try:
        if not trip[flag_col]:
            return "prompt"
        ts_str = trip[ts_col] if ts_col in trip.keys() else None
        if not ts_str:
            return "done"  # acted on but no timestamp (legacy)
        acted_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if acted_at.tzinfo is None:
            acted_at = acted_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - acted_at
        if age > timedelta(days=3):
            return "prompt"
        return "done"
    except (KeyError, Exception):
        return "prompt"


def _regulars_prompt_state(conn, trip) -> str:
    """Return 'prompt', 'done', or 'hidden' for the regulars prompt.

    Shows the regulars prompt only when BOTH:
    - 3+ days since regulars were last offered (or never offered), AND
    - New meal-sourced items exist that were added after regulars_added_at
    """
    from datetime import datetime, timedelta, timezone

    try:
        if not trip["regulars_added"]:
            # Never acted on — show prompt only if there are meal-sourced items
            meal_items = conn.execute(
                text("SELECT COUNT(*) as cnt FROM trip_items WHERE trip_id = :tid AND source = 'meal'"),
                {"tid": trip["id"]},
            ).fetchone()
            return "prompt" if meal_items["cnt"] > 0 else "hidden"

        ts_str = trip["regulars_added_at"] if "regulars_added_at" in trip.keys() else None
        if not ts_str:
            return "done"

        acted_at = _parse_ts(ts_str)
        if not acted_at:
            return "done"

        age = datetime.now(timezone.utc) - acted_at
        if age <= timedelta(days=3):
            return "done"

        # 3+ days old — check if new meal-sourced items were added since
        new_meal_items = conn.execute(
            text("SELECT COUNT(*) as cnt FROM trip_items WHERE trip_id = :tid AND source = 'meal' AND added_at > :since"),
            {"tid": trip["id"], "since": ts_str},
        ).fetchone()
        if new_meal_items["cnt"] > 0:
            return "prompt"
        return "done"
    except (KeyError, Exception):
        return "hidden"
    except (KeyError, Exception):
        return "prompt"


def _get_active_trip(conn, user_id: str):
    """Return the most recent active trip row, or None."""
    return conn.execute(
        text("SELECT * FROM grocery_trips WHERE active = 1 AND user_id = :user_id ORDER BY id DESC LIMIT 1"),
        {"user_id": user_id},
    ).fetchone()


def _normalize_name(conn, raw_name: str) -> tuple[str, int | None]:
    """Normalize an item name to its canonical form. Returns (name, ingredient_id)."""
    from souschef.normalize import normalize_item_name
    return normalize_item_name(conn, raw_name)


def _infer_item_group(conn, name: str, user_id: str) -> str:
    """Resolve shopping group: user override > ingredient aisle > regulars > keyword inference."""
    from souschef.regulars import _infer_group

    # 1. User override (highest priority)
    row = conn.execute(
        text("SELECT shopping_group FROM user_item_groups WHERE LOWER(item_name) = LOWER(:name) AND user_id = :user_id"),
        {"name": name, "user_id": user_id},
    ).fetchone()
    if row:
        return row["shopping_group"]

    # 2. Ingredient table (normalize first to catch typos/variants)
    canonical, ing_id = _normalize_name(conn, name)
    if ing_id:
        row = conn.execute(
            text("SELECT aisle FROM ingredients WHERE id = :id"),
            {"id": ing_id},
        ).fetchone()
        if row and row["aisle"]:
            return row["aisle"]

    # 3. Regulars
    row = conn.execute(
        text("SELECT shopping_group FROM regulars WHERE LOWER(name) = LOWER(:name) AND user_id = :user_id"),
        {"name": name, "user_id": user_id},
    ).fetchone()
    if row and row["shopping_group"]:
        return row["shopping_group"]

    # 4. Keyword inference
    return _infer_group(name)


def _build_group_resolver(conn, user_id: str):
    """Build a fast group resolver by pre-loading all lookup tables.

    Returns a function: resolve(name) -> str that uses the same priority
    as _infer_item_group but without per-item DB queries.
    """
    from souschef.regulars import _infer_group

    # Load all user overrides
    rows = conn.execute(
        text("SELECT LOWER(item_name) AS item_name, shopping_group FROM user_item_groups WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).fetchall()
    overrides = {r["item_name"]: r["shopping_group"] for r in rows}

    # Load all ingredient aisles
    rows = conn.execute(text("SELECT LOWER(name) AS name, aisle FROM ingredients WHERE aisle != ''")).fetchall()
    aisles = {r["name"]: r["aisle"] for r in rows}

    # Load all regulars groups
    rows = conn.execute(
        text("SELECT LOWER(name) AS name, shopping_group FROM regulars WHERE user_id = :user_id AND shopping_group != ''"),
        {"user_id": user_id},
    ).fetchall()
    reg_groups = {r["name"]: r["shopping_group"] for r in rows}

    def resolve(name: str) -> str:
        nl = name.strip().lower()
        if nl in overrides:
            return overrides[nl]
        if nl in aisles:
            return aisles[nl]
        if nl in reg_groups:
            return reg_groups[nl]
        return _infer_group(nl)

    return resolve


def _build_trip_from_meals(conn, trip_id: int, mw, user_id: str) -> None:
    """Populate trip_items from current meal grocery build + saved extras."""
    from souschef.feedback import get_skips_for_meal, get_adds_for_meal
    from souschef.grocery import build_grocery_list, split_by_store

    grocery_meals = [m for m in mw.meals if m.on_grocery]
    resolve = _build_group_resolver(conn, user_id)

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

                group = resolve(item.ingredient_name)
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
    """Find or create an active trip. Trips persist until Fresh Start creates a new one."""
    trip = _get_active_trip(conn, user_id)

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

    # Prune items checked/removed more than 30 days ago
    conn.execute(
        text("""DELETE FROM trip_items WHERE trip_id = :tid
           AND (checked = 1 OR have_it = 1 OR removed = 1)
           AND COALESCE(checked_at, have_it_at, removed_at)::timestamptz < NOW() - INTERVAL '30 days'"""),
        {"tid": trip["id"]},
    )
    conn.commit()

    return trip


def _refresh_trip_meal_items(conn, trip_id: int, mw, user_id: str) -> None:
    """Re-derive meal-sourced items while preserving extras and checked state."""
    from souschef.grocery import build_grocery_list, split_by_store

    grocery_meals = [m for m in mw.meals if m.on_grocery]
    resolve = _build_group_resolver(conn, user_id)

    # Build fresh meal items
    fresh_meal_items: dict[str, dict] = {}
    if grocery_meals:
        gl = build_grocery_list(conn, grocery_meals, mw.start_date, mw.end_date, user_id=user_id)
        by_store = split_by_store(gl)
        for items in by_store.values():
            for item in items:
                name_lower = item.ingredient_name.lower()
                group = resolve(name_lower)
                for_meals = ",".join(item.meals) if item.meals else ""
                fresh_meal_items[name_lower] = {
                    "name": name_lower,
                    "shopping_group": group,
                    "for_meals": for_meals,
                    "meal_count": len(item.meals),
                }

    # Get existing meal-sourced items and their checked/receipt/removed state
    existing = conn.execute(
        text("SELECT id, name, checked, receipt_status, removed FROM trip_items WHERE trip_id = :trip_id AND source = 'meal'"),
        {"trip_id": trip_id},
    ).fetchall()
    existing_map = {r["name"].lower(): r for r in existing}

    # Remove meal items no longer needed (but preserve items with receipt data or removed flag)
    for name_lower, row in existing_map.items():
        if name_lower not in fresh_meal_items and not row["receipt_status"] and not row["removed"]:
            conn.execute(
                text("DELETE FROM trip_items WHERE id = :id"),
                {"id": row["id"]},
            )

    # Add or update meal items
    for name_lower, info in fresh_meal_items.items():
        if name_lower in existing_map:
            # Update meal associations only — don't touch product/ordered state
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
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    # Read all items from the trip
    rows = conn.execute(
        text("SELECT * FROM trip_items WHERE trip_id = :trip_id ORDER BY shopping_group, name"),
        {"trip_id": trip["id"]},
    ).fetchall()

    from datetime import datetime, timedelta, timezone

    items_by_group: dict[str, list[dict]] = {}
    checked_names: list[str] = []
    ordered_names: list[str] = []
    have_it_names: list[str] = []
    removed_names: list[str] = []
    recently_checked: list[dict] = []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)

    for r in rows:
        group = r["shopping_group"] or "Other"
        for_meals_str = r["for_meals"]
        for_meals = [m for m in for_meals_str.split(",") if m] if for_meals_str else []
        try:
            added_at = r["added_at"]
        except (KeyError, Exception):
            added_at = None
        try:
            notes = r["notes"]
        except (KeyError, Exception):
            notes = ""
        items_by_group.setdefault(group, []).append({
            "name": r["name"],
            "for_meals": for_meals,
            "meal_count": r["meal_count"],
            "source": r["source"],
            "added_at": added_at,
            "notes": notes or "",
        })
        if r["checked"]:
            checked_names.append(r["name"].lower())
            t = _parse_ts(r["checked_at"] if "checked_at" in r.keys() else None)
            if t and t > cutoff:
                recently_checked.append({"name": r["name"], "type": "bought"})
        if r["ordered"]:
            ordered_names.append(r["name"].lower())
        try:
            if r["have_it"]:
                have_it_names.append(r["name"].lower())
                t = _parse_ts(r["have_it_at"] if "have_it_at" in r.keys() else None)
                if t and t > cutoff:
                    recently_checked.append({"name": r["name"], "type": "have_it"})
        except (KeyError, Exception):
            pass
        try:
            if r["removed"]:
                removed_names.append(r["name"].lower())
                t = _parse_ts(r["removed_at"] if "removed_at" in r.keys() else None)
                if t and t > cutoff:
                    recently_checked.append({"name": r["name"], "type": "removed"})
        except (KeyError, Exception):
            pass

    return {
        "start_date": mw.start_date,
        "end_date": mw.end_date,
        "items_by_group": items_by_group,
        "checked": checked_names,
        "ordered": ordered_names,
        "have_it": have_it_names,
        "removed": removed_names,
        "recently_checked": recently_checked,
    }


@router.post("/grocery/add")
async def add_grocery_item(body: dict, request: Request):
    """Add a free-form item to the active trip."""
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    raw = body.get("name", "").strip()
    if not raw:
        return {"ok": False}

    conn = _conn()
    name, _ = _normalize_name(conn, raw)

    mw = load_rolling_week(conn, user_id)
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


@router.post("/grocery/note")
async def update_grocery_note(body: dict, request: Request):
    """Update the note on a grocery item."""
    user_id = request.state.user_id
    conn = _conn()
    name = body.get("name", "").strip()
    notes = body.get("notes", "")
    if not name:
        return {"ok": False}
    trip = _get_active_trip(conn, user_id)
    if trip:
        conn.execute(
            text("UPDATE trip_items SET notes = :notes WHERE trip_id = :tid AND LOWER(name) = LOWER(:name)"),
            {"notes": notes, "tid": trip["id"], "name": name},
        )
        conn.commit()
    return await get_grocery(request)


@router.post("/grocery/recategorize")
async def recategorize_item(body: dict, request: Request):
    """Move an item to a different shopping group. Persists as a user override."""
    user_id = request.state.user_id
    conn = _conn()
    name = body.get("name", "").strip().lower()
    group = body.get("shopping_group", "").strip()
    if not name or not group:
        return {"ok": False}

    # Save override for future trips
    conn.execute(
        text("""INSERT INTO user_item_groups (user_id, item_name, shopping_group)
           VALUES (:user_id, :name, :group)
           ON CONFLICT (user_id, item_name) DO UPDATE SET shopping_group = :group, updated_at = CURRENT_TIMESTAMP"""),
        {"user_id": user_id, "name": name, "group": group},
    )

    # Update current trip item too
    trip = _get_active_trip(conn, user_id)
    if trip:
        conn.execute(
            text("UPDATE trip_items SET shopping_group = :group WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
            {"group": group, "trip_id": trip["id"], "name": name},
        )
    conn.commit()
    return await get_grocery(request)


@router.post("/grocery/toggle/{item_name:path}")
async def toggle_grocery_item(item_name: str, request: Request):
    """Toggle an item's checked state on the active trip."""
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
                text("UPDATE trip_items SET checked = 1, checked_at = CURRENT_TIMESTAMP, have_it = 0, have_it_at = NULL WHERE id = :id"),
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

    return await get_grocery(request)


@router.delete("/grocery/item/{item_name:path}")
async def remove_grocery_item(item_name: str, request: Request):
    """Remove an item from the grocery list. Sets removed flag (prevents re-add by refresh).
    Extra/regular items are deleted outright."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": True}

    row = conn.execute(
        text("SELECT id, source FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
        {"trip_id": trip["id"], "name": item_name},
    ).fetchone()

    if row:
        if row["source"] == "meal":
            conn.execute(
                text("UPDATE trip_items SET removed = 1, removed_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": row["id"]},
            )
        else:
            conn.execute(
                text("DELETE FROM trip_items WHERE id = :id"),
                {"id": row["id"]},
            )
    conn.commit()
    return {"ok": True}


@router.post("/grocery/undo-remove/{item_name:path}")
async def undo_remove_grocery_item(item_name: str, request: Request):
    """Undo a remove — clear the removed flag so the item reappears."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": True}

    conn.execute(
        text("UPDATE trip_items SET removed = 0, removed_at = NULL WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
        {"trip_id": trip["id"], "name": item_name},
    )
    conn.commit()
    return await get_grocery(request)


@router.post("/grocery/buy-elsewhere/{item_name:path}")
async def buy_elsewhere_grocery_item(item_name: str, request: Request):
    """Mark an item as 'buying elsewhere' — removes from ordering flow but stays on grocery list."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": True}

    row = conn.execute(
        text("SELECT id, buy_elsewhere FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
        {"trip_id": trip["id"], "name": item_name},
    ).fetchone()

    if row:
        if row["buy_elsewhere"]:
            # Undo: return to active ordering flow
            conn.execute(
                text("UPDATE trip_items SET buy_elsewhere = 0, buy_elsewhere_at = NULL WHERE id = :id"),
                {"id": row["id"]},
            )
        else:
            conn.execute(
                text("UPDATE trip_items SET buy_elsewhere = 1, buy_elsewhere_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": row["id"]},
            )
    conn.commit()
    return await get_order(request)


@router.post("/grocery/have-it/{item_name:path}")
async def have_it_grocery_item(item_name: str, request: Request):
    """Mark an item as already on hand."""
    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return await get_grocery(request)

    row = conn.execute(
        text("SELECT id, have_it FROM trip_items WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
        {"trip_id": trip["id"], "name": item_name},
    ).fetchone()

    suggest_staple = None
    if row:
        if row["have_it"]:
            # Un-have-it: return to active
            conn.execute(
                text("UPDATE trip_items SET have_it = 0, have_it_at = NULL WHERE id = :id"),
                {"id": row["id"]},
            )
        else:
            conn.execute(
                text("UPDATE trip_items SET have_it = 1, have_it_at = CURRENT_TIMESTAMP, checked = 0, checked_at = NULL WHERE id = :id"),
                {"id": row["id"]},
            )
            # Check if this item has been marked "have it" 3+ times — suggest as staple
            from souschef.regulars import list_regulars
            from souschef.pantry import list_pantry_items
            reg_names = {r.name.lower() for r in list_regulars(conn, user_id)}
            pantry_names = {p["name"].lower() for p in list_pantry_items(conn, user_id)}
            name_lower = item_name.strip().lower()
            if name_lower not in reg_names and name_lower not in pantry_names:
                have_it_count = conn.execute(
                    text("""SELECT COUNT(*) as cnt FROM trip_items ti
                       JOIN grocery_trips gt ON gt.id = ti.trip_id
                       WHERE gt.user_id = :uid AND LOWER(ti.name) = LOWER(:name) AND ti.have_it = 1"""),
                    {"uid": user_id, "name": item_name},
                ).fetchone()
                if have_it_count and have_it_count["cnt"] >= 3:
                    suggest_staple = item_name
    conn.commit()
    result = await get_grocery(request)
    if suggest_staple:
        result["suggest_staple"] = suggest_staple
    return result


@router.post("/grocery/add-regulars")
async def add_regulars_to_grocery(body: dict, request: Request):
    """Add selected regulars to the active trip. Records skipped regulars for learning."""
    from souschef.planner import load_rolling_week
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    selected = body.get("selected", [])
    selected_lower = {n.lower() for n in selected}

    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    # Add selected regulars
    for name in selected:
        name_lower = name.lower()
        group = _infer_item_group(conn, name_lower, user_id)
        conn.execute(
            text("""INSERT INTO trip_items
               (trip_id, name, shopping_group, source, for_meals, meal_count)
               VALUES (:trip_id, :name, :group, 'regular', '', 0)
               ON CONFLICT DO NOTHING"""),
            {"trip_id": trip["id"], "name": name_lower, "group": group},
        )

    # Record skipped regulars for learning
    all_active_regulars = list_regulars(conn, user_id, active_only=True)
    for reg in all_active_regulars:
        if reg.name.lower() not in selected_lower:
            group = reg.shopping_group or _infer_item_group(conn, reg.name.lower(), user_id)
            conn.execute(
                text("""INSERT INTO trip_items
                   (trip_id, name, shopping_group, source, for_meals, meal_count, checked)
                   VALUES (:trip_id, :name, :group, 'regular_skip', '', 0, 0)
                   ON CONFLICT DO NOTHING"""),
                {"trip_id": trip["id"], "name": reg.name.lower(), "group": group},
            )

    # Mark regulars as handled for this trip
    conn.execute(
        text("UPDATE grocery_trips SET regulars_added = 1, regulars_added_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"id": trip["id"]},
    )
    conn.commit()

    return await get_grocery(request)


@router.post("/grocery/add-pantry")
async def add_pantry_to_grocery(body: dict, request: Request):
    """Add selected pantry items to the active trip."""
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    selected = body.get("selected", [])

    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    for name in selected:
        name_lower = name.lower()
        group = _infer_item_group(conn, name_lower, user_id)
        conn.execute(
            text("""INSERT INTO trip_items
               (trip_id, name, shopping_group, source, for_meals, meal_count)
               VALUES (:trip_id, :name, :group, 'pantry', '', 0)
               ON CONFLICT DO NOTHING"""),
            {"trip_id": trip["id"], "name": name_lower, "group": group},
        )

    # Mark pantry as handled for this trip
    conn.execute(
        text("UPDATE grocery_trips SET pantry_checked = 1, pantry_checked_at = CURRENT_TIMESTAMP WHERE id = :id"),
        {"id": trip["id"]},
    )
    conn.commit()

    return await get_grocery(request)


@router.post("/grocery/build")
async def build_my_list(request: Request, body: dict = None):
    """Refresh grocery list from current meals."""
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)
    _refresh_trip_meal_items(conn, trip["id"], mw, user_id)
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
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    rows = conn.execute(
        text("""SELECT * FROM trip_items WHERE trip_id = :trip_id
           AND checked = 0 AND skipped = 0 AND have_it = 0 AND removed = 0
           AND submitted_at IS NULL
           ORDER BY shopping_group, name"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    pending = []
    selected = []
    buy_elsewhere = []
    for r in rows:
        item = {
            "name": r["name"],
            "shopping_group": r["shopping_group"],
            "source": r["source"],
            "for_meals": [m for m in r["for_meals"].split(",") if m] if r["for_meals"] else [],
        }
        if r["buy_elsewhere"]:
            buy_elsewhere.append(item)
            continue
        if r["product_upc"]:
            try:
                qty = r["quantity"]
            except (KeyError, Exception):
                qty = 1
            item["product"] = {
                "upc": r["product_upc"],
                "name": r["product_name"],
                "brand": r["product_brand"],
                "size": r["product_size"],
                "price": r["product_price"],
                "image": r["product_image"],
                "quantity": qty,
            }
            selected.append(item)
        else:
            pending.append(item)

    total_price = sum(
        r["product_price"] * (r["quantity"] if "quantity" in r.keys() else 1)
        for r in rows
        if r["product_upc"] and r["product_price"] and not r["buy_elsewhere"]
    )

    return {
        "pending": pending,
        "selected": selected,
        "buy_elsewhere": buy_elsewhere,
        "total_items": len(selected),
        "total_price": round(total_price, 2),
    }


_search_cache: dict[str, tuple[float, dict]] = {}  # {term: (timestamp, response)}
_SEARCH_CACHE_TTL = 300  # 5 minutes
_SEARCH_CACHE_MAX = 50

@router.get("/order/search/{item_name:path}")
async def search_order_products(item_name: str, request: Request, fulfillment: str = "curbside", start: int = 1):
    """Search Kroger products for a grocery item. Returns products + preferences.
    fulfillment: 'curbside' (pickup) or 'delivery'. start: pagination offset (1-based)."""
    import time as _time
    from concurrent.futures import ThreadPoolExecutor
    from souschef.kroger import (
        search_products_fast, fill_prices, _lookup_food_score,
        get_preferred_products,
    )
    from souschef.stores import get_kroger_location_id

    user_id = request.state.user_id

    # Rate limit: max 20 searches per user per minute
    throttled = _check_throttle(user_id, "order_search", 20, 60)
    if throttled:
        return throttled

    conn = _conn()

    # Get user's Kroger location
    user_location_id = get_kroger_location_id(conn, user_id)
    if not user_location_id:
        return {"error": "no_store", "message": "Set your Kroger store in Preferences", "prior_selections": [], "products": []}

    # Return cached response if fresh
    ff = fulfillment if fulfillment in ("curbside", "delivery") else "curbside"
    cache_key = f"{item_name.lower().strip()}:{ff}:{start}"
    now = _time.time()
    if cache_key in _search_cache:
        ts, resp = _search_cache[cache_key]
        if now - ts < _SEARCH_CACHE_TTL:
            return resp
        else:
            del _search_cache[cache_key]

    # Use the item name as-is for the Kroger search. The ingredient 'root' field
    # is for dedup (e.g., "apple juice" and "orange juice" → "juice"), not for search.
    search_term = item_name.strip().lower()

    # Get preferences first
    prefs = get_preferred_products(conn, user_id, item_name, limit=3)
    # Enrich preferences with cached scores/prices
    pref_upcs = [p.upc for p in prefs]
    pref_scores = {}
    if pref_upcs:
        ph = ", ".join(f":pu{i}" for i in range(len(pref_upcs)))
        ps = {f"pu{i}": u for i, u in enumerate(pref_upcs)}
        pref_score_rows = conn.execute(
            text(f"SELECT upc, nova_group, nutriscore, price, promo_price FROM product_scores WHERE upc IN ({ph})"),
            ps,
        ).fetchall()
        pref_scores = {r["upc"]: dict(r) for r in pref_score_rows}

    from souschef.brands import get_parent_company
    from souschef.violations import get_company_violations

    pref_list = []
    for p in prefs:
        sc = pref_scores.get(p.upc, {})
        parent = get_parent_company(p.brand, conn) if p.brand else "We're not sure"
        violation_key = p.brand.strip() if parent == "Same as brand" else parent
        violations = get_company_violations(conn, violation_key) if violation_key not in ("We're not sure",) else None
        pref_item = {
            "upc": p.upc,
            "name": p.description,
            "brand": p.brand,
            "size": p.size,
            "rating": p.rating,
            "image": f"https://www.kroger.com/product/images/medium/front/{p.upc}",
            "price": sc.get("price"),
            "promo_price": sc.get("promo_price"),
            "nova": sc.get("nova_group"),
            "nutriscore": sc.get("nutriscore", ""),
            "parent_company": parent,
        }
        if violations:
            pref_item["violations"] = violations
        pref_list.append(pref_item)

    # Search Kroger
    try:
        products = search_products_fast(search_term, limit=12, start=start, fulfillment=ff, location_id=user_location_id)
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
        upcs = [p.upc for p in products]
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
    for p in products:
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
            fill_prices(need_price, location_id=user_location_id)
        except Exception as e:
            print(f"[search] fill_prices failed: {e}")

    # --- Scores: use cached or fetch from Open Food Facts ---
    need_scores = []
    for p in products:
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
    for p in products:
        conn.execute(
            text("""INSERT INTO product_scores
               (upc, nova_group, nutriscore, score_fetched_at, price, promo_price, in_stock, curbside, price_fetched_at)
               VALUES (:upc, :nova_group, :nutriscore, CURRENT_TIMESTAMP, :price, :promo_price, :in_stock, :curbside, CURRENT_TIMESTAMP)
               ON CONFLICT(upc) DO UPDATE SET
               nova_group=COALESCE(excluded.nova_group, product_scores.nova_group),
               nutriscore=CASE WHEN excluded.nova_group IS NOT NULL THEN excluded.nutriscore ELSE product_scores.nutriscore END,
               score_fetched_at=CASE WHEN excluded.nova_group IS NOT NULL THEN excluded.score_fetched_at ELSE product_scores.score_fetched_at END,
               price=excluded.price, promo_price=excluded.promo_price,
               in_stock=excluded.in_stock, curbside=excluded.curbside,
               price_fetched_at=excluded.price_fetched_at"""),
            {"upc": p.upc, "nova_group": p.nova_group, "nutriscore": p.nutriscore or "",
             "price": p.price, "promo_price": p.promo_price,
             "in_stock": int(p.in_stock), "curbside": int(p.curbside)},
        )
    conn.commit()

    from souschef.brands import get_parent_company
    from souschef.kroger import get_product_ratings
    from souschef.violations import get_company_violations

    # Look up user ratings for search result products
    product_ratings = {}
    for p in products:
        if p.upc:
            r = get_product_ratings(conn, p.upc, user_id)
            product_ratings[p.upc] = r["your_rating"]

    # Resolve parent companies first, then batch-load violations
    product_parents = {}
    unknown_brands_batch = set()
    for p in products:
        parent = get_parent_company(p.brand, conn)
        product_parents[p.upc or p.product_id] = parent
        if parent == "We're not sure" and p.brand:
            unknown_brands_batch.add(p.brand.strip())

    # Cache violation lookups by parent company
    violation_cache = {}
    for p in products:
        parent = product_parents[p.upc or p.product_id]
        if parent == "Same as brand":
            key = p.brand.strip()
        elif parent == "We're not sure":
            continue
        else:
            key = parent
        if key and key not in violation_cache:
            violation_cache[key] = get_company_violations(conn, key)

    result = []
    for p in products:
        rating = product_ratings.get(p.upc, 0)
        parent = product_parents[p.upc or p.product_id]
        # For self-owned brands, look up violations under the brand name
        violation_key = p.brand.strip() if parent == "Same as brand" else parent
        violations = violation_cache.get(violation_key) if violation_key not in ("We're not sure",) else None
        item = {
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
            "rating": rating,
            "parent_company": parent,
        }
        if violations:
            item["violations"] = violations
        result.append(item)

    # Log unknown brands for later research
    for brand in unknown_brands_batch:
        try:
            conn.execute(text(
                """INSERT INTO unknown_brands (brand) VALUES (:b)
                   ON CONFLICT (brand) DO UPDATE SET times_seen = unknown_brands.times_seen + 1, last_seen = CURRENT_TIMESTAMP"""
            ), {"b": brand})
        except Exception:
            pass
    if unknown_brands_batch:
        conn.commit()

    # Remove thumbs-down products, sort thumbs-up first
    result = [r for r in result if r["rating"] >= 0]
    result.sort(key=lambda r: -r["rating"])

    response = {
        "item_name": item_name,
        "search_term": search_term,
        "preferences": pref_list if start == 1 else [],  # only show prefs on first page
        "products": result,
        "start": start,
        "has_more": len(products) == 12,  # if we got a full page, there's probably more
    }
    # Evict expired entries, then oldest if over max size
    expired = [k for k, (ts, _) in _search_cache.items() if now - ts >= _SEARCH_CACHE_TTL]
    for k in expired:
        del _search_cache[k]
    if len(_search_cache) >= _SEARCH_CACHE_MAX:
        oldest = min(_search_cache, key=lambda k: _search_cache[k][0])
        del _search_cache[oldest]
    _search_cache[cache_key] = (now, response)
    return response


@router.post("/order/select")
async def select_product(body: dict, request: Request):
    """Select a Kroger product for a grocery item."""
    from souschef.kroger import save_preference, KrogerProduct
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    item_name = body.get("item_name")
    product = body.get("product")
    quantity = body.get("quantity", 1)
    if not item_name or not product:
        return {"ok": False, "error": "item_name and product required"}

    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    conn.execute(
        text("""UPDATE trip_items SET
               product_upc = :upc, product_name = :name, product_brand = :brand,
               product_size = :size, product_price = :price, product_image = :image,
               quantity = :quantity,
               ordered = 1, ordered_at = CURRENT_TIMESTAMP, selected_at = CURRENT_TIMESTAMP
           WHERE trip_id = :trip_id AND LOWER(name) = :item_name"""),
        {"upc": product["upc"], "name": product["name"], "brand": product.get("brand", ""),
         "size": product.get("size", ""), "price": product.get("price"),
         "image": product.get("image", ""),
         "quantity": quantity,
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
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
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
    """Submit all selected products to Kroger cart.

    Accepts optional JSON body: { "kroger_user_id": "<user_id>" }
    If provided, verifies the user is in the same household and uses their token.
    If not provided, tries the current user first, then falls back to any
    household member with a linked account.
    """
    from souschef.kroger import add_to_cart, get_user_token_from_db
    from souschef.planner import load_rolling_week

    user_id = request.state.user_id
    real_user_id = request.state.real_user_id
    conn = _conn()
    mw = load_rolling_week(conn, user_id)
    trip = _ensure_active_trip(conn, mw, user_id)

    rows = conn.execute(
        text("""SELECT product_upc FROM trip_items
           WHERE trip_id = :trip_id AND product_upc != '' AND ordered = 1 AND submitted_at IS NULL"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    if not rows:
        return {"ok": False, "error": "No products selected"}

    # Determine which Kroger account to use
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    kroger_user_id = body.get("kroger_user_id")
    token = None

    if kroger_user_id:
        if kroger_user_id == real_user_id:
            # Using own account — no access check needed
            token = get_user_token_from_db(conn, real_user_id)
        else:
            # Using another member's account — verify household + allow_household
            hh_row = conn.execute(
                text("SELECT household_id FROM household_members WHERE user_id = :uid"),
                {"uid": real_user_id},
            ).fetchone()
            if hh_row:
                member = conn.execute(
                    text("""SELECT hm.user_id FROM household_members hm
                        JOIN user_kroger_tokens ukt ON ukt.user_id = hm.user_id
                        WHERE hm.household_id = :hh_id AND hm.user_id = :target_uid
                          AND ukt.allow_household = 1"""),
                    {"hh_id": hh_row["household_id"], "target_uid": kroger_user_id},
                ).fetchone()
                if member:
                    token = get_user_token_from_db(conn, kroger_user_id)
        if not token:
            return {"ok": False, "error": "Selected account is not available."}
    else:
        # Try current user first
        token = get_user_token_from_db(conn, real_user_id)
        if not token:
            # Fall back to any household member's token that has opted in
            hh_row = conn.execute(
                text("SELECT household_id FROM household_members WHERE user_id = :uid"),
                {"uid": real_user_id},
            ).fetchone()
            if hh_row:
                hh_tokens = conn.execute(
                    text("""SELECT hm.user_id FROM household_members hm
                        JOIN user_kroger_tokens ukt ON ukt.user_id = hm.user_id
                        WHERE hm.household_id = :hh_id AND ukt.allow_household = 1
                        ORDER BY hm.role ASC LIMIT 1"""),
                    {"hh_id": hh_row["household_id"]},
                ).fetchone()
                if hh_tokens:
                    token = get_user_token_from_db(conn, hh_tokens["user_id"])

        if not token:
            return {"ok": False, "error": "No linked store account. Connect in Preferences."}

    items = [{"upc": r["product_upc"]} for r in rows]
    # Mark submitted BEFORE calling Kroger — if the process dies mid-request,
    # items won't re-appear on the order page for a duplicate submit
    conn.execute(
        text("UPDATE trip_items SET submitted_at = CURRENT_TIMESTAMP WHERE trip_id = :trip_id AND product_upc != '' AND ordered = 1 AND submitted_at IS NULL"),
        {"trip_id": trip["id"]},
    )
    conn.commit()
    try:
        add_to_cart(items, token=token)
        return {"ok": True, "count": len(items)}
    except Exception as e:
        # Roll back submitted_at so user can retry
        conn.execute(
            text("UPDATE trip_items SET submitted_at = NULL WHERE trip_id = :trip_id AND product_upc != '' AND ordered = 1"),
            {"trip_id": trip["id"]},
        )
        conn.commit()
        logger.exception("Failed to add items to cart")
        return {"ok": False, "error": "Failed to add items to cart"}


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

    # Collect UPCs that will need ratings (matched/substituted items)
    items = []
    has_ordered = False
    has_checked = False
    for r in rows:
        if r["checked"]:
            has_checked = True
        if r["ordered"]:
            has_ordered = True
        try:
            have_it = bool(r["have_it"])
        except (KeyError, Exception):
            have_it = False
        try:
            removed = bool(r["removed"])
        except (KeyError, Exception):
            removed = False
        items.append({
            "name": r["name"],
            "shopping_group": r["shopping_group"],
            "checked": bool(r["checked"]),
            "ordered": bool(r["ordered"]),
            "have_it": have_it,
            "removed": removed,
            "product_upc": r["product_upc"],
            "product_name": r["product_name"],
            "product_brand": r["product_brand"],
            "product_size": r["product_size"],
            "product_price": r["product_price"],
            "product_image": r["product_image"],
            "receipt_item": r["receipt_item"],
            "receipt_price": r["receipt_price"],
            "receipt_upc": r["receipt_upc"],
            "receipt_status": r["receipt_status"],
        })

    # Categorize
    matched = [i for i in items if i["receipt_status"] == "matched"]
    substituted = [i for i in items if i["receipt_status"] == "substituted"]
    not_fulfilled = [i for i in items if i["receipt_status"] == "not_fulfilled"]
    unresolved = [i for i in items if not i["checked"] and not i.get("have_it") and not i.get("removed") and not i["receipt_status"]]

    # Fetch ratings for reconciled items (matched + substituted)
    from souschef.kroger import get_product_ratings, _make_product_key
    for item in matched + substituted:
        upc = item.get("receipt_upc") or item.get("product_upc") or ""
        brand = item.get("product_brand") or ""
        desc = item.get("receipt_item") or item.get("product_name") or ""
        pk = _make_product_key(upc, brand, desc)
        item["product_key"] = pk
        ratings = get_product_ratings(conn, upc, user_id, product_key=pk)
        item["rating"] = ratings["your_rating"]

    # Fetch extra items (unmatched receipt items)
    try:
        extras_rows = conn.execute(
            text("SELECT item_name, price, upc, brand FROM receipt_extra_items WHERE trip_id = :trip_id ORDER BY id"),
            {"trip_id": trip["id"]},
        ).fetchall()
        extras = [{"item_name": r["item_name"], "price": r["price"], "upc": r["upc"], "brand": r["brand"]} for r in extras_rows]
    except Exception:
        extras = []

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
        "extras": extras,
    }


def _parse_receipt_by_type(receipt_type: str, content: str, grocery_names: list[str] | None = None):
    """Internal: parse receipt content by type. Only called from trusted code paths."""
    from souschef.reconcile import (
        parse_receipt_text, parse_receipt_pdf, parse_receipt_image,
        parse_receipt_email,
    )
    if receipt_type == "pdf_path":
        return parse_receipt_pdf(content)
    elif receipt_type == "image_path":
        return parse_receipt_image(content, grocery_names=grocery_names)
    elif receipt_type == "eml_path":
        return parse_receipt_email(content)
    else:
        return parse_receipt_text(content)


async def _process_receipt(receipt_type: str, content: str, request: Request):
    """Shared receipt processing: parse, match, store. Called by both upload endpoints."""
    from souschef.reconcile import diff_order, diff_grocery_list

    user_id = request.state.user_id
    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    # Gather grocery names for image receipts (enables single-call matching)
    # Scope to unchecked items: submitted (sent to store) + active (might have grabbed in-store)
    grocery_names = None
    if receipt_type == "image_path":
        try:
            name_rows = conn.execute(
                text("""SELECT name FROM trip_items WHERE trip_id = :trip_id
                   AND checked = 0 AND have_it = 0 AND removed = 0
                   AND receipt_status IN ('', 'not_fulfilled')"""),
                {"trip_id": trip["id"]},
            ).fetchall()
            grocery_names = [r["name"] for r in name_rows]
        except Exception:
            pass

    # Parse receipt
    try:
        receipt_items = _parse_receipt_by_type(receipt_type, content, grocery_names=grocery_names)
    except Exception as e:
        logger.exception("Failed to parse receipt")
        return {"ok": False, "error": "Failed to parse receipt"}

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

    # Dedup: find receipt items already matched in prior uploads
    # Check both receipt_item (decoded name) and raw text stored in receipt_data
    already_matched_rows = conn.execute(
        text("""SELECT LOWER(receipt_item) AS ri FROM trip_items
           WHERE trip_id = :trip_id AND receipt_status IN ('matched', 'substituted') AND receipt_item != ''"""),
        {"trip_id": trip["id"]},
    ).fetchall()
    already_matched_names = {r["ri"] for r in already_matched_rows}

    # Also check existing extras to avoid re-inserting
    try:
        existing_extras = conn.execute(
            text("SELECT LOWER(item_name) AS name FROM receipt_extra_items WHERE trip_id = :trip_id"),
            {"trip_id": trip["id"]},
        ).fetchall()
        already_extra_names = {r["name"] for r in existing_extras}
    except Exception:
        already_extra_names = set()

    # Filter out previously matched receipt items (check both raw and decoded names)
    new_receipt_items = []
    previously_matched = 0
    for ri in receipt_items:
        ri_name = (ri.get("item") or "").lower().strip()
        ri_raw = (ri.get("raw") or "").lower().strip()
        if (ri_name and ri_name in already_matched_names) or \
           (ri_raw and ri_raw in already_matched_names) or \
           (ri_name and ri_name in already_extra_names) or \
           (ri_raw and ri_raw in already_extra_names):
            previously_matched += 1
        else:
            new_receipt_items.append(ri)

    # Get trip items that still need matching — anything unchecked on the list
    # This includes submitted items (sent to store) and active items (grabbed in-store)
    rows = conn.execute(
        text("""SELECT * FROM trip_items WHERE trip_id = :trip_id
           AND checked = 0 AND have_it = 0 AND removed = 0
           AND receipt_status IN ('', 'not_fulfilled')
           ORDER BY name"""),
        {"trip_id": trip["id"]},
    ).fetchall()

    # Check if receipt items have pre-matched grocery_match metadata (from image parser)
    has_pre_matches = any(ri.get("grocery_match") for ri in new_receipt_items)

    # Apply pre-matches from image parser before standard matching
    if has_pre_matches:
        trip_items_by_name = {r["name"].lower(): r for r in rows}
        pre_matched_trip_names = set()
        still_unmatched = []
        for ri in new_receipt_items:
            gm = ri.get("grocery_match", "")
            if gm and gm.lower() in trip_items_by_name:
                r = trip_items_by_name[gm.lower()]
                conn.execute(
                    text("""UPDATE trip_items SET
                           receipt_item = :receipt_item, receipt_price = :receipt_price,
                           receipt_upc = :receipt_upc, receipt_status = 'matched'
                       WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                    {"receipt_item": ri.get("item") or ri.get("raw", ""),
                     "receipt_price": ri.get("price"),
                     "receipt_upc": ri.get("upc", ""),
                     "trip_id": trip["id"], "name": gm},
                )
                pre_matched_trip_names.add(gm.lower())
            else:
                still_unmatched.append(ri)
        # Update rows to exclude pre-matched items
        rows = [r for r in rows if r["name"].lower() not in pre_matched_trip_names]
        new_receipt_items = still_unmatched
        total_matched = len(pre_matched_trip_names)
        total_not_fulfilled = 0
    else:
        total_matched = 0
        total_not_fulfilled = 0

    # Split remaining items: ordered (have UPCs) use diff_order, checked use diff_grocery_list
    upc_rows = [r for r in rows if r["product_upc"]]
    name_rows = [r for r in rows if not r["product_upc"]]
    receipt_remaining = list(new_receipt_items)

    # Pass 1: match ordered items by UPC
    if upc_rows:
        submitted = [{"upc": r["product_upc"], "product": r["product_name"], "item": r["name"]} for r in upc_rows]
        diff = diff_order(submitted, receipt_remaining)

        for m in diff["matched"]:
            r = m["receipt"]
            # UPC match = exact product; name match = different UPC = substitution
            status = "matched" if m.get("match") == "upc" else "substituted"
            conn.execute(
                text("""UPDATE trip_items SET
                       receipt_item = :receipt_item, receipt_price = :receipt_price, receipt_upc = :receipt_upc,
                       receipt_status = :status
                   WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                {"receipt_item": r.get("item", ""), "receipt_price": r.get("price"),
                 "receipt_upc": r.get("upc", ""),
                 "status": status,
                 "trip_id": trip["id"], "name": m["submitted"]["item"]},
            )
        total_matched += len(diff["matched"])

        for r in diff["removed"]:
            conn.execute(
                text("""UPDATE trip_items SET receipt_status = 'not_fulfilled'
                   WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
                {"trip_id": trip["id"], "name": r.get("item", r.get("product", ""))},
            )
        total_not_fulfilled += len(diff["removed"])

        # Remaining receipt items for pass 2
        receipt_remaining = diff.get("added", [])

    # Pass 2: match checked items by name
    if name_rows and receipt_remaining:
        grocery_names = [r["name"] for r in name_rows]
        diff2 = diff_grocery_list(grocery_names, receipt_remaining)

        for m in diff2["matched"]:
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
        total_matched += len(diff2["matched"])

        # Remaining receipt items after pass 2
        matched_grocery_names = {m["grocery_name"].lower() for m in diff2["matched"]}
        receipt_remaining = diff2.get("unmatched", [])

        # Name-only items not on receipt
        for r in name_rows:
            if r["name"].lower() not in matched_grocery_names:
                conn.execute(
                    text("UPDATE trip_items SET receipt_status = 'not_fulfilled' WHERE id = :id"),
                    {"id": r["id"]},
                )
                total_not_fulfilled += 1
    elif name_rows:
        # No receipt items left — all name-only items are not fulfilled
        for r in name_rows:
            conn.execute(
                text("UPDATE trip_items SET receipt_status = 'not_fulfilled' WHERE id = :id"),
                {"id": r["id"]},
            )
            total_not_fulfilled += 1

    # Auto-save preferences for matched items
    from souschef.kroger import save_preference, KrogerProduct, _make_product_key
    all_matched_items = conn.execute(
        text("""SELECT name, receipt_item, receipt_upc, product_upc, product_brand
           FROM trip_items WHERE trip_id = :trip_id AND receipt_status = 'matched'"""),
        {"trip_id": trip["id"]},
    ).fetchall()
    for mi in all_matched_items:
        receipt_name = mi["receipt_item"] or mi["name"]
        upc = mi["receipt_upc"] or mi["product_upc"] or ""
        brand = mi["product_brand"] or ""
        try:
            pref_product = KrogerProduct(
                product_id="", upc=upc, description=receipt_name,
                brand=brand, size="",
            )
            save_preference(conn, user_id, mi["name"].lower(), pref_product, source="receipt")
        except Exception:
            pass

    # Save unmatched receipt items as extras
    if receipt_remaining:
        for ri in receipt_remaining:
            display_name = ri.get("item") or ri.get("raw") or ""
            if not display_name:
                continue
            try:
                conn.execute(
                    text("""INSERT INTO receipt_extra_items (trip_id, item_name, price, upc, brand)
                       VALUES (:trip_id, :item_name, :price, :upc, :brand)"""),
                    {"trip_id": trip["id"], "item_name": display_name,
                     "price": ri.get("price"), "upc": ri.get("upc", ""),
                     "brand": ri.get("brand", "")},
                )
            except Exception:
                pass

    conn.commit()

    result = {
        "ok": True,
        "matched": total_matched,
        "not_fulfilled": total_not_fulfilled,
    }
    if previously_matched > 0:
        result["previously_matched"] = previously_matched
    if receipt_remaining:
        result["extras"] = len(receipt_remaining)
    return result


@router.post("/receipt/upload")
async def upload_receipt(body: dict, request: Request):
    """Upload and parse a receipt. Public endpoint accepts text only."""
    # Rate limit: max 10 receipt uploads per user per minute
    user_id = request.state.user_id
    throttled = _check_throttle(user_id, "receipt_upload", 10, 60)
    if throttled:
        return throttled

    receipt_type = body.get("type", "text")
    content = body.get("content", "")

    # Block path-based types from the public endpoint (server-side file read)
    if receipt_type in ("pdf_path", "image_path", "eml_path"):
        return {"ok": False, "error": "File path types not accepted. Use /receipt/upload-file instead."}

    return await _process_receipt(receipt_type, content, request)


@router.post("/receipt/upload-file")
async def upload_receipt_file(request: Request, file: UploadFile = File(...)):
    """Upload a receipt file (PDF, image, or .eml) and parse + reconcile it."""
    import tempfile
    import os

    user_id = request.state.user_id

    # Rate limit: max 10 receipt uploads per user per minute (shared with /receipt/upload)
    throttled = _check_throttle(user_id, "receipt_upload", 10, 60)
    if throttled:
        return throttled

    conn = _conn()
    trip = _get_active_trip(conn, user_id)
    if not trip:
        return {"ok": False, "error": "No active trip"}

    # Save uploaded file to temp location
    suffix = os.path.splitext(file.filename or "")[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        print(f"[receipt] Upload: {file.filename}, {len(content)} bytes, suffix={suffix}", flush=True)
        tmp_path = tmp.name

    try:
        # Route to correct parser (path types are safe here — we control the temp file)
        if suffix == ".pdf":
            rtype, rcontent = "pdf_path", tmp_path
        elif suffix == ".eml":
            rtype, rcontent = "eml_path", tmp_path
        elif suffix in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            rtype, rcontent = "image_path", tmp_path
        else:
            rtype, rcontent = "text", content.decode("utf-8", errors="replace")

        return await _process_receipt(rtype, rcontent, request)
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

    name = body.get("name")
    status = body.get("status")
    if not name or not status:
        return {"ok": False, "error": "name and status required"}

    ALLOWED_STATUSES = {"matched", "substituted", "not_fulfilled", "recover", "dismissed"}
    if status not in ALLOWED_STATUSES:
        return JSONResponse(status_code=400, content={"ok": False, "error": f"Invalid status '{status}'. Must be one of: {', '.join(sorted(ALLOWED_STATUSES))}"})

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
    elif status == "matched":
        # Confirming a match also checks it off the grocery list
        conn.execute(
            text("""UPDATE trip_items SET receipt_status = 'matched',
                   checked = 1, checked_at = CURRENT_TIMESTAMP
               WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"""),
            {"trip_id": trip["id"], "name": name},
        )
    else:
        conn.execute(
            text("UPDATE trip_items SET receipt_status = :status WHERE trip_id = :trip_id AND LOWER(name) = LOWER(:name)"),
            {"status": status, "trip_id": trip["id"], "name": name},
        )
    conn.commit()
    return {"ok": True}


@router.get("/purchases")
async def get_purchases(request: Request):
    """Get purchase history — confirmed receipt matches with ratings, grouped by date."""
    from souschef.kroger import get_product_ratings, _make_product_key

    user_id = request.state.user_id
    conn = _conn()

    # Get all confirmed purchases across all trips for this user
    rows = conn.execute(
        text("""SELECT ti.name, ti.receipt_item, ti.receipt_price, ti.receipt_upc,
               ti.product_upc, ti.product_name, ti.product_brand, ti.product_size,
               ti.product_price, ti.product_image, ti.receipt_status, ti.checked_at,
               ti.submitted_at
           FROM trip_items ti
           JOIN grocery_trips gt ON gt.id = ti.trip_id
           WHERE gt.user_id = :uid
           AND ti.receipt_status IN ('matched', 'substituted')
           ORDER BY COALESCE(ti.checked_at, ti.submitted_at) DESC NULLS LAST, ti.name"""),
        {"uid": user_id},
    ).fetchall()

    purchases = []
    for r in rows:
        upc = r["receipt_upc"] or r["product_upc"] or ""
        brand = r["product_brand"] or ""
        desc = r["receipt_item"] or r["product_name"] or ""
        pk = _make_product_key(upc, brand, desc)
        ratings = get_product_ratings(conn, upc, user_id, product_key=pk)
        purchases.append({
            "name": r["name"],
            "receipt_item": r["receipt_item"],
            "receipt_price": r["receipt_price"],
            "product_name": r["product_name"],
            "product_brand": r["product_brand"],
            "product_size": r["product_size"],
            "product_price": r["product_price"],
            "product_image": r["product_image"],
            "receipt_status": r["receipt_status"],
            "product_key": pk,
            "upc": upc,
            "brand": brand,
            "rating": ratings["your_rating"],
            "date": r["checked_at"] or r["submitted_at"] or "",
        })

    return {"purchases": purchases}


@router.post("/product/rate")
async def rate_product_endpoint(body: dict, request: Request):
    """Rate a product: {upc, rating, product_description?, brand?, product_key?}"""
    from souschef.kroger import rate_product, _make_product_key

    user_id = request.state.user_id
    upc = body.get("upc", "").strip()
    rating = body.get("rating")
    brand = body.get("brand", "").strip()
    product_key = body.get("product_key", "").strip()
    desc = body.get("product_description", "").strip()

    # Compute product_key if not provided
    if not product_key:
        product_key = _make_product_key(upc, brand, desc)

    if not product_key or rating not in (1, -1, 0):
        return {"ok": False, "error": "product identifier and rating (1, -1, or 0) required"}

    conn = _conn()
    rate_product(conn, upc, rating, desc, user_id, brand=brand, product_key=product_key)
    return {"ok": True, "product_key": product_key, "rating": rating}


@router.get("/product/favorites")
async def get_favorites(request: Request):
    """Get all rated products for the current user."""
    user_id = request.state.user_id
    conn = _conn()
    rows = conn.execute(
        text(
            "SELECT id, upc, product_description, brand, product_key, rating, updated_at "
            "FROM product_ratings WHERE user_id = :uid AND rating != 0 "
            "ORDER BY rating DESC, updated_at DESC"
        ),
        {"uid": user_id},
    ).fetchall()
    return {
        "items": [
            {
                "id": r["id"],
                "upc": r["upc"],
                "description": r["product_description"],
                "brand": r["brand"],
                "product_key": r["product_key"],
                "rating": r["rating"],
            }
            for r in rows
        ]
    }


# ── Regulars ─────────────────────────────────────────────


@router.get("/regulars")
async def get_regulars(request: Request):
    """Get all regulars, grouped by shopping_group."""
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    conn = _conn()
    regulars = list_regulars(conn, user_id, active_only=True)
    resolve = _build_group_resolver(conn, user_id)
    return {
        "regulars": [
            {
                "id": r.id,
                "name": r.name,
                "shopping_group": resolve(r.name),
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
    if not body.get("name"):
        return {"ok": False, "error": "name required"}
    r = do_add(conn, user_id, body["name"], body.get("shopping_group", ""), body.get("store_pref", "either"))
    # Auto-dismiss any "remove" learning suggestion for this item
    conn.execute(
        text("INSERT INTO learning_dismissed (name, user_id) VALUES (:name, :user_id) ON CONFLICT DO NOTHING"),
        {"name": r.name.lower(), "user_id": user_id},
    )
    conn.commit()
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
    # Auto-dismiss learning suggestion: "add" if deactivated, "remove" if reactivated
    conn.execute(
        text("INSERT INTO learning_dismissed (name, user_id) VALUES (:name, :user_id) ON CONFLICT DO NOTHING"),
        {"name": r.name.lower(), "user_id": user_id},
    )
    conn.commit()
    return {
        "id": r.id,
        "name": r.name,
        "shopping_group": r.shopping_group,
        "store_pref": r.store_pref,
        "active": r.active,
    }


@router.delete("/regulars/{regular_id}")
async def remove_regular(regular_id: int, request: Request):
    """Soft-delete a regular by ID."""
    user_id = request.state.user_id
    conn = _conn()
    row = conn.execute(
        text("SELECT name FROM regulars WHERE id = :id AND user_id = :user_id AND active = 1"),
        {"id": regular_id, "user_id": user_id},
    ).fetchone()
    if not row:
        return {"ok": False}
    conn.execute(
        text("UPDATE regulars SET active = 0 WHERE id = :id"),
        {"id": regular_id},
    )
    # Auto-dismiss any "add" learning suggestion for this item
    conn.execute(
        text("INSERT INTO learning_dismissed (name, user_id) VALUES (:name, :user_id) ON CONFLICT DO NOTHING"),
        {"name": row["name"].lower(), "user_id": user_id},
    )
    conn.commit()
    return {"ok": True}


@router.post("/staples/recategorize")
async def recategorize_staple(body: dict, request: Request):
    """Change a staple's shopping group. Updates the source table and user override."""
    user_id = request.state.user_id
    conn = _conn()
    name = body.get("name", "").strip()
    item_type = body.get("type", "")  # 'regular' or 'pantry'
    item_id = body.get("id")
    group = body.get("shopping_group", "").strip()
    if not name or not group or not item_id:
        return {"ok": False}

    # Update the source table
    if item_type == "regular":
        conn.execute(
            text("UPDATE regulars SET shopping_group = :group WHERE id = :id AND user_id = :user_id"),
            {"group": group, "id": item_id, "user_id": user_id},
        )
    elif item_type == "pantry":
        # Pantry doesn't have shopping_group column, but user_item_groups handles it
        pass

    # Persist as user override for grocery list too
    conn.execute(
        text("""INSERT INTO user_item_groups (user_id, item_name, shopping_group)
           VALUES (:user_id, :name, :group)
           ON CONFLICT (user_id, item_name) DO UPDATE SET shopping_group = :group, updated_at = CURRENT_TIMESTAMP"""),
        {"user_id": user_id, "name": name.lower(), "group": group},
    )
    conn.commit()
    return {"ok": True, "shopping_group": group}


@router.get("/grocery/suggestions")
async def grocery_suggestions(request: Request):
    """Return all known item names for autocomplete (combined pool: ingredients + regulars + pantry)."""
    from souschef.regulars import list_regulars
    from souschef.pantry import list_pantry

    user_id = request.state.user_id
    conn = _conn()
    names: set[str] = set()

    # All ingredients
    rows = conn.execute(text("SELECT name FROM ingredients")).fetchall()
    for row in rows:
        names.add(row["name"].lower())

    # Regulars
    for r in list_regulars(conn, user_id, active_only=False):
        names.add(r.name.lower())

    # Pantry items
    for p in list_pantry(conn, user_id):
        if p.ingredient_name:
            names.add(p.ingredient_name.lower())

    return {"suggestions": sorted(names)}


# ── Recipes ──────────────────────────────────────────────


@router.get("/recipes")
async def get_recipes(request: Request):
    from souschef.recipes import list_recipes

    conn = _conn()
    recipes = list_recipes(conn, user_id=request.state.user_id)
    return {"recipes": [_recipe_dict(r) for r in recipes]}


@router.post("/recipes")
async def add_recipe(body: dict, request: Request):
    """Add a new recipe (name only, stub)."""
    conn = _conn()
    user_id = request.state.user_id
    name = body.get("name", "").strip().title()
    if not name:
        return {"ok": False}

    recipe_type = body.get("recipe_type", "meal")
    if recipe_type not in ("meal", "side"):
        recipe_type = "meal"

    existing = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = :name AND user_id = :user_id AND recipe_type = :rtype"),
        {"name": name.lower(), "user_id": user_id, "rtype": recipe_type},
    ).fetchone()
    if existing:
        return {"ok": True, "id": existing["id"], "exists": True}

    defaults = {"effort": "medium", "cleanup": "medium"} if recipe_type == "meal" else {"effort": "easy", "cleanup": "easy"}
    cursor = conn.execute(
        text("""INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
           prep_minutes, cook_minutes, servings, user_id, recipe_type)
           VALUES (:name, '', :effort, :cleanup, 0, 1, 0, 0, 0, 4, :user_id, :rtype)
           RETURNING id"""),
        {"name": name, "user_id": user_id, "rtype": recipe_type, **defaults},
    )
    recipe_id = cursor.fetchone()["id"]

    # Auto-add default ingredient for sides when name matches a known ingredient
    if recipe_type == "side":
        from souschef.planner import _auto_add_side_ingredient
        _auto_add_side_ingredient(conn, recipe_id, name)

    conn.commit()
    return {"ok": True, "id": recipe_id}


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: int, request: Request):
    """Remove a recipe. Won't delete if it's currently on the meal plan."""
    conn = _conn()
    user_id = request.state.user_id

    # Check if recipe is currently assigned to a meal in the rolling window
    in_use = conn.execute(
        text("SELECT COUNT(*) as cnt FROM meals WHERE recipe_id = :id AND user_id = :user_id"),
        {"id": recipe_id, "user_id": user_id},
    ).fetchone()
    if in_use["cnt"] > 0:
        return {"ok": False, "error": "Recipe is on your meal plan"}

    # Only delete if recipe belongs to this user
    recipe = conn.execute(
        text("SELECT id FROM recipes WHERE id = :id AND user_id = :user_id"),
        {"id": recipe_id, "user_id": user_id},
    ).fetchone()
    if not recipe:
        return {"ok": False, "error": "Recipe not found"}

    conn.execute(text("DELETE FROM recipe_ingredients WHERE recipe_id = :id"), {"id": recipe_id})
    conn.execute(text("DELETE FROM recipes WHERE id = :id AND user_id = :user_id"), {"id": recipe_id, "user_id": user_id})
    conn.commit()
    return {"ok": True}


@router.get("/recipes/{recipe_id}/ingredients")
async def get_recipe_ingredients(recipe_id: int, request: Request):
    """List ingredients for a recipe."""
    conn = _conn()
    user_id = request.state.user_id

    # Verify recipe belongs to this user
    own = conn.execute(
        text("SELECT id FROM recipes WHERE id = :id AND user_id = :user_id"),
        {"id": recipe_id, "user_id": user_id},
    ).fetchone()
    if not own:
        return {"ingredients": []}

    rows = conn.execute(
        text("""SELECT ri.id, i.name, i.aisle
           FROM recipe_ingredients ri
           JOIN ingredients i ON i.id = ri.ingredient_id
           WHERE ri.recipe_id = :recipe_id
           ORDER BY i.name"""),
        {"recipe_id": recipe_id},
    ).fetchall()
    return {"ingredients": [{"id": r["id"], "name": r["name"], "aisle": r["aisle"]} for r in rows]}


@router.post("/recipes/{recipe_id}/ingredients")
async def add_recipe_ingredient(recipe_id: int, body: dict, request: Request):
    """Add an ingredient to a recipe by name. Creates ingredient if it doesn't exist."""
    conn = _conn()
    user_id = request.state.user_id

    # Verify recipe belongs to this user
    own = conn.execute(
        text("SELECT id FROM recipes WHERE id = :id AND user_id = :user_id"),
        {"id": recipe_id, "user_id": user_id},
    ).fetchone()
    if not own:
        return {"ok": False, "error": "Recipe not found"}

    raw_name = body.get("name", "").strip()
    if not raw_name:
        return {"ok": False}

    # Normalize to canonical ingredient name
    name, matched_id = _normalize_name(conn, raw_name)

    if matched_id:
        ingredient_id = matched_id
    else:
        # Find exact or create
        row = conn.execute(
            text("SELECT id FROM ingredients WHERE LOWER(name) = :name"),
            {"name": name},
        ).fetchone()
        if row:
            ingredient_id = row["id"]
        else:
            from souschef.normalize import invalidate_cache
            group = _infer_item_group(conn, name, request.state.user_id)
            cursor = conn.execute(
                text("""INSERT INTO ingredients (name, aisle, default_unit)
                   VALUES (:name, :aisle, 'count')
                   RETURNING id"""),
                {"name": name, "aisle": group},
            )
            ingredient_id = cursor.fetchone()["id"]
            invalidate_cache()

    # Check if already linked
    existing = conn.execute(
        text("SELECT id FROM recipe_ingredients WHERE recipe_id = :rid AND ingredient_id = :iid"),
        {"rid": recipe_id, "iid": ingredient_id},
    ).fetchone()
    if existing:
        conn.commit()
        return {"ok": True, "exists": True}

    conn.execute(
        text("""INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit)
           VALUES (:rid, :iid, 1, 'count')"""),
        {"rid": recipe_id, "iid": ingredient_id},
    )
    conn.commit()
    result = {"ok": True, "name": name}
    if name.lower() != raw_name.lower():
        result["renamed_from"] = raw_name
    return result


@router.delete("/recipes/{recipe_id}/ingredients/{ri_id}")
async def remove_recipe_ingredient(recipe_id: int, ri_id: int, request: Request):
    """Remove an ingredient from a recipe."""
    conn = _conn()
    user_id = request.state.user_id

    # Verify recipe belongs to this user
    own = conn.execute(
        text("SELECT id FROM recipes WHERE id = :id AND user_id = :user_id"),
        {"id": recipe_id, "user_id": user_id},
    ).fetchone()
    if not own:
        return {"ok": False, "error": "Recipe not found"}

    conn.execute(
        text("DELETE FROM recipe_ingredients WHERE id = :id AND recipe_id = :rid"),
        {"id": ri_id, "rid": recipe_id},
    )
    conn.commit()
    return {"ok": True}


# ── Pantry ──────────────────────────────────────────────


@router.get("/pantry")
async def get_pantry(request: Request):
    """List all pantry items."""
    from souschef.pantry import list_pantry

    user_id = request.state.user_id
    conn = _conn()
    items = list_pantry(conn, user_id)
    resolve = _build_group_resolver(conn, user_id)
    return {
        "items": [
            {
                "id": p.id,
                "ingredient_id": p.ingredient_id,
                "name": p.ingredient_name,
                "quantity": p.quantity,
                "unit": p.unit,
                "shopping_group": resolve(p.ingredient_name),
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
    raw_name = body.get("name", "").strip()
    if not raw_name:
        return {"ok": False, "error": "name required"}
    quantity = body.get("quantity", 1.0)
    unit = body.get("unit", "count")

    # Normalize to canonical ingredient name
    name, _ = _normalize_name(conn, raw_name)

    # If ingredient doesn't exist, create it
    ing = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = :name"),
        {"name": name},
    ).fetchone()
    if not ing:
        from souschef.normalize import invalidate_cache
        conn.execute(
            text("INSERT INTO ingredients (name, aisle) VALUES (:name, :aisle)"),
            {"name": name, "aisle": body.get("shopping_group", "Other")},
        )
        conn.commit()
        invalidate_cache()

    result = add_pantry_item(conn, user_id, name, quantity, unit)
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

    user_id = request.state.user_id
    return {"stores": list_stores(_conn(), user_id)}


@router.post("/stores")
async def add_store(body: dict, request: Request):
    """Add a store."""
    from souschef.stores import add_store as do_add

    user_id = request.state.user_id
    name = body.get("name", "").strip()
    key = body.get("key", name[:1].lower() if name else "x")
    mode = body.get("mode", "in-person")
    api_type = body.get("api", "none")

    try:
        store = do_add(_conn(), user_id, name, key, mode, api_type)
        return {"ok": True, "store": store}
    except ValueError as e:
        logger.error("Failed to add store: %s", e)
        return {"ok": False, "error": "Failed to add store"}


@router.delete("/stores/{key}")
async def remove_store(key: str, request: Request):
    """Remove a store by key."""
    from souschef.stores import remove_store as do_remove

    user_id = request.state.user_id
    removed = do_remove(_conn(), user_id, key)
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
    user_id = request.state.user_id
    name = body.get("name", "").strip()
    if not name:
        return {"ok": False}

    # Check if recipe already exists for this user
    existing = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = :name AND user_id = :user_id"),
        {"name": name.lower(), "user_id": user_id},
    ).fetchone()
    if existing:
        return {"ok": True, "id": existing["id"], "name": name}

    cursor = conn.execute(
        text("""INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
           prep_minutes, cook_minutes, servings, user_id)
           VALUES (:name, '', 'medium', 'medium', 0, 1, 0, 0, 0, 4, :user_id)
           RETURNING id"""),
        {"name": name, "user_id": user_id},
    )
    conn.commit()
    return {"ok": True, "id": cursor.fetchone()["id"], "name": name}


@router.get("/onboarding/library")
async def get_onboarding_library(request: Request):
    """Return library meals and sides for onboarding picker."""
    conn = _conn()
    meals = conn.execute(
        text("SELECT id, name FROM recipes WHERE user_id = '__library__' AND recipe_type = 'meal' ORDER BY name"),
    ).fetchall()
    sides = conn.execute(
        text("SELECT id, name FROM recipes WHERE user_id = '__library__' AND recipe_type = 'side' ORDER BY name"),
    ).fetchall()
    return {
        "meals": [{"id": r["id"], "name": r["name"]} for r in meals],
        "sides": [{"id": r["id"], "name": r["name"]} for r in sides],
    }


@router.post("/onboarding/select-recipes")
async def select_onboarding_recipes(body: dict, request: Request):
    """Copy selected library recipes to user's account and create custom stubs."""
    user_id = request.state.user_id
    conn = _conn()

    meal_ids = body.get("meal_ids", [])
    side_ids = body.get("side_ids", [])
    custom_meals = body.get("custom_meals", [])
    custom_sides = body.get("custom_sides", [])

    # Copy library recipes (deep copy: recipe + recipe_ingredients)
    for lib_id in meal_ids + side_ids:
        _copy_library_recipe(conn, lib_id, user_id)

    # Create custom meal stubs
    for name in custom_meals:
        name = name.strip()
        if not name:
            continue
        existing = conn.execute(
            text("SELECT id FROM recipes WHERE LOWER(name) = LOWER(:name) AND user_id = :uid"),
            {"name": name, "uid": user_id},
        ).fetchone()
        if not existing:
            conn.execute(text(
                """INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
                   prep_minutes, cook_minutes, servings, user_id, recipe_type)
                   VALUES (:name, '', 'medium', 'medium', 0, 1, 0, 0, 0, 4, :uid, 'meal')"""
            ), {"name": name, "uid": user_id})

    # Create custom side stubs
    for name in custom_sides:
        name = name.strip()
        if not name:
            continue
        existing = conn.execute(
            text("SELECT id FROM recipes WHERE LOWER(name) = LOWER(:name) AND user_id = :uid"),
            {"name": name, "uid": user_id},
        ).fetchone()
        if not existing:
            conn.execute(text(
                """INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
                   prep_minutes, cook_minutes, servings, user_id, recipe_type)
                   VALUES (:name, '', 'medium', 'medium', 0, 1, 0, 0, 0, 4, :uid, 'side')"""
            ), {"name": name, "uid": user_id})

    conn.commit()
    return {"ok": True}


def _copy_library_recipe(conn, lib_recipe_id: int, user_id: str) -> int | None:
    """Deep copy a library recipe to the user's account. Returns new recipe id."""
    lib = conn.execute(
        text("SELECT * FROM recipes WHERE id = :id AND user_id = '__library__'"),
        {"id": lib_recipe_id},
    ).fetchone()
    if not lib:
        return None

    # Check if user already has this recipe
    existing = conn.execute(
        text("SELECT id FROM recipes WHERE LOWER(name) = LOWER(:name) AND user_id = :uid"),
        {"name": lib["name"], "uid": user_id},
    ).fetchone()
    if existing:
        return existing["id"]

    result = conn.execute(text(
        """INSERT INTO recipes (name, cuisine, effort, cleanup, outdoor, kid_friendly, premade,
           prep_minutes, cook_minutes, servings, notes, user_id, recipe_type)
           VALUES (:name, :cuisine, :effort, :cleanup, :outdoor, :kid, :premade,
                    :prep, :cook, :servings, :notes, :uid, :recipe_type)
           RETURNING id"""
    ), {
        "name": lib["name"], "cuisine": lib["cuisine"], "effort": lib["effort"],
        "cleanup": lib["cleanup"], "outdoor": lib["outdoor"], "kid": lib["kid_friendly"],
        "premade": lib["premade"], "prep": lib["prep_minutes"], "cook": lib["cook_minutes"],
        "servings": lib["servings"], "notes": lib["notes"], "uid": user_id,
        "recipe_type": lib["recipe_type"],
    })
    new_id = result.fetchone()["id"]

    # Copy ingredients
    ingredients = conn.execute(
        text("SELECT * FROM recipe_ingredients WHERE recipe_id = :rid"),
        {"rid": lib_recipe_id},
    ).fetchall()
    for ing in ingredients:
        conn.execute(text(
            """INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, prep_note, component)
               VALUES (:rid, :iid, :qty, :unit, :prep, :comp)"""
        ), {
            "rid": new_id, "iid": ing["ingredient_id"], "qty": ing["quantity"],
            "unit": ing["unit"], "prep": ing["prep_note"], "comp": ing["component"],
        })

    return new_id


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
    """Suggest regulars additions/removals based on weekly shopping patterns.

    Uses calendar-week grouping over item timestamps. Requires 4+ weeks of data.
    Suggests additions for items appearing in 4+ of the last 5 active weeks,
    and removals for regulars skipped in 4+ of the last 5 active weeks.
    """
    from souschef.regulars import list_regulars

    user_id = request.state.user_id
    conn = _conn()

    # Get all items from the last 35 days, grouped by calendar week
    rows = conn.execute(
        text("""SELECT LOWER(ti.name) as name, ti.source,
                       EXTRACT(ISOYEAR FROM ti.added_at::timestamp) AS iso_year,
                       EXTRACT(WEEK FROM ti.added_at::timestamp) AS iso_week
                FROM trip_items ti
                JOIN grocery_trips gt ON gt.id = ti.trip_id
                WHERE gt.user_id = :user_id
                  AND ti.added_at > NOW() - INTERVAL '35 days'"""),
        {"user_id": user_id},
    ).fetchall()

    if not rows:
        return {"add": [], "remove": []}

    # Group items by calendar week
    week_items: dict[str, set[str]] = {}
    week_skips: dict[str, set[str]] = {}
    for r in rows:
        try:
            week_key = f"{int(r['iso_year'])}-W{int(r['iso_week']):02d}"
        except (TypeError, ValueError):
            continue
        if r["source"] != "regular_skip":
            week_items.setdefault(week_key, set()).add(r["name"])
        else:
            week_skips.setdefault(week_key, set()).add(r["name"])

    sorted_weeks = sorted(week_items.keys(), reverse=True)[:5]
    if len(sorted_weeks) < 4:
        return {"add": [], "remove": []}

    total_weeks = len(sorted_weeks)

    regulars = list_regulars(conn, user_id, active_only=False)
    regular_names = {r.name.lower() for r in regulars}
    dismissed_rows = conn.execute(
        text("SELECT name FROM learning_dismissed WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).fetchall()
    dismissed = {r["name"] for r in dismissed_rows}

    # --- Addition suggestions ---
    item_week_count: dict[str, int] = {}
    for week_key in sorted_weeks:
        for name in week_items.get(week_key, set()):
            item_week_count[name] = item_week_count.get(name, 0) + 1

    add_suggestions = []
    for name, week_count in item_week_count.items():
        if week_count >= 4 and name not in regular_names and name not in dismissed:
            add_suggestions.append({
                "name": name,
                "trip_count": week_count,
                "total_trips": total_weeks,
            })

    # --- Removal suggestions ---
    remove_suggestions = []
    active_regulars = [r for r in regulars if r.active]
    for reg in active_regulars:
        name_lower = reg.name.lower()
        if name_lower in dismissed:
            continue
        skip_weeks = sum(1 for wk in sorted_weeks if name_lower in week_skips.get(wk, set()))
        if skip_weeks >= 4:
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


# ── Community Data ────────────────────────────────────────


@router.post("/community-data")
async def submit_community_data(body: dict, request: Request):
    """Submit user-contributed data (brand ownership, etc.)."""
    import uuid
    data_type = body.get("data_type", "").strip()
    subject = body.get("subject", "").strip()
    suggested_value = body.get("suggested_value", "").strip()
    if not data_type or not subject or not suggested_value:
        return {"ok": False, "error": "All fields required"}

    real_user_id = request.state.real_user_id
    conn = _conn()

    # Look up household_id
    hh = conn.execute(
        text("SELECT household_id FROM household_members WHERE user_id = :uid"),
        {"uid": real_user_id},
    ).fetchone()
    household_id = hh["household_id"] if hh else ""

    conn.execute(
        text("""INSERT INTO community_data (id, user_id, household_id, data_type, subject, suggested_value)
           VALUES (:id, :uid, :hh, :dt, :subj, :val)"""),
        {"id": str(uuid.uuid4()), "uid": real_user_id, "hh": household_id,
         "dt": data_type, "subj": subject, "val": suggested_value},
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


@router.get("/household/pending-invite")
async def get_pending_invite(request: Request):
    """Check if the current user has a pending household invite."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()

    # Get this user's email
    user = conn.execute(
        text("SELECT email FROM users WHERE id = :id"),
        {"id": real_user_id},
    ).fetchone()
    if not user:
        return {"invite": None}

    # Find pending invite
    invite = conn.execute(
        text("""SELECT hi.household_id, hi.invited_by, u.display_name, u.email AS inviter_email
               FROM household_invites hi
               JOIN users u ON u.id = hi.invited_by
               WHERE LOWER(hi.email) = LOWER(:email) AND hi.status = 'pending'
               ORDER BY hi.created_at DESC LIMIT 1"""),
        {"email": user["email"]},
    ).fetchone()
    if not invite:
        return {"invite": None}

    inviter_name = invite["display_name"] or invite["inviter_email"].split("@")[0]
    return {
        "invite": {
            "household_id": invite["household_id"],
            "inviter_name": inviter_name,
        }
    }


@router.post("/household/accept-invite")
async def accept_invite(request: Request):
    """Accept a pending household invite."""
    from souschef.web.app import _process_household_invite

    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()

    user = conn.execute(
        text("SELECT email FROM users WHERE id = :id"),
        {"id": real_user_id},
    ).fetchone()
    if not user:
        return {"ok": False}

    _process_household_invite(conn, real_user_id, user["email"])
    return {"ok": True}


@router.post("/household/decline-invite")
async def decline_invite(request: Request):
    """Decline a pending household invite."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()

    user = conn.execute(
        text("SELECT email FROM users WHERE id = :id"),
        {"id": real_user_id},
    ).fetchone()
    if not user:
        return {"ok": False}

    conn.execute(
        text("""UPDATE household_invites SET status = 'declined'
               WHERE LOWER(email) = LOWER(:email) AND status = 'pending'"""),
        {"email": user["email"]},
    )
    conn.commit()
    return {"ok": True}


# ── Account ──────────────────────────────────────────────


@router.post("/account/update")
async def update_account(body: dict, request: Request):
    """Update current user's profile (display_name)."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()

    display_name = body.get("display_name")
    if display_name is not None:
        display_name = display_name.strip() or None
        conn.execute(
            text("UPDATE users SET display_name = :name WHERE id = :id"),
            {"name": display_name, "id": real_user_id},
        )
        conn.commit()

    user = conn.execute(
        text("SELECT id, email, display_name FROM users WHERE id = :id"),
        {"id": real_user_id},
    ).fetchone()
    return {"ok": True, "email": user["email"], "display_name": user["display_name"]}


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


@router.get("/feedback/responses")
async def get_feedback_responses(request: Request):
    """Return unread feedback responses for the current user."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    rows = conn.execute(
        text("""SELECT id, message, response, responded_at
           FROM user_feedback
           WHERE user_id = :user_id AND status = 'responded' AND dismissed = 0
           ORDER BY responded_at DESC"""),
        {"user_id": real_user_id},
    ).fetchall()
    return {"responses": [{"id": r["id"], "message": r["message"],
                           "response": r["response"], "responded_at": r["responded_at"]} for r in rows]}


@router.post("/feedback/{feedback_id}/dismiss")
async def dismiss_feedback_response(feedback_id: int, request: Request):
    """Mark a feedback response as seen."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    conn.execute(
        text("UPDATE user_feedback SET dismissed = 1 WHERE id = :id AND user_id = :user_id"),
        {"id": feedback_id, "user_id": real_user_id},
    )
    conn.commit()
    return {"ok": True}


def _is_admin(conn, user_id: str) -> bool:
    """Admin = first registered user (household owner). Good enough for beta."""
    import os
    admin_id = os.environ.get("ADMIN_USER_ID")
    if admin_id:
        return user_id == admin_id
    row = conn.execute(text("SELECT id FROM users ORDER BY created_at LIMIT 1")).fetchone()
    return row and row["id"] == user_id


@router.get("/feedback/all")
async def get_all_feedback(request: Request):
    """Admin: list all feedback."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    if not _is_admin(conn, real_user_id):
        return {"ok": False, "error": "Not authorized"}
    rows = conn.execute(
        text("SELECT f.*, u.email FROM user_feedback f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC"),
    ).fetchall()
    return {"feedback": [dict(r._mapping) for r in rows]}


@router.get("/admin/unknown-brands")
async def get_unknown_brands(request: Request):
    """Admin: list unknown brands sorted by frequency."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    if not _is_admin(conn, real_user_id):
        return {"ok": False, "error": "Not authorized"}
    rows = conn.execute(
        text("SELECT brand, times_seen, first_seen, last_seen FROM unknown_brands ORDER BY times_seen DESC"),
    ).fetchall()
    return {"brands": [dict(r._mapping) for r in rows]}


@router.post("/admin/refresh-violations")
async def refresh_violations(request: Request):
    """Admin: refresh FDA violation data for all parent companies."""
    from souschef.violations import refresh_fda_data

    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    if not _is_admin(conn, real_user_id):
        return {"ok": False, "error": "Not authorized"}
    result = refresh_fda_data(conn)
    return {"ok": True, **result}


@router.post("/feedback/{feedback_id}/respond")
async def respond_to_feedback(feedback_id: int, body: dict, request: Request):
    """Admin: respond to a feedback item."""
    real_user_id = getattr(request.state, 'real_user_id', request.state.user_id)
    conn = _conn()
    if not _is_admin(conn, real_user_id):
        return {"ok": False, "error": "Not authorized"}
    response_text = body.get("response", "").strip()
    if not response_text:
        return {"ok": False, "error": "Response required"}
    conn.execute(
        text("""UPDATE user_feedback
           SET status = 'responded', response = :response, responded_at = CURRENT_TIMESTAMP
           WHERE id = :id"""),
        {"id": feedback_id, "response": response_text},
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
        "side": m.side,  # backward compat: comma-joined side names
        "side_recipe_id": m.side_recipe_id,  # backward compat: first side's recipe ID
        "sides": [
            {"id": s.id, "side_recipe_id": s.side_recipe_id, "name": s.side_name, "position": s.position}
            for s in m.sides
        ],
        "locked": m.locked,
        "is_followup": m.is_followup,
        "on_grocery": m.on_grocery,
        "day_name": m.day_name,
        "day_short": m.day_short,
        "notes": m.notes,
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
        "recipe_type": r.recipe_type,
    }
