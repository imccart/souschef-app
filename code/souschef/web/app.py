"""FastAPI application for souschef web frontend."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text

from souschef.db import ensure_db
from souschef.web.api import router as api_router

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"

import os

_CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173"
).split(",")

app = FastAPI(title="Souschef")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

# Serve React static assets if the build exists
if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="react-assets")


def get_conn():
    """Get a database connection."""
    return ensure_db()


def _get_rolling(conn):
    """Get the rolling MealWeek and workflow status."""
    from souschef import workflow
    mw = workflow.get_rolling_meals(conn)
    status = workflow.get_workflow_status(conn)
    return mw, status


def _date_label(start: str, end: str) -> str:
    """Format a date range for display, e.g. 'Mar 10 - Mar 16'."""
    from datetime import date
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    if s.month == e.month:
        return f"{s.strftime('%b %d')} - {e.strftime('%d')}"
    return f"{s.strftime('%b %d')} - {e.strftime('%b %d')}"


# ── Health Check ──────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check for Railway / load balancers."""
    try:
        conn = get_conn()
        conn.execute(text("SELECT 1"))
        conn.close()
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ── Routes ────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Landing page — redirect to React app."""
    return RedirectResponse(url="/app", status_code=302)


@app.get("/plan", response_class=HTMLResponse)
async def plan_page(request: Request):
    """Meal plan view — rolling 7-day window."""
    conn = get_conn()
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("plan.html", {
        "request": request,
        "week": mw,
        "status": status,
        "date_label": _date_label(mw.start_date, mw.end_date),
        "active": "plan",
    })


@app.post("/plan/swap/{date}", response_class=HTMLResponse)
async def swap_meal_route(request: Request, date: str):
    """Swap a day's meal. Returns updated plan section."""
    from souschef.planner import swap_meal

    conn = get_conn()
    swap_meal(conn, date)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.post("/plan/swap-side/{date}", response_class=HTMLResponse)
async def swap_side_route(request: Request, date: str):
    """Swap a day's side dish. Returns updated plan section."""
    from souschef.planner import swap_meal_side

    conn = get_conn()
    swap_meal_side(conn, date)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.post("/plan/suggest", response_class=HTMLResponse)
async def suggest_meals_route(request: Request):
    """Fill empty days with suggested meals. Returns updated plan section."""
    from souschef.planner import fill_dates

    conn = get_conn()
    mw, _ = _get_rolling(conn)
    fill_dates(conn, mw.start_date, mw.end_date)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.post("/plan/toggle-grocery/{date}", response_class=HTMLResponse)
async def toggle_grocery_route(request: Request, date: str):
    """Toggle a meal's on_grocery flag. Returns updated plan section."""
    from souschef.planner import toggle_grocery

    conn = get_conn()
    toggle_grocery(conn, date)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.post("/plan/all-to-grocery", response_class=HTMLResponse)
async def all_to_grocery_route(request: Request):
    """Send all meals in the rolling window to the grocery list."""
    from souschef.planner import set_all_grocery

    conn = get_conn()
    mw, _ = _get_rolling(conn)
    if mw.meals:
        set_all_grocery(conn, mw.start_date, mw.end_date, on=True)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.post("/plan/swap-days", response_class=HTMLResponse)
async def swap_days_route(request: Request):
    """Swap meals between two days. Expects form data: date_a, date_b."""
    from souschef.planner import swap_dates

    form = await request.form()
    date_a = str(form["date_a"])
    date_b = str(form["date_b"])

    conn = get_conn()
    swap_dates(conn, date_a, date_b)
    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.get("/plan/candidates/{date}", response_class=HTMLResponse)
async def candidates_route(request: Request, date: str):
    """Get replacement candidates for a day. Returns a partial with options."""
    from souschef.planner import DAY_NAMES, get_candidates
    from souschef.recipes import list_recipes

    conn = get_conn()
    candidates = get_candidates(conn, date)
    all_recipes = list_recipes(conn)

    from datetime import date as dt_date
    d = dt_date.fromisoformat(date)
    day_name = DAY_NAMES[d.weekday()]

    return templates.TemplateResponse("partials/candidates.html", {
        "request": request,
        "date": date,
        "day_name": day_name,
        "candidates": candidates,
        "all_recipes": all_recipes,
    })


@app.post("/plan/set/{date}", response_class=HTMLResponse)
async def set_meal_route(request: Request, date: str):
    """Set a specific recipe for a day. Expects form data: recipe_id."""
    from souschef.planner import set_meal
    from souschef.recipes import get_recipe

    form = await request.form()
    recipe_id = int(form["recipe_id"])

    conn = get_conn()
    recipe = get_recipe(conn, recipe_id)
    if recipe:
        set_meal(conn, date, recipe.name)

    mw, status = _get_rolling(conn)

    return templates.TemplateResponse("partials/plan_section.html", {
        "request": request,
        "week": mw,
        "status": status,
    })


@app.get("/grocery", response_class=HTMLResponse)
async def grocery_page(request: Request):
    """Grocery list view — rolling 7-day window, always rebuilt from current meals."""
    from souschef import workflow
    from souschef.grocery import build_grocery_list
    from souschef.regulars import list_regulars
    from souschef.sheets import _GROUP_ORDER

    conn = get_conn()
    mw = workflow.get_rolling_meals(conn)
    items_by_group = {}
    reconciled_names = set()

    # Only include meals that are flagged for grocery
    grocery_meals = [m for m in mw.meals if m.on_grocery]

    if grocery_meals:
        gl = build_grocery_list(conn, grocery_meals, mw.start_date, mw.end_date)

        dk = workflow._date_key(mw.start_date, mw.end_date)
        sel = workflow.load_grocery_selections(date_key=dk)

        if sel:
            all_regulars = list_regulars(conn)
            regular_map = {r.name.lower(): r for r in all_regulars}
            regulars = [regular_map[n.lower()] for n in sel.regulars if n.lower() in regular_map]
            extras = sel.extras
        else:
            regulars = list_regulars(conn)
            extras = []

        items_by_group = _build_grouped_items(conn, gl, regulars, extras)

        reconciled = workflow.load_reconcile_result()
        if reconciled:
            reconciled_names = {n.lower() for n in reconciled}

    return templates.TemplateResponse("grocery.html", {
        "request": request,
        "week": mw,
        "items_by_group": items_by_group,
        "group_order": _GROUP_ORDER,
        "reconciled": reconciled_names,
        "date_label": _date_label(mw.start_date, mw.end_date),
        "active": "grocery",
    })


@app.post("/grocery/add", response_class=HTMLResponse)
async def add_grocery_item(request: Request):
    """Add a free-form item to the grocery list. Saves as an extra."""
    from souschef import workflow
    from souschef.grocery import build_grocery_list
    from souschef.regulars import list_regulars
    from souschef.sheets import _GROUP_ORDER

    form = await request.form()
    item_name = str(form["item_name"]).strip()

    conn = get_conn()
    mw = workflow.get_rolling_meals(conn)

    if item_name and mw.start_date:
        dk = workflow._date_key(mw.start_date, mw.end_date)
        sel = workflow.load_grocery_selections(date_key=dk)

        if sel:
            if item_name.lower() not in {n.lower() for n in sel.extras}:
                sel.extras.append(item_name)
                workflow.save_grocery_selections(
                    regulars=sel.regulars,
                    extras=sel.extras, meal_items=sel.meal_items,
                    store_assignments=sel.stores, date_key=dk,
                )
        else:
            workflow.save_grocery_selections(
                regulars=[r.name for r in list_regulars(conn)],
                extras=[item_name], meal_items=[],
                store_assignments={}, date_key=dk,
            )

    # Rebuild and return full page
    items_by_group = {}
    reconciled_names = set()

    if mw.meals or mw.start_date:
        gl = build_grocery_list(conn, mw.meals, mw.start_date, mw.end_date) if mw.meals else None
        dk = workflow._date_key(mw.start_date, mw.end_date)
        sel = workflow.load_grocery_selections(date_key=dk)

        if sel:
            all_regulars = list_regulars(conn)
            regular_map = {r.name.lower(): r for r in all_regulars}
            regulars = [regular_map[n.lower()] for n in sel.regulars if n.lower() in regular_map]
            extras = sel.extras
        else:
            regulars = list_regulars(conn)
            extras = []

        if gl:
            items_by_group = _build_grouped_items(conn, gl, regulars, extras)
        else:
            items_by_group = _build_grouped_items_no_meals(conn, regulars, extras)

        reconciled = workflow.load_reconcile_result()
        if reconciled:
            reconciled_names = {n.lower() for n in reconciled}

    return templates.TemplateResponse("grocery.html", {
        "request": request,
        "week": mw,
        "items_by_group": items_by_group,
        "group_order": _GROUP_ORDER,
        "reconciled": reconciled_names,
        "date_label": _date_label(mw.start_date, mw.end_date),
        "active": "grocery",
    })


@app.post("/grocery/toggle/{item_name:path}", response_class=HTMLResponse)
async def toggle_grocery_item(request: Request, item_name: str):
    """Toggle an item's checked state. Returns the updated item row partial."""
    from souschef import workflow

    reconciled = workflow.load_reconcile_result() or []
    reconciled_set = {n.lower() for n in reconciled}

    if item_name.lower() in reconciled_set:
        reconciled_set.discard(item_name.lower())
        checked = False
    else:
        reconciled_set.add(item_name.lower())
        checked = True

    workflow.set_reconcile_result(list(reconciled_set))

    return templates.TemplateResponse("partials/grocery_item.html", {
        "request": request,
        "name": item_name,
        "for_text": "",
        "checked": checked,
    })


@app.get("/grocery/products/{item_name:path}", response_class=HTMLResponse)
async def product_history(request: Request, item_name: str):
    """Get product history for a grocery item. Returns expandable partial."""
    from souschef.kroger import get_product_history

    conn = get_conn()
    products = get_product_history(conn, item_name)

    return templates.TemplateResponse("partials/product_history.html", {
        "request": request,
        "item_name": item_name,
        "products": products,
    })


@app.post("/grocery/rate/{item_name:path}", response_class=HTMLResponse)
async def rate_product_route(request: Request, item_name: str):
    """Rate a product. Expects form data: upc, rating."""
    from souschef.kroger import get_product_history, rate_product

    form = await request.form()
    upc = form["upc"]
    rating = int(form["rating"])

    conn = get_conn()
    desc_row = conn.execute(
        text("SELECT product_description FROM product_preferences WHERE upc = :upc LIMIT 1"),
        {"upc": upc},
    ).fetchone()
    desc = desc_row["product_description"] if desc_row else ""
    rate_product(conn, upc, rating, product_description=desc)

    products = get_product_history(conn, item_name)
    return templates.TemplateResponse("partials/product_history.html", {
        "request": request,
        "item_name": item_name,
        "products": products,
    })


@app.get("/order", response_class=HTMLResponse)
async def order_page(request: Request):
    """Order page (placeholder)."""
    from souschef import workflow

    conn = get_conn()
    mw = workflow.get_rolling_meals(conn)

    return templates.TemplateResponse("order.html", {
        "request": request,
        "week": mw,
        "date_label": _date_label(mw.start_date, mw.end_date),
        "active": "order",
    })


@app.get("/reconcile", response_class=HTMLResponse)
async def reconcile_page(request: Request):
    """Receipt reconcile page (placeholder)."""
    from souschef import workflow

    conn = get_conn()
    mw = workflow.get_rolling_meals(conn)

    return templates.TemplateResponse("reconcile.html", {
        "request": request,
        "week": mw,
        "date_label": _date_label(mw.start_date, mw.end_date),
        "active": "reconcile",
    })


# ── Helpers ───────────────────────────────────────────────

def _build_grouped_items(conn, gl, regulars, extras):
    """Build {group: [(name, for_text, meal_count), ...]} dict for template rendering."""
    seen: set[str] = set()
    groups: dict[str, list[tuple[str, str, int]]] = {}

    for r in regulars:
        seen.add(r.name.lower())
        groups.setdefault(r.shopping_group, []).append((r.name, "", 0))

    from souschef.grocery import split_by_store
    by_store = split_by_store(gl)
    for items in by_store.values():
        for item in items:
            if item.ingredient_name.lower() not in seen:
                seen.add(item.ingredient_name.lower())
                meal_text = ", ".join(item.meals) if item.meals else ""
                meal_count = len(item.meals) if item.meals else 0
                group = item.aisle or "Other"
                groups.setdefault(group, []).append((item.ingredient_name, meal_text, meal_count))

    for name in extras:
        if name.lower() not in seen:
            seen.add(name.lower())
            groups.setdefault("Other", []).append((name, "", 0))

    for g in groups:
        groups[g].sort()

    return groups


def _build_grouped_items_no_meals(conn, regulars, extras):
    """Build grouped items when there are no meals (just regulars/extras)."""
    seen: set[str] = set()
    groups: dict[str, list[tuple[str, str, int]]] = {}

    for r in regulars:
        seen.add(r.name.lower())
        groups.setdefault(r.shopping_group, []).append((r.name, "", 0))

    for name in extras:
        if name.lower() not in seen:
            seen.add(name.lower())
            groups.setdefault("Other", []).append((name, "", 0))

    for g in groups:
        groups[g].sort()

    return groups


# ── React SPA catch-all (must be last) ───────────────────

@app.get("/app/{rest:path}")
@app.get("/app")
async def react_spa(request: Request, rest: str = ""):
    """Serve the React SPA for any /app route."""
    index = _FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return HTMLResponse("<h1>Frontend not built</h1><p>Run npm run build in frontend/</p>", status_code=404)
