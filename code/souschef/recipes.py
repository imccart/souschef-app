"""Recipe CRUD and filtering."""

from __future__ import annotations

from sqlalchemy import text

from souschef.database import DictConnection
from souschef.models import Recipe, RecipeIngredient


def list_recipes(
    conn: DictConnection,
    cuisine: str | None = None,
    effort: str | None = None,
    outdoor: bool | None = None,
    kid_friendly: bool | None = None,
    user_id: str | None = None,
) -> list[Recipe]:
    query = "SELECT * FROM recipes WHERE 1=1"
    params: dict = {}

    if user_id:
        query += " AND user_id = :user_id"
        params["user_id"] = user_id

    if cuisine:
        query += " AND cuisine = :cuisine"
        params["cuisine"] = cuisine
    if effort:
        query += " AND effort = :effort"
        params["effort"] = effort
    if outdoor is not None:
        query += " AND outdoor = :outdoor"
        params["outdoor"] = int(outdoor)
    if kid_friendly is not None:
        query += " AND kid_friendly = :kid_friendly"
        params["kid_friendly"] = int(kid_friendly)

    query += " ORDER BY name"
    rows = conn.execute(text(query), params).fetchall()
    return [_row_to_recipe(r) for r in rows]


def get_recipe(conn: DictConnection, recipe_id: int) -> Recipe | None:
    row = conn.execute(
        text("SELECT * FROM recipes WHERE id = :id"), {"id": recipe_id}
    ).fetchone()
    if row is None:
        return None
    recipe = _row_to_recipe(row)
    recipe.ingredients = get_recipe_ingredients(conn, recipe_id)
    return recipe


def get_recipe_by_name(conn: DictConnection, name: str, user_id: str | None = None) -> Recipe | None:
    if user_id:
        row = conn.execute(
            text("SELECT * FROM recipes WHERE name = :name AND user_id = :user_id"),
            {"name": name, "user_id": user_id},
        ).fetchone()
    else:
        row = conn.execute(
            text("SELECT * FROM recipes WHERE name = :name"), {"name": name}
        ).fetchone()
    if row is None:
        return None
    recipe = _row_to_recipe(row)
    recipe.ingredients = get_recipe_ingredients(conn, recipe.id)
    return recipe


def get_recipe_ingredients(
    conn: DictConnection, recipe_id: int
) -> list[RecipeIngredient]:
    rows = conn.execute(
        text("""SELECT ri.*, i.name AS ingredient_name
           FROM recipe_ingredients ri
           JOIN ingredients i ON i.id = ri.ingredient_id
           WHERE ri.recipe_id = :recipe_id
           ORDER BY ri.component, i.name"""),
        {"recipe_id": recipe_id},
    ).fetchall()
    return [
        RecipeIngredient(
            id=r["id"],
            recipe_id=r["recipe_id"],
            ingredient_id=r["ingredient_id"],
            quantity=r["quantity"],
            unit=r["unit"],
            prep_note=r["prep_note"],
            component=r["component"],
            ingredient_name=r["ingredient_name"],
        )
        for r in rows
    ]


def filter_recipes(
    conn: DictConnection,
    cuisine: str | None = None,
    effort: str | None = None,
    outdoor: bool | None = None,
    kid_friendly: bool | None = None,
    exclude_ids: set[int] | None = None,
    exclude_cuisines: set[str] | None = None,
    user_id: str | None = None,
) -> list[Recipe]:
    recipes = list_recipes(conn, cuisine, effort, outdoor, kid_friendly, user_id=user_id)
    if exclude_ids:
        recipes = [r for r in recipes if r.id not in exclude_ids]
    if exclude_cuisines:
        recipes = [r for r in recipes if r.cuisine not in exclude_cuisines]
    return recipes


def _row_to_recipe(row) -> Recipe:
    return Recipe(
        id=row["id"],
        name=row["name"],
        cuisine=row["cuisine"],
        effort=row["effort"],
        cleanup=row["cleanup"],
        outdoor=bool(row["outdoor"]),
        kid_friendly=bool(row["kid_friendly"]),
        premade=bool(row["premade"]),
        prep_minutes=row["prep_minutes"],
        cook_minutes=row["cook_minutes"],
        servings=row["servings"],
        notes=row["notes"],
    )
