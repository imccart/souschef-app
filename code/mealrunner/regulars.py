"""Regulars — recurring items bought on a regular basis.

Replaces the old essentials + pantry staples split. A "regular" is anything
the user buys repeatedly: coffee, eggs, olive oil, flour. The user checks
what they need each grocery run from a saved list.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from mealrunner.database import DictConnection


@dataclass
class Regular:
    id: int | None
    name: str
    ingredient_id: int | None  # nullable FK → ingredients
    shopping_group: str  # resolved: from ingredient if linked, else own field
    store_pref: str
    active: bool = True


def list_regulars(
    conn: DictConnection, user_id: str, active_only: bool = True
) -> list[Regular]:
    """List regulars. Returns raw shopping_group from the regulars table.

    Group resolution (user override > ingredient aisle > keyword) is done
    by the API layer via _infer_item_group, not here.
    """
    query = """
        SELECT r.*
        FROM regulars r
        WHERE r.user_id = :user_id
    """
    if active_only:
        query += " AND r.active = 1"
    query += " ORDER BY r.name"
    rows = conn.execute(text(query), {"user_id": user_id}).fetchall()
    return [
        Regular(
            id=r["id"],
            name=r["name"],
            ingredient_id=r["ingredient_id"],
            shopping_group=r["shopping_group"] or "",
            store_pref=r["store_pref"],
            active=bool(r["active"]),
        )
        for r in rows
    ]


def add_regular(
    conn: DictConnection,
    user_id: str,
    name: str,
    shopping_group: str = "",
    store_pref: str = "either",
) -> Regular:
    """Add a regular item. Silently links to an ingredient if a match exists."""
    from mealrunner.normalize import normalize_item_name
    canonical, ingredient_id = normalize_item_name(conn, name)
    name = canonical  # use canonical name if matched, else lowercased input

    # If we matched an ingredient and no group was given, inherit it
    if ingredient_id and not shopping_group:
        row = conn.execute(
            text("SELECT aisle FROM ingredients WHERE id = :id"), {"id": ingredient_id}
        ).fetchone()
        if row and row["aisle"]:
            shopping_group = row["aisle"]

    if not shopping_group:
        shopping_group = _infer_group(name)

    existing = conn.execute(
        text("SELECT id FROM regulars WHERE user_id = :user_id AND LOWER(name) = LOWER(:name)"),
        {"user_id": user_id, "name": name},
    ).fetchone()

    if existing:
        conn.execute(
            text("""UPDATE regulars SET
                active = 1,
                ingredient_id = COALESCE(:ingredient_id, ingredient_id),
                shopping_group = CASE WHEN :shopping_group != '' THEN :shopping_group ELSE shopping_group END,
                store_pref = :store_pref
                WHERE id = :id"""),
            {"ingredient_id": ingredient_id, "shopping_group": shopping_group,
             "store_pref": store_pref, "id": existing["id"]},
        )
    else:
        conn.execute(
            text("""INSERT INTO regulars (user_id, name, ingredient_id, shopping_group, store_pref)
               VALUES (:user_id, :name, :ingredient_id, :shopping_group, :store_pref)"""),
            {"user_id": user_id, "name": name, "ingredient_id": ingredient_id,
             "shopping_group": shopping_group, "store_pref": store_pref},
        )
    conn.commit()

    row = conn.execute(
        text("SELECT * FROM regulars WHERE user_id = :user_id AND LOWER(name) = LOWER(:name)"),
        {"user_id": user_id, "name": name},
    ).fetchone()
    return Regular(
        id=row["id"],
        name=row["name"],
        ingredient_id=row["ingredient_id"],
        shopping_group=row["shopping_group"] or shopping_group,
        store_pref=row["store_pref"],
        active=bool(row["active"]),
    )


def remove_regular(conn: DictConnection, user_id: str, name: str) -> bool:
    """Hard-delete a regular by name."""
    cursor = conn.execute(
        text("DELETE FROM regulars WHERE user_id = :user_id AND LOWER(name) = LOWER(:name)"),
        {"user_id": user_id, "name": name},
    )
    conn.commit()
    return cursor.rowcount > 0


def toggle_regular(conn: DictConnection, user_id: str, regular_id: int) -> Regular | None:
    """Toggle a regular's active state."""
    row = conn.execute(
        text("SELECT * FROM regulars WHERE user_id = :user_id AND id = :id"),
        {"user_id": user_id, "id": regular_id},
    ).fetchone()
    if not row:
        return None
    new_active = 0 if row["active"] else 1
    conn.execute(
        text("UPDATE regulars SET active = :active WHERE user_id = :user_id AND id = :id"),
        {"active": new_active, "user_id": user_id, "id": regular_id},
    )
    conn.commit()
    return Regular(
        id=row["id"],
        name=row["name"],
        ingredient_id=row["ingredient_id"],
        shopping_group=row["shopping_group"] or "Other",
        store_pref=row["store_pref"],
        active=bool(new_active),
    )


def get_regulars_by_group(
    conn: DictConnection, user_id: str, active_only: bool = True
) -> dict[str, list[Regular]]:
    """Return regulars grouped by shopping_group."""
    items = list_regulars(conn, user_id, active_only=active_only)
    groups: dict[str, list[Regular]] = {}
    for item in items:
        groups.setdefault(item.shopping_group, []).append(item)
    return groups


# ── Silent matching ──────────────────────────────────────


def _match_ingredient(conn: DictConnection, name: str) -> int | None:
    """Try to match a regular name to an existing ingredient. Returns ingredient_id or None."""
    # Exact match first
    row = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = LOWER(:name)"), {"name": name}
    ).fetchone()
    if row:
        return row["id"]

    # Fuzzy: check if the name contains an ingredient name or vice versa
    rows = conn.execute(text("SELECT id, name FROM ingredients")).fetchall()
    name_lower = name.lower()
    for r in rows:
        ing_name = r["name"].lower()
        if ing_name in name_lower or name_lower in ing_name:
            return r["id"]

    return None


_GROUP_KEYWORDS: dict[str, list[str]] = {
    "Produce": ["apple", "banana", "lettuce", "tomato", "onion", "potato", "fruit",
                 "veggie", "vegetable", "pepper", "carrot", "celery", "garlic", "avocado",
                 "lemon", "lime", "cilantro", "parsley", "basil", "spinach", "broccoli"],
    "Meat": ["chicken", "beef", "pork", "turkey", "sausage", "bacon", "steak", "ground",
             "ham", "meatball"],
    "Dairy & Eggs": ["milk", "cream", "cheese", "yogurt", "butter", "egg", "sour cream"],
    "Bread & Bakery": ["bread", "bun", "roll", "tortilla", "pita", "cornbread", "bagel"],
    "Pasta & Grains": ["pasta", "noodle", "rice", "quinoa", "couscous", "oat"],
    "Spices & Baking": ["black pepper", "chili powder", "garlic powder", "onion powder",
                         "cumin", "paprika", "oregano", "cinnamon",
                         "pepper", "seasoning", "spice", "sugar", "flour", "baking",
                         "vanilla", "cocoa", "salt", "thyme", "cayenne", "nutmeg"],
    "Condiments & Sauces": ["sauce", "ketchup", "mustard", "mayo", "dressing", "vinegar",
                             "oil", "soy sauce", "worcestershire", "hot sauce", "salsa",
                             "tomato paste", "honey", "syrup", "ranch"],
    "Canned Goods": ["canned", "soup", "broth", "stock", "beans", "tomato sauce",
                      "diced tomato", "paste", "tuna"],
    "Frozen": ["frozen", "ice cream"],
    "Breakfast & Beverages": ["cereal", "granola", "oatmeal", "juice", "tea",
                               "la croix", "soda", "water", "pancake"],
    "Snacks": ["tortilla chips", "chips", "crackers", "cookies", "snack", "popcorn", "nuts", "pretzel"],
    "Personal Care": ["shampoo", "conditioner", "soap", "toothpaste", "toothbrush", "deodorant",
                       "lotion", "razor", "floss", "mouthwash", "sunscreen", "body wash",
                       "tissue", "tissues", "chapstick", "contact", "cotton"],
    "Household": ["battery", "batteries", "light bulb", "trash bag", "garbage bag", "aluminum foil",
                   "plastic wrap", "ziplock", "ziploc", "paper towel", "napkin", "candle",
                   "toilet paper", "paper plate", "cup", "straw"],
    "Cleaning": ["cleaner", "wipes", "sponge", "dish soap", "detergent", "bleach", "lysol",
                  "disinfectant", "broom", "mop", "duster", "dryer sheet", "fabric softener"],
    "Pets": ["cat food", "dog food", "cat litter", "kitty litter", "pet food", "treats",
             "flea", "heartworm", "pet"],
}


def _infer_group(name: str) -> str:
    """Infer shopping group from item name using keyword matching.

    Longer keywords are checked first so "tortilla chips" matches Snacks
    (via "chips") rather than Bread & Bakery (via "tortilla").
    """
    name_lower = name.lower()
    # Build flat list of (keyword, group) sorted longest-first
    pairs = []
    for group, keywords in _GROUP_KEYWORDS.items():
        for kw in keywords:
            pairs.append((kw, group))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)

    for kw, group in pairs:
        if kw in name_lower:
            return group
    return "Other"
