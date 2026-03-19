"""Company violation data from public government APIs.

Currently supports FDA openFDA food enforcement (recalls).
Data is cached in the company_violations table and refreshed on demand.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.parse
from sqlalchemy import text


FDA_BASE = "https://api.fda.gov/food/enforcement.json"


def _fda_query(company: str, limit: int = 100, skip: int = 0) -> dict | None:
    """Query FDA openFDA food enforcement by recalling_firm."""
    search = f'recalling_firm:"{company}"'
    params = urllib.parse.urlencode({"search": search, "limit": limit, "skip": skip})
    url = f"{FDA_BASE}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Souschef/1.0"})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except Exception:
        return None


def fetch_fda_for_company(company: str) -> dict:
    """Fetch FDA food enforcement summary for a company.

    Returns dict with total_records, class_i, class_ii, class_iii, most_recent_date.
    """
    data = _fda_query(company, limit=100)
    if not data or "results" not in data:
        return {"total_records": 0, "class_i": 0, "class_ii": 0, "class_iii": 0, "most_recent_date": None}

    total = data.get("meta", {}).get("results", {}).get("total", 0)
    results = data["results"]

    class_i = sum(1 for r in results if r.get("classification") == "Class I")
    class_ii = sum(1 for r in results if r.get("classification") == "Class II")
    class_iii = sum(1 for r in results if r.get("classification") == "Class III")

    # Get most recent date from the first page
    dates = [r.get("recall_initiation_date", "") for r in results if r.get("recall_initiation_date")]
    most_recent = max(dates) if dates else None

    # If there are more than 100 results, the class breakdown is approximate
    # (based on first 100 only). Total is exact from meta.
    return {
        "total_records": total,
        "class_i": class_i,
        "class_ii": class_ii,
        "class_iii": class_iii,
        "most_recent_date": most_recent,
    }


def refresh_fda_data(conn) -> dict:
    """Refresh FDA violation data for all parent companies in brand_ownership.

    Returns summary of what was updated.
    """
    # Get distinct parent companies
    rows = conn.execute(text(
        "SELECT DISTINCT parent_company FROM brand_ownership WHERE parent_company IS NOT NULL"
    )).fetchall()

    # Also include self-owned brands (they ARE the parent)
    self_rows = conn.execute(text(
        "SELECT DISTINCT brand FROM brand_ownership WHERE parent_company IS NULL"
    )).fetchall()

    companies = set()
    for r in rows:
        companies.add(r["parent_company"])
    for r in self_rows:
        companies.add(r["brand"])

    updated = 0
    errors = 0
    for company in sorted(companies):
        try:
            result = fetch_fda_for_company(company)
            conn.execute(text("""
                INSERT INTO company_violations (parent_company, agency, total_records, class_i, class_ii, class_iii, most_recent_date, refreshed_at)
                VALUES (:company, 'FDA', :total, :c1, :c2, :c3, :date, CURRENT_TIMESTAMP)
                ON CONFLICT (parent_company, agency) DO UPDATE SET
                    total_records = :total, class_i = :c1, class_ii = :c2, class_iii = :c3,
                    most_recent_date = :date, refreshed_at = CURRENT_TIMESTAMP
            """), {
                "company": company,
                "total": result["total_records"],
                "c1": result["class_i"],
                "c2": result["class_ii"],
                "c3": result["class_iii"],
                "date": result["most_recent_date"],
            })
            conn.commit()
            updated += 1
        except Exception as e:
            errors += 1
            try:
                conn.raw.rollback()
            except Exception:
                pass

    return {"updated": updated, "errors": errors, "companies": len(companies)}


def get_company_violations(conn, parent_company: str) -> dict | None:
    """Get cached violation data for a parent company."""
    row = conn.execute(text(
        "SELECT total_records, class_i, class_ii, class_iii, most_recent_date, refreshed_at FROM company_violations WHERE parent_company = :co AND agency = 'FDA'"
    ), {"co": parent_company}).fetchone()
    if not row:
        return None
    return {
        "fda_total_recalls": row["total_records"],
        "fda_class_i": row["class_i"],
        "fda_class_ii": row["class_ii"],
        "fda_class_iii": row["class_iii"],
        "fda_most_recent": row["most_recent_date"],
    }
