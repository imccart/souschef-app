"""Brand ownership lookup — queries the brand_ownership DB table.

Maps consumer brands to their parent companies. The curated mapping is seeded
from data/brand_ownership.yaml on startup and stored in the brand_ownership table.
Any integration (Kroger, Instacart, etc.) passes a brand string through
get_parent_company() to get ownership info.
"""

from __future__ import annotations

from sqlalchemy import text


def get_parent_company(brand: str, conn=None) -> str:
    """Look up the parent company for a brand.

    Returns:
        - "General Mills" etc. — known parent
        - "Same as brand" — brand is the company itself
        - "We're not sure" — not in our mapping
    """
    if not brand:
        return "We're not sure"

    if conn is None:
        from souschef.database import get_connection
        conn = get_connection()

    query = brand.strip()

    # Exact match (case-insensitive)
    row = conn.execute(
        text("SELECT parent_company FROM brand_ownership WHERE LOWER(brand) = LOWER(:q) LIMIT 1"),
        {"q": query},
    ).fetchone()
    if row:
        return row["parent_company"] if row["parent_company"] else "Same as brand"

    # Substring: check if any mapped brand is contained in the query
    # e.g., "Annie's Homegrown Organic" matches "annie's"
    row = conn.execute(
        text("SELECT parent_company FROM brand_ownership WHERE LOWER(:q) LIKE '%%' || LOWER(brand) || '%%' LIMIT 1"),
        {"q": query},
    ).fetchone()
    if row:
        return row["parent_company"] if row["parent_company"] else "Same as brand"

    # Reverse substring: query contained in a mapped brand
    row = conn.execute(
        text("SELECT parent_company FROM brand_ownership WHERE LOWER(brand) LIKE '%%' || LOWER(:q) || '%%' LIMIT 1"),
        {"q": query},
    ).fetchone()
    if row:
        return row["parent_company"] if row["parent_company"] else "Same as brand"

    return "We're not sure"
