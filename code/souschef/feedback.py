"""Shopping feedback loop: detect patterns from grocery item history.

Two patterns:
- Skipped meal items: ingredients listed for a recipe but never bought
- Extra-meal links: manually added items that correlate with specific meals

Uses time-window analysis (calendar weeks over last 90 days) instead of trip boundaries.
"""

from __future__ import annotations

from sqlalchemy import text

from souschef.database import DictConnection


def detect_skipped_items(conn: DictConnection, user_id: str, min_weeks: int = 3) -> list[dict]:
    """Find meal ingredients the user consistently does not buy.

    Looks at meal-sourced items over the last 90 days.
    Returns list of {"item", "meal", "times_listed"} dicts.
    """
    rows = conn.execute(text("""
        SELECT ti.name, ti.for_meals, ti.checked
        FROM trip_items ti
        JOIN grocery_trips gt ON gt.id = ti.trip_id
        WHERE gt.user_id = :user_id
          AND ti.source = 'meal' AND ti.for_meals != ''
          AND ti.added_at > NOW() - INTERVAL '90 days'
    """), {"user_id": user_id}).fetchall()

    # Accumulate (item, meal) -> {listed, bought}
    pairs: dict[tuple[str, str], dict] = {}
    for r in rows:
        for meal in r["for_meals"].split(","):
            meal = meal.strip()
            if not meal:
                continue
            key = (r["name"], meal)
            if key not in pairs:
                pairs[key] = {"listed": 0, "bought": 0}
            pairs[key]["listed"] += 1
            pairs[key]["bought"] += r["checked"]

    # Filter: listed enough times and never bought
    dismissed = _get_dismissed(conn, user_id, "skip")
    results = []
    for (item, meal), d in pairs.items():
        if d["listed"] >= min_weeks and d["bought"] == 0:
            if f"{item}::{meal.lower()}" not in dismissed:
                results.append({
                    "item": item,
                    "meal": meal,
                    "times_listed": d["listed"],
                })
    return results


def detect_extra_meal_links(conn: DictConnection, user_id: str, min_occurrences: int = 3) -> list[dict]:
    """Find extra items that always appear when a specific meal is planned.

    Uses calendar-week grouping over the last 20 weeks.
    Returns list of {"item", "meal", "times_together", "meal_weeks"} dicts.
    """
    from souschef.regulars import list_regulars

    # Get all meal-sourced and extra items from the last 20 weeks
    rows = conn.execute(text("""
        SELECT ti.name, ti.for_meals, ti.source, ti.checked,
               EXTRACT(ISOYEAR FROM ti.added_at::timestamp) AS yr,
               EXTRACT(WEEK FROM ti.added_at::timestamp) AS wk
        FROM trip_items ti
        JOIN grocery_trips gt ON gt.id = ti.trip_id
        WHERE gt.user_id = :user_id
          AND ti.added_at > NOW() - INTERVAL '140 days'
          AND ti.source IN ('meal', 'extra')
    """), {"user_id": user_id}).fetchall()

    if not rows:
        return []

    # Exclude items already in regulars
    regular_names = {r.name.lower() for r in list_regulars(conn, user_id, active_only=False)}

    # Group by calendar week
    week_data: dict[tuple, dict] = {}
    for r in rows:
        try:
            week_key = (int(r["yr"]), int(r["wk"]))
        except (TypeError, ValueError):
            continue
        if week_key not in week_data:
            week_data[week_key] = {"meals": set(), "extras": set()}
        if r["source"] == "meal" and r["for_meals"]:
            for m in r["for_meals"].split(","):
                m = m.strip()
                if m:
                    week_data[week_key]["meals"].add(m)
        elif r["source"] == "extra" and r["checked"]:
            if r["name"] not in regular_names:
                week_data[week_key]["extras"].add(r["name"])

    # Count co-occurrences
    meal_count: dict[str, int] = {}
    pair_count: dict[tuple[str, str], int] = {}
    for td in week_data.values():
        for meal in td["meals"]:
            meal_count[meal] = meal_count.get(meal, 0) + 1
            for extra in td["extras"]:
                key = (extra, meal)
                pair_count[key] = pair_count.get(key, 0) + 1

    dismissed = _get_dismissed(conn, user_id, "extra_link")
    results = []
    for (extra, meal), count in pair_count.items():
        total = meal_count[meal]
        if count >= min_occurrences and count / total >= 0.75:
            if f"{extra}::{meal.lower()}" not in dismissed:
                results.append({
                    "item": extra,
                    "meal": meal,
                    "times_together": count,
                    "meal_weeks": total,
                })
    return results


def get_overrides(conn: DictConnection, user_id: str) -> list[dict]:
    """Get all active meal item overrides."""
    rows = conn.execute(text(
        "SELECT recipe_name, item_name, action FROM meal_item_overrides WHERE user_id = :user_id ORDER BY recipe_name, item_name"
    ), {"user_id": user_id}).fetchall()
    return [{"recipe_name": r["recipe_name"], "item_name": r["item_name"], "action": r["action"]} for r in rows]


def get_skips_for_meal(conn: DictConnection, user_id: str, meal_name: str) -> set[str]:
    """Get item names to skip for a specific meal."""
    rows = conn.execute(text(
        "SELECT item_name FROM meal_item_overrides WHERE user_id = :user_id AND LOWER(recipe_name) = LOWER(:meal) AND action = 'skip'"
    ), {"user_id": user_id, "meal": meal_name}).fetchall()
    return {r["item_name"] for r in rows}


def get_adds_for_meal(conn: DictConnection, user_id: str, meal_name: str) -> list[dict]:
    """Get items to auto-add for a specific meal."""
    rows = conn.execute(text(
        "SELECT item_name FROM meal_item_overrides WHERE user_id = :user_id AND LOWER(recipe_name) = LOWER(:meal) AND action = 'add'"
    ), {"user_id": user_id, "meal": meal_name}).fetchall()
    return [{"item_name": r["item_name"]} for r in rows]


def _get_dismissed(conn: DictConnection, user_id: str, kind: str) -> set[str]:
    """Get dismissed feedback suggestion keys for a given kind."""
    rows = conn.execute(text(
        "SELECT name FROM learning_dismissed WHERE user_id = :user_id AND kind = :kind"
    ), {"user_id": user_id, "kind": kind}).fetchall()
    return {r["name"] for r in rows}
