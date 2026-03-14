"""Dataclasses for the souschef domain."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class Ingredient:
    id: int | None
    name: str
    category: str  # protein, produce, dairy, pantry, frozen, grain, condiment
    aisle: str
    default_unit: str  # lb, oz, count, cup, tsp, tbsp
    store_pref: str  # sams, kroger, either
    is_pantry_staple: bool = False


@dataclass
class Recipe:
    id: int | None
    name: str
    cuisine: str  # mexican, italian, american, comfort, asian, any
    effort: str  # easy, medium, hard
    cleanup: str  # easy, medium, hard
    outdoor: bool = False
    kid_friendly: bool = True
    premade: bool = False
    prep_minutes: int = 0
    cook_minutes: int = 0
    servings: int = 4
    notes: str = ""
    recipe_type: str = "meal"
    ingredients: list[RecipeIngredient] = field(default_factory=list)


@dataclass
class RecipeIngredient:
    id: int | None
    recipe_id: int
    ingredient_id: int
    quantity: float
    unit: str
    prep_note: str = ""
    component: str = ""  # protein, base, sauce, side
    ingredient_name: str = ""  # populated on read


@dataclass
class PantryItem:
    id: int | None
    ingredient_id: int
    quantity: float
    unit: str
    updated_at: str = ""
    ingredient_name: str = ""  # populated on read


# ── New flat model ──────────────────────────────────────

@dataclass
class Meal:
    """A single meal on a single date — the atomic planning unit."""
    id: int | None
    slot_date: str  # ISO date (YYYY-MM-DD)
    recipe_id: int | None = None
    recipe_name: str = ""
    status: str = "suggested"  # legacy, kept for compat
    side: str = ""
    locked: bool = False
    is_followup: bool = False
    on_grocery: bool = False  # True = ingredients on grocery list
    side_recipe_id: int | None = None
    created_at: str = ""

    @property
    def weekday(self) -> int:
        """0=Monday .. 6=Sunday, derived from slot_date."""
        return date.fromisoformat(self.slot_date).weekday()

    @property
    def day_name(self) -> str:
        return date.fromisoformat(self.slot_date).strftime("%A")

    @property
    def day_short(self) -> str:
        return date.fromisoformat(self.slot_date).strftime("%a")


@dataclass
class MealWeek:
    """View of meals across a date range (not stored in DB)."""
    start_date: str
    end_date: str
    meals: list[Meal] = field(default_factory=list)

    @property
    def all_on_grocery(self) -> bool:
        """True if all meals in this range are on the grocery list."""
        return bool(self.meals) and all(m.on_grocery for m in self.meals)

    @property
    def all_days(self) -> list[dict]:
        """Return all days in the range with their meal (or None)."""
        from datetime import timedelta
        meal_map = {m.slot_date: m for m in self.meals}
        days = []
        d = date.fromisoformat(self.start_date)
        end = date.fromisoformat(self.end_date)
        while d <= end:
            iso = d.isoformat()
            days.append({
                "date": iso,
                "day_short": d.strftime("%a"),
                "meal": meal_map.get(iso),
            })
            d += timedelta(days=1)
        return days

    @property
    def has_empty_days(self) -> bool:
        filled = {m.slot_date for m in self.meals}
        from datetime import timedelta
        d = date.fromisoformat(self.start_date)
        end = date.fromisoformat(self.end_date)
        while d <= end:
            if d.isoformat() not in filled:
                return True
            d += timedelta(days=1)
        return False



# ── Grocery models ──────────────────────────────────────

@dataclass
class GroceryList:
    id: int | None
    plan_id: int = 0  # legacy, kept for compat
    start_date: str = ""
    end_date: str = ""
    created_at: str = ""
    items: list[GroceryListItem] = field(default_factory=list)
    staples_used: list[str] = field(default_factory=list)


@dataclass
class GroceryListItem:
    id: int | None
    list_id: int
    ingredient_id: int
    total_quantity: float
    unit: str
    store: str  # sams, kroger
    aisle: str = ""
    from_pantry: float = 0.0
    checked: bool = False
    ingredient_name: str = ""  # populated on read
    category: str = ""
    meals: list[str] = field(default_factory=list)  # which recipes use this


