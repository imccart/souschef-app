"""Pantry inventory CRUD."""

from __future__ import annotations

from sqlalchemy import text

from souschef.database import DictConnection
from souschef.models import PantryItem


def list_pantry(conn: DictConnection, user_id: str) -> list[PantryItem]:
    rows = conn.execute(
        text("""SELECT p.*, i.name AS ingredient_name
           FROM pantry p
           JOIN ingredients i ON i.id = p.ingredient_id
           WHERE p.user_id = :user_id
           ORDER BY i.name"""),
        {"user_id": user_id},
    ).fetchall()
    return [
        PantryItem(
            id=r["id"],
            ingredient_id=r["ingredient_id"],
            quantity=r["quantity"],
            unit=r["unit"],
            updated_at=r["updated_at"],
            ingredient_name=r["ingredient_name"],
        )
        for r in rows
    ]


def add_pantry_item(
    conn: DictConnection, user_id: str, ingredient_name: str, quantity: float, unit: str
) -> PantryItem | None:
    ingredient_name = ingredient_name.strip().lower()
    ing = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = :name"), {"name": ingredient_name}
    ).fetchone()
    if ing is None:
        return None

    existing = conn.execute(
        text("SELECT id FROM pantry WHERE user_id = :user_id AND ingredient_id = :ingredient_id"),
        {"user_id": user_id, "ingredient_id": ing["id"]},
    ).fetchone()

    if existing:
        conn.execute(
            text("""UPDATE pantry SET quantity = quantity + :quantity, updated_at = CURRENT_TIMESTAMP
               WHERE id = :id"""),
            {"quantity": quantity, "id": existing["id"]},
        )
    else:
        conn.execute(
            text("""INSERT INTO pantry (user_id, ingredient_id, quantity, unit)
               VALUES (:user_id, :ingredient_id, :quantity, :unit)"""),
            {"user_id": user_id, "ingredient_id": ing["id"], "quantity": quantity, "unit": unit},
        )
    conn.commit()

    row = conn.execute(
        text("""SELECT p.*, i.name AS ingredient_name
           FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id
           WHERE p.user_id = :user_id AND p.ingredient_id = :ingredient_id"""),
        {"user_id": user_id, "ingredient_id": ing["id"]},
    ).fetchone()

    return PantryItem(
        id=row["id"],
        ingredient_id=row["ingredient_id"],
        quantity=row["quantity"],
        unit=row["unit"],
        updated_at=row["updated_at"],
        ingredient_name=row["ingredient_name"],
    )


def set_pantry_item(
    conn: DictConnection, user_id: str, ingredient_name: str, quantity: float, unit: str
) -> PantryItem | None:
    ingredient_name = ingredient_name.strip().lower()
    ing = conn.execute(
        text("SELECT id FROM ingredients WHERE LOWER(name) = :name"), {"name": ingredient_name}
    ).fetchone()
    if ing is None:
        return None

    if quantity <= 0:
        conn.execute(
            text("DELETE FROM pantry WHERE user_id = :user_id AND ingredient_id = :ingredient_id"),
            {"user_id": user_id, "ingredient_id": ing["id"]},
        )
        conn.commit()
        return PantryItem(id=None, ingredient_id=ing["id"], quantity=0, unit=unit,
                          ingredient_name=ingredient_name)

    existing = conn.execute(
        text("SELECT id FROM pantry WHERE user_id = :user_id AND ingredient_id = :ingredient_id"),
        {"user_id": user_id, "ingredient_id": ing["id"]},
    ).fetchone()

    if existing:
        conn.execute(
            text("""UPDATE pantry SET quantity = :quantity, updated_at = CURRENT_TIMESTAMP
               WHERE id = :id"""),
            {"quantity": quantity, "id": existing["id"]},
        )
    else:
        conn.execute(
            text("""INSERT INTO pantry (user_id, ingredient_id, quantity, unit)
               VALUES (:user_id, :ingredient_id, :quantity, :unit)"""),
            {"user_id": user_id, "ingredient_id": ing["id"], "quantity": quantity, "unit": unit},
        )
    conn.commit()

    row = conn.execute(
        text("""SELECT p.*, i.name AS ingredient_name
           FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id
           WHERE p.user_id = :user_id AND p.ingredient_id = :ingredient_id"""),
        {"user_id": user_id, "ingredient_id": ing["id"]},
    ).fetchone()

    return PantryItem(
        id=row["id"],
        ingredient_id=row["ingredient_id"],
        quantity=row["quantity"],
        unit=row["unit"],
        updated_at=row["updated_at"],
        ingredient_name=row["ingredient_name"],
    )


def clear_pantry(conn: DictConnection, user_id: str) -> int:
    cursor = conn.execute(
        text("DELETE FROM pantry WHERE user_id = :user_id"),
        {"user_id": user_id},
    )
    conn.commit()
    return cursor.rowcount


def get_pantry_quantity(conn: DictConnection, user_id: str, ingredient_id: int) -> float:
    row = conn.execute(
        text("SELECT quantity FROM pantry WHERE user_id = :user_id AND ingredient_id = :ingredient_id"),
        {"user_id": user_id, "ingredient_id": ingredient_id},
    ).fetchone()
    return row["quantity"] if row else 0.0
