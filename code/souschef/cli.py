"""Click CLI entry point for souschef."""

from __future__ import annotations

from pathlib import Path

import click

from souschef.db import ensure_db
from souschef.display import (
    console,
    show_bulk_tips,
    show_meals,
    show_pantry,
    show_recipe,
    show_recipe_list,
)
from souschef.grocery import build_grocery_list, split_by_store
from souschef.pantry import add_pantry_item, clear_pantry, list_pantry, set_pantry_item
from souschef.planner import (
    DAY_NAMES,
    accept_meals,
    detect_bulk_components,
    fill_dates,
    get_candidates,
    load_meal_week,
    save_meals,
    set_meal,
    swap_meal,
    swap_meal_side,
    week_range,
)
from souschef.recipes import get_recipe, list_recipes
from souschef import workflow


@click.group()
@click.pass_context
def cli(ctx):
    """Souschef — meal plans, grocery lists, and pantry tracking."""
    ctx.ensure_object(dict)
    ctx.obj["conn"] = ensure_db()


# ── Recipes ──────────────────────────────────────────────


@cli.command("recipes")
@click.option("--cuisine", type=str, default=None, help="Filter by cuisine")
@click.option("--effort", type=click.Choice(["easy", "medium", "hard"]), default=None)
@click.pass_context
def recipes_cmd(ctx, cuisine, effort):
    """List all recipes, optionally filtered."""
    conn = ctx.obj["conn"]
    results = list_recipes(conn, cuisine=cuisine, effort=effort)
    show_recipe_list(results)


@cli.command("recipe")
@click.argument("recipe_id", type=int)
@click.pass_context
def recipe_cmd(ctx, recipe_id):
    """Show details for a single recipe."""
    conn = ctx.obj["conn"]
    recipe = get_recipe(conn, recipe_id)
    if recipe is None:
        console.print("[red]Recipe not found.[/red]")
        return
    show_recipe(recipe)


# ── Meal Plan ────────────────────────────────────────────


@cli.command("plan")
@click.option("--week", type=str, default=None, help="Week start date (YYYY-MM-DD)")
@click.pass_context
def plan_cmd(ctx, week):
    """Generate a new meal plan for the week."""
    conn = ctx.obj["conn"]
    start, end = week_range(week)
    meals = fill_dates(conn, start, end)
    show_meals(meals, start)

    tips = detect_bulk_components(conn, meals)
    show_bulk_tips(tips)

    console.print("\n[dim]Use 'souschef swap <day>' to change a day, or 'souschef accept' to finalize.[/dim]")


@cli.command("swap")
@click.argument("day", type=str)
@click.argument("what", type=click.Choice(["meal", "side"]), default="meal")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def swap_cmd(ctx, day, what, week):
    """Swap a day's meal or side. Example: swap monday meal, swap monday side."""
    conn = ctx.obj["conn"]

    slot_date = _resolve_day_to_date(day, week)
    if slot_date is None:
        console.print(f"[red]Invalid day: {day}. Use a day name or 0-6.[/red]")
        return

    if what == "side":
        swap_meal_side(conn, slot_date)
    else:
        swap_meal(conn, slot_date)

    mw = load_meal_week(conn, week)
    show_meals(mw.meals, mw.start_date)

    tips = detect_bulk_components(conn, mw.meals)
    show_bulk_tips(tips)


@cli.command("options")
@click.argument("day", type=str)
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def options_cmd(ctx, day, week):
    """Show valid recipe candidates for a day based on current rules."""
    conn = ctx.obj["conn"]

    slot_date = _resolve_day_to_date(day, week)
    if slot_date is None:
        console.print(f"[red]Invalid day: {day}. Use a day name or 0-6.[/red]")
        return

    from datetime import date as dt_date
    d = dt_date.fromisoformat(slot_date)
    day_name = DAY_NAMES[d.weekday()]

    candidates = get_candidates(conn, slot_date)
    if not candidates:
        console.print(f"[yellow]No candidates for {day_name}.[/yellow]")
        return

    console.print(f"[bold]Options for {day_name}:[/bold]")
    show_recipe_list(candidates)


@cli.command("set")
@click.argument("day", type=str)
@click.argument("recipe", type=str)
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def set_cmd(ctx, day, recipe, week):
    """Manually set a day's meal. No rules enforced — pick whatever you want."""
    conn = ctx.obj["conn"]

    slot_date = _resolve_day_to_date(day, week)
    if slot_date is None:
        console.print(f"[red]Invalid day: {day}. Use a day name or 0-6.[/red]")
        return

    result = set_meal(conn, slot_date, recipe)
    if isinstance(result, str):
        console.print(f"[red]{result}[/red]")
        return

    mw = load_meal_week(conn, week)
    show_meals(mw.meals, mw.start_date)

    tips = detect_bulk_components(conn, mw.meals)
    show_bulk_tips(tips)


@cli.command("accept")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def accept_cmd(ctx, week):
    """Accept the current meal plan."""
    conn = ctx.obj["conn"]

    mw = _get_week_or_print(conn, week)
    if mw is None:
        return

    accept_meals(conn, mw.start_date, mw.end_date)
    console.print("[green]Plan accepted![/green]")
    show_meals(mw.meals, mw.start_date)


@cli.command("show")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def show_cmd(ctx, week):
    """Show the current meal plan."""
    conn = ctx.obj["conn"]
    mw = _get_week_or_print(conn, week)
    if mw is None:
        return
    show_meals(mw.meals, mw.start_date)

    tips = detect_bulk_components(conn, mw.meals)
    show_bulk_tips(tips)


# ── Grocery List ─────────────────────────────────────────


@cli.command("grocery")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def grocery_cmd(ctx, week):
    """Build the full grocery list (regulars, meal items, extras)."""
    conn = ctx.obj["conn"]

    mw = _get_week_or_print(conn, week)
    if mw is None:
        return

    # Clear old reconcile state — new grocery list means fresh start
    workflow.clear_reconcile_result()

    # Always prompt to build/rebuild the list
    gl, selected_regulars, extra_items = _prompt_full_grocery_list(conn, mw)

    _show_full_grocery_list(conn, mw, gl, selected_regulars, extra_items)


@cli.command("list")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.pass_context
def list_cmd(ctx, week):
    """Show the current grocery list (run 'grocery' first to build it)."""
    conn = ctx.obj["conn"]

    mw = _get_week_or_print(conn, week)
    if mw is None:
        return

    rebuilt = workflow.reconstruct_grocery_list(conn, mw.meals, mw.start_date, mw.end_date)
    if rebuilt is None:
        console.print("[red]No grocery list built. Run 'souschef grocery' first.[/red]")
        return

    _show_full_grocery_list(conn, mw, rebuilt["grocery_list"], rebuilt["regulars"], rebuilt["extras"])


@cli.command("export")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.option("--sheet-id", type=str, default=None, help="Existing Google Sheet ID to update")
@click.option("--new", "force_new", is_flag=True, help="Create a new sheet instead of updating")
@click.pass_context
def export_cmd(ctx, week, sheet_id, force_new):
    """Export grocery list to Google Sheets (overwrites existing by default)."""
    conn = ctx.obj["conn"]

    mw = _get_week_or_print(conn, week)
    if mw is None:
        return

    try:
        from souschef.sheets import export_grocery_list  # noqa: F401 — check import
    except ImportError:
        console.print(
            "[red]Google Sheets dependencies not installed.[/red]\n"
            "[dim]Run: pip install google-api-python-client google-auth-oauthlib[/dim]"
        )
        return

    reconciled = workflow.load_reconcile_result()
    if reconciled:
        console.print(f"[dim]{len(reconciled)} items checked off via receipt[/dim]")

    console.print("\n[dim]Exporting to Google Sheets...[/dim]")
    try:
        url = workflow.export_to_sheets(conn, start_date=mw.start_date, end_date=mw.end_date, sheet_id=sheet_id, force_new=force_new)
        if url:
            console.print(f"[green]Grocery list exported![/green]")
            console.print(f"[bold]{url}[/bold]")
        else:
            console.print("[red]No grocery list built. Run 'souschef grocery' first.[/red]")
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
    except Exception as e:
        console.print(f"[red]Export failed: {e}[/red]")


# ── Pantry ───────────────────────────────────────────────


@cli.group("pantry")
def pantry_group():
    """Manage pantry inventory."""
    pass


@pantry_group.command("list")
@click.pass_context
def pantry_list_cmd(ctx):
    """Show current pantry contents."""
    conn = ctx.obj["conn"]
    items = list_pantry(conn)
    show_pantry(items)


@pantry_group.command("add")
@click.argument("ingredient")
@click.argument("quantity", type=float)
@click.argument("unit")
@click.pass_context
def pantry_add_cmd(ctx, ingredient, quantity, unit):
    """Add an item to the pantry (adds to existing quantity)."""
    conn = ctx.obj["conn"]
    item = add_pantry_item(conn, ingredient, quantity, unit)
    if item is None:
        console.print(f"[red]Ingredient '{ingredient}' not found in database.[/red]")
        return
    console.print(f"[green]Pantry updated: {item.ingredient_name} = {item.quantity:g} {item.unit}[/green]")


@pantry_group.command("set")
@click.argument("ingredient")
@click.argument("quantity", type=float)
@click.argument("unit")
@click.pass_context
def pantry_set_cmd(ctx, ingredient, quantity, unit):
    """Set an item's pantry quantity (replaces existing)."""
    conn = ctx.obj["conn"]
    item = set_pantry_item(conn, ingredient, quantity, unit)
    if item is None:
        console.print(f"[red]Ingredient '{ingredient}' not found in database.[/red]")
        return
    if item.quantity <= 0:
        console.print(f"[yellow]Removed {ingredient} from pantry.[/yellow]")
    else:
        console.print(f"[green]Pantry set: {item.ingredient_name} = {item.quantity:g} {item.unit}[/green]")


@pantry_group.command("clear")
@click.confirmation_option(prompt="Clear entire pantry?")
@click.pass_context
def pantry_clear_cmd(ctx):
    """Clear the entire pantry."""
    conn = ctx.obj["conn"]
    count = clear_pantry(conn)
    console.print(f"[yellow]Removed {count} items from pantry.[/yellow]")


# ── Regulars ─────────────────────────────────────────────


@cli.group("regulars")
def regulars_group():
    """Manage recurring items (essentials + pantry staples)."""
    pass


@regulars_group.command("list")
@click.pass_context
def regulars_list_cmd(ctx):
    """Show active regulars."""
    from souschef.regulars import list_regulars

    conn = ctx.obj["conn"]
    items = list_regulars(conn)
    if not items:
        console.print("[dim]No regulars set. Use 'souschef regulars add' to add some.[/dim]")
        return

    from rich.table import Table

    table = Table(title="Regulars")
    table.add_column("Item", style="white")
    table.add_column("Section")
    table.add_column("Store", style="dim")
    for item in items:
        table.add_row(item.name, item.shopping_group, item.store_pref)
    console.print(table)


@regulars_group.command("add")
@click.argument("name")
@click.option("--group", type=str, default="", help="Shopping section (auto-inferred if omitted)")
@click.option("--store", type=str, default="either", help="Store preference")
@click.pass_context
def regulars_add_cmd(ctx, name, group, store):
    """Add a recurring item. Shopping group is auto-inferred from ingredients if possible."""
    from souschef.regulars import add_regular

    conn = ctx.obj["conn"]
    item = add_regular(conn, name, group, store)
    console.print(f"[green]Added: {item.name} ({item.shopping_group})[/green]")


@regulars_group.command("remove")
@click.argument("name")
@click.pass_context
def regulars_remove_cmd(ctx, name):
    """Remove a regular from the active list."""
    from souschef.regulars import remove_regular

    conn = ctx.obj["conn"]
    if remove_regular(conn, name):
        console.print(f"[yellow]Removed {name} from regulars.[/yellow]")
    else:
        console.print(f"[red]'{name}' not found in active regulars.[/red]")


# ── Stores ──────────────────────────────────────────────


@cli.group("stores")
def stores_group():
    """Manage your shopping stores."""
    pass


@stores_group.command("list")
def stores_list_cmd():
    """Show configured stores."""
    from souschef.stores import list_stores

    stores = list_stores()
    if not stores:
        console.print("[dim]No stores configured. Use 'souschef stores add' to set up.[/dim]")
        return

    from rich.table import Table

    table = Table(title="Stores")
    table.add_column("Key", style="bold")
    table.add_column("Name", style="white")
    table.add_column("Mode")
    table.add_column("API", style="dim")
    for s in stores:
        table.add_row(s["key"], s["name"], s["mode"], s["api"])
    console.print(table)


@stores_group.command("add")
@click.argument("name")
@click.argument("key")
@click.option("--mode", type=click.Choice(["pickup", "delivery", "in-person"]), default="in-person", help="Shopping mode")
@click.option("--api", type=click.Choice(["kroger", "none"]), default="none", help="API integration")
def stores_add_cmd(name, key, mode, api):
    """Add a store. KEY is the short letter for prompts (e.g. 'k' for Kroger)."""
    from souschef.stores import add_store

    try:
        store = add_store(name, key, mode, api)
        console.print(f"[green]Added: {store['name']} ({store['key']}) — {store['mode']}, API: {store['api']}[/green]")
    except ValueError as e:
        console.print(f"[red]{e}[/red]")


@stores_group.command("remove")
@click.argument("key")
def stores_remove_cmd(key):
    """Remove a store by its key."""
    from souschef.stores import remove_store

    name = remove_store(key)
    if name:
        console.print(f"[yellow]Removed {name}[/yellow]")
    else:
        console.print(f"[red]No store with key '{key}'[/red]")


# ── Whitelist ────────────────────────────────────────────


@cli.group("whitelist")
def whitelist_group():
    """Manage beta access emails."""
    pass


@whitelist_group.command("list")
def whitelist_list_cmd():
    """Show all allowed emails."""
    from souschef.database import get_connection
    from sqlalchemy import text

    conn = get_connection()
    rows = conn.execute(text("SELECT email FROM allowed_emails ORDER BY email")).fetchall()
    conn.close()

    if not rows:
        console.print("[dim]No emails on the whitelist.[/dim]")
        return

    for row in rows:
        console.print(f"  {row['email']}")
    console.print(f"\n[dim]{len(rows)} email(s)[/dim]")


@whitelist_group.command("add")
@click.argument("email")
def whitelist_add_cmd(email):
    """Add an email to the beta whitelist."""
    from souschef.database import get_connection
    from sqlalchemy import text

    email = email.strip().lower()
    conn = get_connection()
    conn.execute(
        text("INSERT INTO allowed_emails (email) VALUES (:email) ON CONFLICT DO NOTHING"),
        {"email": email},
    )
    conn.commit()
    conn.close()
    console.print(f"[green]Added {email}[/green]")


@whitelist_group.command("remove")
@click.argument("email")
def whitelist_remove_cmd(email):
    """Remove an email from the beta whitelist."""
    from souschef.database import get_connection
    from sqlalchemy import text

    email = email.strip().lower()
    conn = get_connection()
    result = conn.execute(
        text("DELETE FROM allowed_emails WHERE LOWER(email) = LOWER(:email)"),
        {"email": email},
    )
    conn.commit()
    conn.close()
    if result.rowcount > 0:
        console.print(f"[yellow]Removed {email}[/yellow]")
    else:
        console.print(f"[red]{email} not found[/red]")


@whitelist_group.command("waitlist")
def whitelist_waitlist_cmd():
    """Show emails that tried to sign up but weren't on the list."""
    from souschef.database import get_connection
    from sqlalchemy import text

    conn = get_connection()
    rows = conn.execute(text("SELECT email, requested_at FROM waitlist ORDER BY requested_at DESC")).fetchall()
    conn.close()

    if not rows:
        console.print("[dim]No waitlist requests yet.[/dim]")
        return

    for row in rows:
        console.print(f"  {row['email']}  [dim]{row['requested_at']}[/dim]")
    console.print(f"\n[dim]{len(rows)} request(s)[/dim]")


@whitelist_group.command("approve")
@click.argument("email")
def whitelist_approve_cmd(email):
    """Move an email from waitlist to allowed (approve access)."""
    from souschef.database import get_connection
    from sqlalchemy import text

    email = email.strip().lower()
    conn = get_connection()
    # Add to allowed
    conn.execute(
        text("INSERT INTO allowed_emails (email) VALUES (:email) ON CONFLICT DO NOTHING"),
        {"email": email},
    )
    # Remove from waitlist
    conn.execute(
        text("DELETE FROM waitlist WHERE LOWER(email) = LOWER(:email)"),
        {"email": email},
    )
    conn.commit()
    conn.close()
    console.print(f"[green]Approved {email}[/green]")


# ── Kroger ───────────────────────────────────────────────


@cli.group("kroger")
def kroger_group():
    """Kroger API: search products, find stores, look up grocery items."""
    pass


@kroger_group.command("stores")
@click.argument("zip_code")
def kroger_stores_cmd(zip_code):
    """Find Kroger stores near a zip code."""
    from souschef.kroger import search_locations

    try:
        stores = search_locations(zip_code)
    except Exception as e:
        console.print(f"[red]{e}[/red]")
        return

    if not stores:
        console.print("[yellow]No stores found.[/yellow]")
        return

    from rich.table import Table

    table = Table(title="Kroger Stores")
    table.add_column("ID", style="dim")
    table.add_column("Name", style="bold")
    table.add_column("Address")
    for s in stores:
        table.add_row(s["location_id"], s["name"], s["address"])
    console.print(table)
    console.print("\n[dim]Use 'souschef kroger set-store <ID>' to save your store.[/dim]")


@kroger_group.command("set-store")
@click.argument("location_id")
def kroger_set_store_cmd(location_id):
    """Save your preferred Kroger store."""
    from souschef.kroger import set_store

    set_store(location_id)
    console.print(f"[green]Kroger store set to {location_id}[/green]")


@kroger_group.command("search")
@click.argument("term")
@click.option("--limit", type=int, default=5, help="Max results")
def kroger_search_cmd(term, limit):
    """Search Kroger products by name."""
    from souschef.kroger import search_products

    try:
        products = search_products(term, limit=limit)
    except Exception as e:
        console.print(f"[red]{e}[/red]")
        return

    if not products:
        console.print("[yellow]No products found.[/yellow]")
        return

    from rich.table import Table

    table = Table(title=f"Kroger: {term}")
    table.add_column("Product", style="white", min_width=30)
    table.add_column("Brand", style="dim")
    table.add_column("Size")
    table.add_column("Price", justify="right")
    table.add_column("Pickup", justify="center")
    for p in products:
        if p.promo_price and p.price:
            price = f"${p.promo_price:.2f} (was ${p.price:.2f})"
        elif p.promo_price:
            price = f"${p.promo_price:.2f}"
        elif p.price:
            price = f"${p.price:.2f}"
        else:
            price = "—"
        pickup = "[green]Yes[/green]" if p.curbside else "[red]No[/red]"
        table.add_row(p.description, p.brand, p.size, price, pickup)
    console.print(table)


# ── Reconcile ────────────────────────────────────────────


@cli.command("reconcile")
@click.argument("source", required=False)
@click.option("--paste", is_flag=True, help="Paste receipt text from clipboard/stdin")
@click.pass_context
def reconcile_cmd(ctx, source, paste):
    """Check off grocery list items from a store receipt. Updates the Google Sheet.

    SOURCE can be a PDF, image (jpg/png), or email (.eml).
    Use --paste to paste receipt text directly.
    """
    conn = ctx.obj["conn"]

    # Parse receipt
    try:
        if paste:
            from souschef.reconcile import parse_receipt_text
            console.print("[dim]Paste receipt text, then press Ctrl+D (or Ctrl+Z on Windows):[/dim]")
            import sys
            text = sys.stdin.read()
            receipt_items = parse_receipt_text(text)
        elif source:
            receipt_items = workflow.parse_receipt(source)
        else:
            # Auto-detect most recent receipt PDF in Downloads
            downloads = Path.home() / "Downloads"
            candidates = sorted(
                downloads.glob("Receipt*.pdf"),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if candidates:
                source = str(candidates[0])
                console.print(f"[dim]Found: {candidates[0].name}[/dim]")
                receipt_items = workflow.parse_receipt(source)
            else:
                console.print("[red]No receipt file provided and none found in Downloads.[/red]")
                console.print("[dim]Usage: souschef reconcile <file> or souschef reconcile --paste[/dim]")
                return
    except ImportError:
        console.print(
            "[red]Reconcile dependencies not installed.[/red]\n"
            "[dim]Run: pip install -e \".[reconcile]\"[/dim]"
        )
        return
    except Exception as e:
        console.print(f"[red]Failed to parse receipt: {e}[/red]")
        return

    console.print(f"\n[bold]Receipt: {len(receipt_items)} items parsed[/bold]")

    # Reconcile against grocery list (handles matching, preferences, state)
    result = workflow.reconcile_receipt(conn, receipt_items)

    # Show matched items
    if result["matched"]:
        console.print(f"\n[green]Checked off ({len(result['matched'])}):[/green]")
        for m in result["matched"]:
            console.print(f"  [green]Y[/green] {m['grocery_name']} -> {m['receipt']['item']}")

    # Show unmatched receipt items (not on grocery list)
    if result["unmatched"]:
        console.print(f"\n[dim]Not on grocery list ({len(result['unmatched'])}):[/dim]")
        for u in result["unmatched"]:
            price = f" (${u.get('price', '?')})" if u.get("price") else ""
            console.print(f"  [dim]-[/dim] {u['item']}{price}")

    if result["preferences_saved"]:
        console.print(f"\n[dim]Preferences updated for {result['preferences_saved']} items.[/dim]")

    # Auto-update Google Sheet with strikethroughs
    console.print("\n[dim]Updating Google Sheet...[/dim]")
    try:
        url = workflow.export_to_sheets(conn)
        if url:
            console.print(f"[green]Grocery list updated![/green] {url}")
    except Exception as e:
        console.print(f"[yellow]Could not update sheet: {e}[/yellow]")

    console.print()


# ── Order ────────────────────────────────────────────────


@cli.command("order")
@click.option("--week", type=str, default=None, help="Week start date (default: current)")
@click.option("--submit", is_flag=True, help="Add saved order to Kroger cart")
@click.pass_context
def order_cmd(ctx, week, submit):
    """Pick Kroger products for your grocery list. Remembers your preferences."""
    conn = ctx.obj["conn"]

    if submit:
        from souschef.kroger import add_to_cart, load_order

        order = load_order()
        if not order:
            console.print("[red]No saved order. Run 'souschef order' first to pick products.[/red]")
            return

        console.print(f"[bold]Order review — {len(order)} items:[/bold]\n")
        for i, s in enumerate(order, 1):
            qty = s.get('qty', 1)
            qty_str = f" x{qty}" if qty > 1 else ""
            console.print(f"  {i}. {s['item']} → {s['product']}{qty_str}")

        # Prompt to add more items
        console.print()
        while True:
            extra = click.prompt(
                "Anything else to add? (type product name, or Enter to continue)",
                default="", show_default=False,
            ).strip()
            if not extra:
                break
            from souschef.kroger import search_products
            try:
                results = search_products(extra, limit=5)
            except Exception as e:
                console.print(f"  [red]Error: {e}[/red]")
                continue
            if not results:
                console.print(f"  [yellow]No results for '{extra}'[/yellow]")
                continue
            for j, p in enumerate(results, 1):
                price = f"${p.price:.2f}" if p.price else "—"
                console.print(f"  {j}. {p.description} ({p.size}) {price}")
            pick = click.prompt("  Pick #, or Enter to skip", default="", show_default=False).strip()
            if pick.isdigit() and 1 <= int(pick) <= len(results):
                picked = results[int(pick) - 1]
                qty = click.prompt("  Qty", default=1, type=int, show_default=True)
                order.append({"item": extra, "product": picked.description, "size": picked.size, "upc": picked.upc, "qty": qty})
                from souschef.kroger import save_order
                save_order(order)
                console.print(f"  [green]✓ {picked.description} x{qty}[/green]")

        if not click.confirm(f"\nSubmit {len(order)} items to Kroger cart?"):
            console.print("[dim]Cancelled.[/dim]")
            return

        try:
            add_to_cart(order)
            console.print(f"\n[bold green]Done! {len(order)} items added to your Kroger cart.[/bold green]")
            import webbrowser
            webbrowser.open("https://www.kroger.com/cart")
            console.print("[dim]Opened Kroger cart — schedule pickup and checkout.[/dim]")
        except Exception as e:
            console.print(f"\n[red]Failed to add to cart: {e}[/red]")
        return

    mw = _get_week_or_print(conn, week)
    if mw is None:
        return

    from souschef.kroger import (
        _lookup_food_score,
        fill_prices,
        get_preferred_products,
        load_order,
        save_order,
        save_preference,
        search_products_fast,
    )

    search_names = _get_full_search_list(conn, mw)

    if not search_names:
        console.print("[dim]No items to look up.[/dim]")
        return

    from rich.table import Table

    console.print(f"\n[bold]Looking up {len(search_names)} items at Kroger...[/bold]")
    console.print("[dim]Pick #, Enter for default (★), 's' skip, sort: 'p' price, 'n' NOVA, 'g' Nutri, '%' discount[/dim]\n")

    def _nova_dots(n):
        """NOVA 1=●○○○ (green), 4=●●●● (red)."""
        if n is None:
            return "—"
        colors = {1: "green", 2: "yellow", 3: "dark_orange", 4: "red"}
        c = colors.get(n, "white")
        filled = f"[{c}]" + "●" * n + f"[/{c}]"
        empty = "[dim]" + "○" * (4 - n) + "[/dim]"
        return filled + empty

    def _nutri_grade(g):
        """Nutri-Score A (green) to E (red)."""
        if not g:
            return "—"
        colors = {"a": "green", "b": "bright_green", "c": "yellow", "d": "dark_orange", "e": "red"}
        c = colors.get(g.lower(), "white")
        return f"[{c}]{g.upper()}[/{c}]"

    import re
    from concurrent.futures import ThreadPoolExecutor

    def _short_desc(desc, size):
        """Shorten Kroger's verbose product descriptions."""
        if not desc:
            return ""
        # Remove size/weight info (already in its own column)
        d = re.sub(r',?\s*\d+\.?\d*\s*(oz|fl oz|ct|lb|gal|pk|each)\b.*', '', desc, flags=re.IGNORECASE)
        # Remove trailing trademark/registered symbols
        d = d.replace('®', '').replace('™', '').replace('�', '')
        # Collapse whitespace
        d = ' '.join(d.split())
        # Cap at 50 chars
        if len(d) > 50:
            d = d[:47] + "..."
        return d.strip()

    def _parse_size(size_str):
        """Parse size string into (quantity, unit). Returns None if unparsable."""
        if not size_str:
            return None
        s = size_str.lower().strip()
        # "4 ct / 5 oz" or "4 pk / 5 oz" → per ct
        m = re.match(r'(\d+\.?\d*)\s*(?:ct|pk)\s*/', s)
        if m:
            return float(m.group(1)), "ct"
        # "12 ct" or "6 pk" (no weight) → per ct
        m = re.match(r'(\d+\.?\d*)\s*(?:ct|pk)\b', s)
        if m:
            return float(m.group(1)), "ct"
        # "12 fl oz" or "5 oz"
        m = re.match(r'(\d+\.?\d*)\s*(fl\s*oz|oz)\b', s)
        if m:
            return float(m.group(1)), "oz"
        # "1 lb" → 16 oz
        m = re.match(r'(\d+\.?\d*)\s*lb\b', s)
        if m:
            return float(m.group(1)) * 16, "oz"
        # "1 gal" → 128 oz
        m = re.match(r'(\d+\.?\d*)\s*gal\b', s)
        if m:
            return float(m.group(1)) * 128, "oz"
        return None

    def _unit_price(p):
        """Compute unit price string from effective price and size."""
        eff = p.promo_price or p.price
        if not eff:
            return ""
        parsed = _parse_size(p.size)
        if not parsed or parsed[0] <= 0:
            return ""
        qty, unit = parsed
        per_unit = eff / qty
        return f"[dim]${per_unit:.2f}/{unit}[/dim]"

    def _format_price(p):
        if p.promo_price and p.price:
            return f"[green]${p.promo_price:.2f}[/green] [dim][s]${p.price:.2f}[/s][/dim]"
        if p.promo_price:
            return f"[green]${p.promo_price:.2f}[/green]"
        if p.price:
            return f"${p.price:.2f}"
        return "—"

    def _sort_products(products, key):
        """Sort products in place. Returns sort label for display."""
        if key == "p":
            products.sort(key=lambda p: p.promo_price or p.price or 999)
            return "price"
        elif key == "n":
            products.sort(key=lambda p: p.nova_group if p.nova_group is not None else 99)
            return "NOVA"
        elif key == "g":
            products.sort(key=lambda p: p.nutriscore.lower() if p.nutriscore else "z")
            return "Nutri-Score"
        elif key == "%":
            def discount(p):
                if p.promo_price and p.price and p.price > 0:
                    return (p.promo_price - p.price) / p.price  # negative = bigger discount
                return 0
            products.sort(key=discount)
            return "discount"
        return ""

    def _show_products(products, preferred_idx):
        table = Table(show_header=False, padding=(0, 1), box=None)
        table.add_column("", style="dim", width=4)
        table.add_column("Product", min_width=30, max_width=50)
        table.add_column("Size")
        table.add_column("Price", justify="right")
        table.add_column("Unit", justify="right")
        table.add_column("Pickup", justify="center")
        table.add_column("NOVA", justify="center")
        table.add_column("Nutri", justify="center")
        for i, p in enumerate(products, 1):
            pickup = "[green]Yes[/green]" if p.curbside else "[red]No[/red]"
            star = " ★" if i - 1 == preferred_idx else ""
            desc = _short_desc(p.description, p.size) + star
            table.add_row(f" {i}.", desc, p.size, _format_price(p), _unit_price(p), pickup, _nova_dots(p.nova_group), _nutri_grade(p.nutriscore))
        console.print(table)

    # Cache prices by UPC across searches (Kroger API is inconsistent)
    price_cache: dict[str, dict] = {}  # upc -> {"regular": float, "promo": float|None}

    # Resume from previous partial order
    previous = load_order()
    prev_items = {s["item"] for s in previous}
    selected = list(previous)

    remaining = [name for name in search_names if name not in prev_items]
    if previous and remaining:
        console.print(f"[dim]Resuming: {len(previous)} already picked, {len(remaining)} remaining[/dim]\n")
    elif previous and not remaining:
        console.print(f"[bold green]All {len(previous)} items already picked.[/bold green]")
        return

    def _get_search_context(conn, item_name):
        """Build search context for an item. Returns dict with root, modifier, shopping_group."""
        # Try ingredients table first
        row = conn.execute(
            "SELECT name, root, aisle FROM ingredients WHERE LOWER(name) = LOWER(?)",
            (item_name,),
        ).fetchone()
        if not row:
            # Try regulars
            erow = conn.execute(
                "SELECT name, shopping_group FROM regulars WHERE LOWER(name) = LOWER(?)",
                (item_name,),
            ).fetchone()
            if erow:
                return {"root": item_name, "modifier": "", "shopping_group": erow["shopping_group"] or ""}
            # Partial match on ingredients (e.g., "baby carrots" → "carrots")
            row = conn.execute(
                "SELECT name, root, aisle FROM ingredients WHERE LOWER(?) LIKE '%' || LOWER(name) || '%' LIMIT 1",
                (item_name,),
            ).fetchone()
            if not row:
                return {"root": item_name, "modifier": "", "shopping_group": ""}

        root = row["root"] if row["root"] else row["name"]
        # Derive modifier: whatever is in the name that isn't the root
        modifier = item_name.lower().replace(root.lower(), "").strip()
        return {"root": root, "modifier": modifier, "shopping_group": row["aisle"] or ""}

    # Always exclude non-grocery items from all searches
    _ALWAYS_EXCLUDE = ["dog food", "cat food", "pet"]
    # Additional exclusions for produce items
    _PRODUCE_EXCLUDE = ["dressing", "dip", "oil", "sauce", "seasoning", "chips", "crackers"]

    # Pool cache: {cache_key: {"products": [...], "timestamp": float}}
    _pool_cache: dict[str, dict] = {}
    _CACHE_TTL = 86400  # 24 hours

    def _cache_key(term, require_category, exclude_keywords):
        parts = [term.lower()]
        if require_category:
            parts.append(f"cat:{require_category.lower()}")
        if exclude_keywords:
            parts.append(f"exc:{','.join(sorted(k.lower() for k in exclude_keywords))}")
        return "|".join(parts)

    def _fetch_product_pool(term, require_category=None, exclude_keywords=None):
        """Fetch products from Kroger. Cached for 24h. Uses limit=50 per page, parallel batches."""
        import time as _time

        key = _cache_key(term, require_category, exclude_keywords)
        cached = _pool_cache.get(key)
        if cached and (_time.time() - cached["timestamp"]) < _CACHE_TTL:
            return list(cached["products"])

        PAGE_LIMIT = 50
        BATCH_SIZE = 4

        all_products = []
        seen_upcs = set()
        start = 1

        def _fetch_page(s):
            try:
                return search_products_fast(term, limit=PAGE_LIMIT, start=s,
                                            require_category=require_category,
                                            exclude_keywords=exclude_keywords)
            except Exception:
                return []

        while True:
            with ThreadPoolExecutor(max_workers=BATCH_SIZE) as pool:
                futures = [pool.submit(_fetch_page, start + i * PAGE_LIMIT) for i in range(BATCH_SIZE)]
                batch_had_full_page = False
                for f in futures:
                    page_results = f.result()
                    for p in page_results:
                        if p.upc not in seen_upcs:
                            seen_upcs.add(p.upc)
                            all_products.append(p)
                    if len(page_results) == PAGE_LIMIT:
                        batch_had_full_page = True

            if not batch_had_full_page:
                break
            start += BATCH_SIZE * PAGE_LIMIT

        _pool_cache[key] = {"products": all_products, "timestamp": _time.time()}
        return all_products

    # Prefetch: background future for next item's pool
    _prefetch_future: dict[str, any] = {}  # name -> Future


    def _normalize(text):
        """Normalize text for matching: lowercase, hyphens to spaces."""
        return text.lower().replace("-", " ")

    def _filter_pool(product_pool, keyword):
        """Filter product pool — all words must appear in description or brand."""
        words = _normalize(keyword).split()
        def matches(p):
            text = _normalize(f"{p.description} {p.brand}")
            return all(w in text for w in words)
        return [p for p in product_pool if matches(p)]

    def _relevance_sort(products, search_term):
        """Sort products so those matching more words from search_term appear first."""
        words = _normalize(search_term).split()
        def score(p):
            text = _normalize(f"{p.description} {p.brand}")
            return -sum(1 for w in words if w in text)
        products.sort(key=score)

    def _prefetch_next(remaining_names, current_idx):
        """Start background fetch for the next item's pool."""
        next_idx = current_idx + 1
        if next_idx >= len(remaining_names):
            return
        next_name = remaining_names[next_idx]
        if next_name in _prefetch_future:
            return  # already prefetching
        next_ctx = _get_search_context(conn, next_name)
        next_root = next_ctx["root"]
        next_sg = next_ctx["shopping_group"]
        next_exc = list(_ALWAYS_EXCLUDE)
        if next_sg.lower() in ("produce", "fruit & veggie"):
            next_exc += _PRODUCE_EXCLUDE
        executor = ThreadPoolExecutor(max_workers=1)
        _prefetch_future[next_name] = executor.submit(_fetch_product_pool, next_root, exclude_keywords=next_exc)

    # Build meal context: which meals use each item and how much
    _gl_for_context = build_grocery_list(conn, mw.meals, mw.start_date, mw.end_date)
    _meal_context: dict[str, dict] = {}
    for _item in _gl_for_context.items:
        _meal_context[_item.ingredient_name.lower()] = {
            "meals": _item.meals,
            "qty": _item.total_quantity,
            "unit": _item.unit,
        }

    try:
        for item_idx, name in enumerate(remaining):
            ctx_info = _meal_context.get(name.lower())
            if ctx_info and len(ctx_info["meals"]) > 1:
                meal_list = ", ".join(ctx_info["meals"])
                console.print(f"[bold cyan]{name}[/bold cyan]  [yellow]⚠ needed for {len(ctx_info['meals'])} meals: {meal_list}[/yellow]")
            else:
                console.print(f"[bold cyan]{name}[/bold cyan]")

            # Kick off prefetch for next item
            _prefetch_next(remaining, item_idx)

            recent_prefs = get_preferred_products(conn, name, limit=3)
            hint = ""

            if recent_prefs:
                # Show recent picks ranked by recency
                console.print("  [dim]Recent picks:[/dim]")
                for i, pref in enumerate(recent_prefs, 1):
                    rating_tag = ""
                    if pref.rating == 1:
                        rating_tag = " [green](+1)[/green]"
                    elif pref.rating == -1:
                        rating_tag = " [red](-1)[/red]"
                    console.print(f"  [dim]  {i}. {pref.description} ({pref.size}){rating_tag}[/dim]")

                pref_choice = click.prompt(
                    "  Pick #, or type to search (Enter = 1)",
                    default="", show_default=False,
                ).strip()

                picked_pref = None
                if pref_choice == "":
                    picked_pref = recent_prefs[0]
                elif pref_choice.isdigit() and 1 <= int(pref_choice) <= len(recent_prefs):
                    picked_pref = recent_prefs[int(pref_choice) - 1]

                if picked_pref:
                    # Quick-confirm: search for preferred and check availability
                    try:
                        check = search_products_fast(picked_pref.description, limit=5, start=1)
                    except Exception:
                        check = []
                    found = [p for p in check if p.upc == picked_pref.upc]
                    if found:
                        p = found[0]
                        fill_prices([p])
                        cached = price_cache.get(p.upc)
                        if p.price is not None:
                            price_cache[p.upc] = {"regular": p.price, "promo": p.promo_price}
                        elif cached:
                            p.price = cached["regular"]
                            p.promo_price = cached.get("promo")
                        price_str = _format_price(p) if p.price else "[dim]price unavailable[/dim]"
                        pickup = "pickup ✓" if p.curbside else "[red]no pickup[/red]"
                        qty = click.prompt(f"  {price_str} ({pickup}) — Qty", default=1, type=int, show_default=True)
                        save_preference(conn, name, p)
                        selected.append({"item": name, "product": p.description, "size": p.size, "upc": p.upc, "qty": qty})
                        console.print(f"  [green]✓ {p.description} x{qty}[/green]")
                        if click.confirm(f"  Anything else in '{name}'?", default=False):
                            pref_choice = name  # fall through to full search
                        else:
                            console.print()
                            continue
                    else:
                        console.print(f"  [yellow]Not available this week[/yellow]")
                        pref_choice = name  # fall through to full search

                search_term = pref_choice if pref_choice else name
            else:
                search_term = name

                # No preference — ask for brand/flavor/style upfront
                hint = click.prompt(
                    "  Brand, flavor, or style? (Enter to browse all)",
                    default="", show_default=False,
                ).strip()

            # Build search context from ingredient/essential data
            ctx = _get_search_context(conn, name)
            root = ctx["root"]
            modifier = ctx["modifier"]
            shopping_group = ctx["shopping_group"]

            exc_keywords = list(_ALWAYS_EXCLUDE)
            if shopping_group.lower() in ("produce", "fruit & veggie"):
                exc_keywords += _PRODUCE_EXCLUDE

            # Build API search term: root + hint (modifier applied as local filter)
            api_term = f"{root} {hint}".strip() if hint else root

            try:
                # Use prefetch result if available and search term matches
                prefetch = _prefetch_future.pop(name, None)
                if prefetch and api_term == root:
                    product_pool = prefetch.result()
                else:
                    product_pool = _fetch_product_pool(api_term, exclude_keywords=exc_keywords)
            except Exception as e:
                console.print(f"  [red]Error: {e}[/red]\n")
                continue

            if not product_pool:
                console.print("  [yellow]No results[/yellow]")
                retry = click.prompt("  Type to search again, or 's' to skip", default="s", show_default=False).strip()
                if retry.lower() != "s":
                    try:
                        product_pool = _fetch_product_pool(retry, exclude_keywords=exc_keywords)
                    except Exception:
                        pass
                if not product_pool:
                    if click.confirm(f"  Remove '{name}' from grocery list?", default=False):
                        workflow.remove_grocery_item(name)
                        console.print("  [dim]Removed[/dim]\n")
                    else:
                        console.print("  [dim]Skipped (kept on in-store list)[/dim]\n")
                    continue

            # Check if products span multiple Kroger departments — prompt to narrow
            _SKIP_CATS = {"baby", "pet care", "natural & organic"}
            dept_set = set()
            for p in product_pool:
                for c in (p.categories or []):
                    if c.lower() not in _SKIP_CATS:
                        dept_set.add(c)
            if len(dept_set) > 1:
                dept_list = sorted(dept_set)
                console.print(f"  [dim]Found in: {', '.join(dept_list)}[/dim]")
                cat_choice = click.prompt(
                    "  Which section? (Enter for all)",
                    default="", show_default=False,
                ).strip()
                if cat_choice:
                    cat_lower = cat_choice.lower()
                    product_pool = [
                        p for p in product_pool
                        if any(cat_lower in c.lower() for c in (p.categories or []))
                    ]

            preferred = recent_prefs[0] if recent_prefs else None

            # Apply modifier as default local filter (e.g., "sliced" for "sliced cheese")
            if modifier:
                filtered = _filter_pool(product_pool, modifier)
                if filtered:
                    view = filtered
                else:
                    view = list(product_pool)
            else:
                view = list(product_pool)
            _relevance_sort(view, api_term)
            page = 0
            PAGE_SIZE = 5

            while True:
                # Paginate the current view
                page_products = view[page * PAGE_SIZE : (page + 1) * PAGE_SIZE]
                if not page_products:
                    if page > 0:
                        page = max(0, page - 1)
                        console.print("  [dim]No more results.[/dim]")
                        continue
                    console.print("  [yellow]No matches in pool[/yellow]")
                    # Reset filter
                    view = list(product_pool)
                    page = 0
                    continue

                # Fill prices and food scores for this page only
                fill_prices(page_products)

                # Apply price cache after fill
                for p in page_products:
                    cached = price_cache.get(p.upc)
                    if p.price is not None:
                        price_cache[p.upc] = {"regular": p.price, "promo": p.promo_price}
                    elif cached:
                        p.price = cached["regular"]
                        p.promo_price = cached.get("promo")
                    if p.promo_price is not None and p.upc in price_cache:
                        price_cache[p.upc]["promo"] = p.promo_price

                def _score(p):
                    if p.nova_group is None and not p.nutriscore:
                        nova, nutri = _lookup_food_score(p.description, p.brand)
                        p.nova_group = nova
                        p.nutriscore = nutri

                with ThreadPoolExecutor(max_workers=5) as tpool:
                    tpool.map(_score, page_products)

                # Mark preferred product
                preferred_idx = None
                if preferred:
                    for i, p in enumerate(page_products):
                        if p.upc == preferred.upc:
                            preferred_idx = i
                            break

                _show_products(page_products, preferred_idx)

                has_more = (page + 1) * PAGE_SIZE < len(view)
                has_prev = page > 0
                nav_hints = []
                if has_prev:
                    nav_hints.append("'u' up")
                if has_more:
                    nav_hints.append("'d' down")
                nav_hint = ", ".join(nav_hints)
                if nav_hint:
                    nav_hint = ", " + nav_hint

                filter_note = ""
                if len(view) < len(product_pool):
                    filter_note = f" [{len(view)}/{len(product_pool)}]"

                if preferred_idx is not None:
                    prompt_text = f"  Pick #, sort (p/n/g/%){nav_hint}{filter_note} [default: {preferred_idx + 1}]"
                else:
                    prompt_text = f"  Pick #, sort (p/n/g/%){nav_hint}{filter_note}, or 's' to skip"

                choice = click.prompt(prompt_text, default="", show_default=False)
                choice = choice.strip()

                if choice.lower() in ("p", "n", "g", "%"):
                    label = _sort_products(view, choice.lower())
                    page = 0
                    console.print(f"  [dim]Sorted by {label}[/dim]")
                    continue
                elif choice.lower() == "d" and has_more:
                    page += 1
                    continue
                elif choice.lower() == "u" and has_prev:
                    page -= 1
                    continue
                elif choice.lower() == "r":
                    # Reset filter
                    view = list(product_pool)
                    page = 0
                    console.print(f"  [dim]Filter cleared ({len(view)} products)[/dim]")
                    continue
                elif choice.lower() == "s" or choice == "":
                    if choice == "" and preferred_idx is not None:
                        picked = page_products[preferred_idx]
                        qty = click.prompt("  Qty", default=1, type=int, show_default=True)
                        save_preference(conn, name, picked)
                        selected.append({"item": name, "product": picked.description, "size": picked.size, "upc": picked.upc, "qty": qty})
                        console.print(f"  [green]✓ {picked.description} x{qty}[/green]")
                        if click.confirm(f"  Anything else in '{name}'?", default=False):
                            continue
                    elif choice.lower() == "s":
                        if click.confirm(f"  Remove '{name}' from grocery list?", default=False):
                            workflow.remove_grocery_item(name)
                            console.print("  [dim]Removed[/dim]")
                        else:
                            console.print("  [dim]Skipped (kept on in-store list)[/dim]")
                    break
                elif choice.isdigit():
                    idx = int(choice) - 1
                    if 0 <= idx < len(page_products):
                        picked = page_products[idx]
                        qty = click.prompt("  Qty", default=1, type=int, show_default=True)
                        save_preference(conn, name, picked)
                        selected.append({"item": name, "product": picked.description, "size": picked.size, "upc": picked.upc, "qty": qty})
                        console.print(f"  [green]✓ {picked.description} x{qty}[/green]")
                        if click.confirm(f"  Anything else in '{name}'?", default=False):
                            continue
                    break
                else:
                    # Filter the pool locally; if no matches, re-fetch from API
                    filtered = _filter_pool(product_pool, choice)
                    if filtered:
                        view = filtered
                        page = 0
                        console.print(f"  [dim]Filtered to {len(filtered)} matches for '{choice}'[/dim]")
                    else:
                        re_term = f"{root} {choice}"
                        console.print(f"  [dim]No local matches, searching '{re_term}'...[/dim]")
                        try:
                            new_pool = _fetch_product_pool(re_term, exclude_keywords=list(_ALWAYS_EXCLUDE))
                        except Exception:
                            new_pool = []
                        if new_pool:
                            product_pool = new_pool
                            view = list(product_pool)
                            _relevance_sort(view, re_term)
                        page = 0

            console.print()

    except (KeyboardInterrupt, click.Abort):
        console.print("\n")

    if selected:
        order_file = save_order(selected)
        console.print(f"\n[bold green]Order: {len(selected)} items selected[/bold green]")
        for s in selected:
            qty = s.get('qty', 1)
            qty_str = f" x{qty}" if qty > 1 else ""
            console.print(f"  {s['item']} → {s['product']} ({s['size']}){qty_str}")
        console.print(f"\n[dim]Saved to {order_file}[/dim]")
    else:
        console.print("\n[dim]No items selected.[/dim]")


# ── Helpers ──────────────────────────────────────────────


def _show_full_grocery_list(conn, mw, gl, selected_regulars, extra_items):
    """Display the full grocery list grouped by shopping section."""
    from collections import defaultdict

    from rich.table import Table

    from souschef.sheets import _GROUP_ORDER

    seen: set[str] = set()
    all_entries: list[tuple[str, str, str]] = []

    for r in selected_regulars:
        seen.add(r.name.lower())
        all_entries.append((r.name, "regular", r.shopping_group))

    for item in gl.items:
        if item.ingredient_name.lower() not in seen:
            seen.add(item.ingredient_name.lower())
            meal_text = ", ".join(item.meals) if item.meals else ""
            group = item.aisle or "Other"
            all_entries.append((item.ingredient_name, meal_text, group))

    for name in extra_items:
        if name.lower() not in seen:
            seen.add(name.lower())
            all_entries.append((name, "other", "Other"))

    if not all_entries:
        console.print("[dim]No groceries needed.[/dim]")
        return

    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for name, for_text, group in all_entries:
        groups[group].append((name, for_text))

    table = Table(title=f"Grocery List — Week of {mw.start_date}", show_lines=False)
    table.add_column("Item", style="white", min_width=20)
    table.add_column("For", style="dim")

    ordered = [g for g in _GROUP_ORDER if g in groups]
    remaining = sorted(g for g in groups if g not in _GROUP_ORDER)
    for group in ordered + remaining:
        table.add_row(f"[bold cyan]{group}[/bold cyan]", "")
        for name, for_text in sorted(groups[group]):
            table.add_row(f"  {name}", for_text)

    console.print(table)
    console.print(f"\n[bold]{len(all_entries)} items total[/bold]")


def _prompt_full_grocery_list(conn, mw):
    """Interactive prompts for regulars, meal items, and extras. Saves selections for reuse."""
    from souschef.regulars import list_regulars

    gl = build_grocery_list(conn, mw.meals, mw.start_date, mw.end_date)

    # --- 1. Regulars prompt (default: all active included) ---
    regulars = list_regulars(conn)
    selected_regulars = list(regulars)
    if regulars:
        console.print("\n[bold]Regulars this week:[/bold]")
        for i, item in enumerate(regulars, 1):
            console.print(f"  {i}. {item.name}")
        remove = click.prompt(
            "\nRemove any? Enter numbers separated by commas, or press Enter to keep all",
            default="", show_default=False
        )
        if remove.strip():
            to_remove = set()
            for part in remove.split(","):
                part = part.strip()
                if part.isdigit():
                    idx = int(part) - 1
                    if 0 <= idx < len(regulars):
                        to_remove.add(idx)
            selected_regulars = [e for i, e in enumerate(regulars) if i not in to_remove]
            removed_names = [e.name for i, e in enumerate(regulars) if i in to_remove]
            if removed_names:
                console.print(f"[dim]Removed: {', '.join(removed_names)}[/dim]")

    # --- 2. Meal items prompt (default: all included, remove what you already have) ---
    meal_items = [item for item in gl.items]
    regular_name_set = {r.name.lower() for r in selected_regulars}
    display_items = [item for item in meal_items if item.ingredient_name.lower() not in regular_name_set]
    removed_meal_items: set[str] = set()

    if display_items:
        console.print("\n[bold]Meal ingredients this week:[/bold]")
        for i, item in enumerate(display_items, 1):
            meal_text = ", ".join(item.meals) if item.meals else ""
            console.print(f"  {i}. {item.ingredient_name}  [dim]({meal_text})[/dim]")
        remove = click.prompt(
            "\nAlready have any? Enter numbers to remove, or press Enter to keep all",
            default="", show_default=False
        )
        if remove.strip():
            to_remove = set()
            for part in remove.split(","):
                part = part.strip()
                if part.isdigit():
                    idx = int(part) - 1
                    if 0 <= idx < len(display_items):
                        to_remove.add(idx)
            removed_names = [display_items[i].ingredient_name for i in to_remove]
            removed_meal_items = {n.lower() for n in removed_names}
            if removed_names:
                console.print(f"[dim]Removed: {', '.join(removed_names)}[/dim]")

    # Filter out removed meal items from gl
    gl.items = [item for item in gl.items if item.ingredient_name.lower() not in removed_meal_items]

    # --- 3. Extra items prompt (free-form) ---
    extra_items = []
    console.print("\n[bold]Anything else to add?[/bold] (type item name, or press Enter to finish)")
    while True:
        item = click.prompt("  Item", default="", show_default=False)
        if not item.strip():
            break
        extra_items.append(item.strip())
    if extra_items:
        console.print(f"[dim]Added: {', '.join(extra_items)}[/dim]")

    # --- 4. Store assignment ---
    from souschef.stores import list_stores, prompt_keys_help

    meal_item_names = [item.ingredient_name for item in gl.items]
    all_items = (
        [r.name for r in selected_regulars]
        + meal_item_names
        + extra_items
    )

    stores = list_stores()
    if not stores:
        console.print("\n[yellow]No stores configured. Run 'souschef stores add' first.[/yellow]")
        console.print("[dim]Example: souschef stores add Kroger k --mode pickup --api kroger[/dim]")
        store_assignments: dict[str, str] = {}
    else:
        valid_keys = {s["key"] for s in stores}
        key_help = prompt_keys_help(stores)
        console.print(f"\n[bold]Where to shop?[/bold] [dim]{key_help}[/dim]")
        store_assignments = {}
        for item_name in all_items:
            while True:
                choice = click.prompt(f"  {item_name}", default="", show_default=False).strip().lower()
                if choice in valid_keys:
                    store_assignments[item_name] = choice
                    break
                console.print(f"  [dim]{key_help}[/dim]")

        # Summary
        from collections import Counter
        counts = Counter(store_assignments.values())
        summary = "  •  ".join(
            f"{next(s['name'] for s in stores if s['key'] == k)}: {c} items"
            for k, c in counts.items()
        )
        console.print(f"\n[dim]{summary}[/dim]")

    # Save selections for reuse by export/order
    dk = workflow._date_key(mw.start_date, mw.end_date)
    workflow.save_grocery_selections(
        regulars=[r.name for r in selected_regulars],
        extras=extra_items,
        meal_items=meal_item_names,
        store_assignments=store_assignments,
        date_key=dk,
    )

    return gl, selected_regulars, extra_items


def _get_full_search_list(conn, mw):
    """Get the full search list, reusing saved selections if available. Returns API-enabled store items only."""
    dk = workflow._date_key(mw.start_date, mw.end_date)
    sel = workflow.load_grocery_selections(date_key=dk)
    if sel:
        console.print("[dim]Using saved grocery list selections.[/dim]")
        search_result = workflow.get_search_list(conn, start_date=mw.start_date, end_date=mw.end_date)
        for store_name, items in search_result["in_person"].items():
            console.print(f"[dim]{store_name} ({len(items)} items): {', '.join(items)}[/dim]")
        return search_result["api_items"]

    # No saved list — run the prompts
    gl, selected_regulars, extra_items = _prompt_full_grocery_list(conn, mw)
    seen: set[str] = set()
    names: list[str] = []
    for r in selected_regulars:
        if r.name.lower() not in seen:
            seen.add(r.name.lower())
            names.append(r.name)
    for item in gl.items:
        if item.store in ("kroger", "either") and item.ingredient_name.lower() not in seen:
            seen.add(item.ingredient_name.lower())
            names.append(item.ingredient_name)
    for name in extra_items:
        if name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def _get_week_or_print(conn, week):
    """CLI wrapper that loads a MealWeek or prints error message."""
    mw = load_meal_week(conn, week)
    if not mw.meals:
        console.print("[red]No meals found. Run 'souschef plan' first.[/red]")
        return None
    return mw


def _resolve_day_to_date(day_str: str, week: str | None = None) -> str | None:
    """Convert a day name/number to a slot_date string for the given week."""
    from datetime import date as dt_date, timedelta

    day_idx = workflow.parse_day(day_str)
    if day_idx is None:
        return None

    if week:
        monday = dt_date.fromisoformat(week)
    else:
        today = dt_date.today()
        monday = today - timedelta(days=today.weekday())

    return (monday + timedelta(days=day_idx)).isoformat()


# ── Web Server ──────────────────────────────────────────


@cli.command("web")
@click.option("--host", default="0.0.0.0", help="Bind address")
@click.option("--port", default=8000, type=int, help="Port")
def web_cmd(host, port):
    """Launch the web frontend."""
    try:
        import uvicorn
    except ImportError:
        console.print(
            "[red]Web dependencies not installed.[/red]\n"
            '[dim]Run: pip install -e ".[web]"[/dim]'
        )
        return

    console.print(f"[bold]Starting souschef web on {host}:{port}[/bold]")
    uvicorn.run("souschef.web.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    cli()
