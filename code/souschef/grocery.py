"""Grocery list builder: dedup, pantry subtraction, store split."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import text

from souschef.database import DictConnection
from souschef.models import GroceryList, GroceryListItem, Meal
from souschef.pantry import get_pantry_quantity


def build_grocery_list(
    conn: DictConnection,
    meals: list[Meal],
    start_date: str = "",
    end_date: str = "",
    user_id: str = "default",
) -> GroceryList:
    """Build a grocery list from a list of meals."""
    # Aggregate ingredients across all meals
    agg: dict[int, dict] = {}

    for meal in meals:
        # Add side dish ingredients from recipe_ingredients (DB-backed sides)
        if meal.side_recipe_id:
            side_rows = conn.execute(
                text("""SELECT ri.ingredient_id, ri.quantity, ri.unit,
                          i.name, i.store_pref, i.aisle, i.is_pantry_staple, i.category
                   FROM recipe_ingredients ri
                   JOIN ingredients i ON i.id = ri.ingredient_id
                   WHERE ri.recipe_id = :recipe_id"""),
                {"recipe_id": meal.side_recipe_id},
            ).fetchall()
            for sr in side_rows:
                iid = sr["ingredient_id"]
                if iid in agg:
                    agg[iid]["quantity"] += sr["quantity"]
                    agg[iid]["meals"].add(meal.side or meal.recipe_name)
                else:
                    agg[iid] = {
                        "quantity": sr["quantity"],
                        "unit": sr["unit"],
                        "store": sr["store_pref"],
                        "aisle": sr["aisle"],
                        "name": sr["name"],
                        "is_staple": bool(sr["is_pantry_staple"]),
                        "category": sr["category"],
                        "meals": {meal.side or meal.recipe_name},
                    }

        if meal.recipe_id is None:
            continue

        rows = conn.execute(
            text("""SELECT ri.ingredient_id, ri.quantity, ri.unit, ri.component,
                      i.name, i.store_pref, i.aisle, i.is_pantry_staple, i.category
               FROM recipe_ingredients ri
               JOIN ingredients i ON i.id = ri.ingredient_id
               WHERE ri.recipe_id = :recipe_id"""),
            {"recipe_id": meal.recipe_id},
        ).fetchall()

        for r in rows:
            iid = r["ingredient_id"]
            # Skip the protein in follow-up meals — it's covered by the big cook
            if meal.is_followup and r["component"] == "protein":
                continue
            if iid in agg:
                agg[iid]["quantity"] += r["quantity"]
                agg[iid]["meals"].add(meal.recipe_name)
            else:
                agg[iid] = {
                    "quantity": r["quantity"],
                    "unit": r["unit"],
                    "store": r["store_pref"],
                    "aisle": r["aisle"],
                    "name": r["name"],
                    "is_staple": bool(r["is_pantry_staple"]),
                    "category": r["category"],
                    "meals": {meal.recipe_name},
                }

    # Subtract pantry stock; skip regulars (handled separately via checklist)
    from souschef.regulars import list_regulars
    regular_names = {r.name.lower() for r in list_regulars(conn, user_id)}

    items: list[GroceryListItem] = []
    staples_used: list[str] = []
    for iid, info in sorted(agg.items(), key=lambda x: (x[1]["store"], x[1]["aisle"], x[1]["name"])):
        if info["is_staple"]:
            staples_used.append(info["name"])
            continue
        if info["name"].lower() in regular_names:
            continue

        pantry_qty = get_pantry_quantity(conn, user_id, iid)
        needed = info["quantity"] - pantry_qty
        if needed <= 0:
            continue

        items.append(GroceryListItem(
            id=None,
            list_id=0,
            ingredient_id=iid,
            total_quantity=round(needed, 2),
            unit=info["unit"],
            store=info["store"],
            aisle=info["aisle"],
            from_pantry=pantry_qty,
            ingredient_name=info["name"],
            category=info["category"],
            meals=sorted(info["meals"]),
        ))

    gl = GroceryList(id=None, start_date=start_date, end_date=end_date, items=items)
    gl.staples_used = staples_used
    return gl



def split_by_store(gl: GroceryList) -> dict[str, list[GroceryListItem]]:
    stores: dict[str, list[GroceryListItem]] = defaultdict(list)
    for item in gl.items:
        stores[item.store].append(item)
    return dict(stores)
