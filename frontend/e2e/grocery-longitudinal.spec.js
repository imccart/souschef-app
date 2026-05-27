import { test, expect } from "./fixtures.js";
import {
  addRegular,
  addRegularsToGrocery,
  createGroceryRow,
  dateOffset,
  pickLibraryMealWithIngredients,
  seedLibraryMeal,
  setMealOnDate,
  stageGroceryRow,
  todayIso,
} from "./helpers.js";

async function fetchGrocery(page) {
  const resp = await page.request.get("/api/grocery");
  if (!resp.ok()) {
    throw new Error(`/api/grocery ${resp.status()}: ${await resp.text()}`);
  }
  return await resp.json();
}

function flattenActive(groc) {
  return Object.values(groc.items_by_group || {}).flat();
}

function activeNamesLower(groc) {
  return flattenActive(groc).map((i) => i.name.toLowerCase());
}

async function fetchMealId(page, dateIso) {
  const meals = await (await page.request.get("/api/meals")).json();
  const day = (meals.days || []).find((d) => d.date === dateIso);
  // /api/meals shape: days[].meal.id (the day struct has date/day_short/meal,
  // and the meal struct has id/recipe_id/recipe_name/...).
  if (!day || !day.meal || !day.meal.id) {
    throw new Error(`No meal found on ${dateIso}`);
  }
  return String(day.meal.id);
}

test.describe("Grocery longitudinal", () => {
  test("lifecycle: bought + have-it + active-still persist across receipt tagging and multiple re-syncs", async ({
    authedPage,
  }) => {
    // Adds one meal, takes three of its rows through three states (bought
    // via /grocery/toggle, have-it, leave active), then mutates the bought
    // row to receipt='matched' (simulating the receipt processor) and
    // verifies subsequent /grocery calls don't disturb any of them. Catches
    // the bug class where a state-bearing row gets clobbered by meal-sync's
    // UPDATE on a subsequent /grocery call. Three syncs because some past
    // bugs (covered_keys collapsing, Branch 2 firing on already-inserted
    // rows) fired on the SECOND or LATER sync, not the first.
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    expect((libMeal.ingredients || []).length).toBeGreaterThanOrEqual(3);
    await seedLibraryMeal(authedPage, libMeal);
    await setMealOnDate(authedPage, todayIso(), libMeal.name);

    const before = await fetchGrocery(authedPage);
    const beforeItems = flattenActive(before);
    expect(beforeItems.length).toBeGreaterThanOrEqual(3);
    const [boughtRow, haveItRow, activeRow] = beforeItems.slice(0, 3);

    // Two settled states + one left active.
    {
      const r = await authedPage.request.post(
        `/api/grocery/toggle/${boughtRow.id}`,
      );
      expect(r.ok()).toBe(true);
    }
    {
      const r = await authedPage.request.post(
        `/api/grocery/have-it/${haveItRow.id}`,
      );
      expect(r.ok()).toBe(true);
    }

    const afterStateChanges = await fetchGrocery(authedPage);
    {
      const namesActive = activeNamesLower(afterStateChanges);
      expect(namesActive).not.toContain(boughtRow.name.toLowerCase());
      expect(namesActive).not.toContain(haveItRow.name.toLowerCase());
      expect(namesActive).toContain(activeRow.name.toLowerCase());
      expect(afterStateChanges.have_it || []).toContain(
        haveItRow.name.toLowerCase(),
      );
      expect(afterStateChanges.checked || []).toContain(
        boughtRow.name.toLowerCase(),
      );
    }

    // Simulate the receipt processor matching the bought row. It transitions
    // checked=1 → receipt_status='matched'. Keep meal_ids so the row stays
    // attached to the still-on-plan meal (this is what the real processor
    // does for in-flight rows).
    const mealIdToday = await fetchMealId(authedPage, todayIso());
    await stageGroceryRow(authedPage, {
      id: boughtRow.id,
      receipt_status: "matched",
      meal_ids: mealIdToday,
    });

    // Re-sync. Per per-meal-id logic: bought-then-receipt'd row is in
    // covered_meal_ids_by_key for {meal_id_today}. fresh_need={meal_id_today}.
    // effective={} → no phantom insert. have-it row in existing_map (have-it
    // included), Branch 3 preserves state. active row in existing_map,
    // Branch 3 preserves.
    const afterReceipt = await fetchGrocery(authedPage);
    {
      const namesActive = activeNamesLower(afterReceipt);
      expect(namesActive).not.toContain(boughtRow.name.toLowerCase());
      expect(namesActive).not.toContain(haveItRow.name.toLowerCase());
      expect(namesActive).toContain(activeRow.name.toLowerCase());
      expect(afterReceipt.have_it || []).toContain(haveItRow.name.toLowerCase());
    }

    // Third sync. State should still hold (no Branch 2 reset, no phantom).
    const afterThird = await fetchGrocery(authedPage);
    {
      const namesActive = activeNamesLower(afterThird);
      expect(namesActive).not.toContain(boughtRow.name.toLowerCase());
      expect(namesActive).not.toContain(haveItRow.name.toLowerCase());
      expect(namesActive).toContain(activeRow.name.toLowerCase());
      expect(afterThird.have_it || []).toContain(haveItRow.name.toLowerCase());
    }
  });

  test("multi-occurrence: same recipe on 3 dates, partial buy still surfaces remaining occurrences", async ({
    authedPage,
  }) => {
    // The point of meal_ids is per-occurrence resolution. Add the same
    // recipe on 3 different dates → row's meal_ids='A,B,C'. Stage the row
    // to receipt='matched' meal_ids='A' (user bought enough for one
    // occurrence). Re-sync: fresh_need={A,B,C}, covered={A}, effective=
    // {B,C} → INSERT a fresh active row with meal_ids='B,C'. Then stage
    // THAT row to receipt='matched' meal_ids='B,C': covered={A,B,C},
    // effective={} → no further insert.
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);

    const date1 = todayIso();
    const date2 = dateOffset(2);
    const date3 = dateOffset(4);
    await setMealOnDate(authedPage, date1, libMeal.name);
    await setMealOnDate(authedPage, date2, libMeal.name);
    await setMealOnDate(authedPage, date3, libMeal.name);

    const mealA = await fetchMealId(authedPage, date1);
    const mealB = await fetchMealId(authedPage, date2);
    const mealC = await fetchMealId(authedPage, date3);

    const before = await fetchGrocery(authedPage);
    const beforeItems = flattenActive(before);
    expect(beforeItems.length).toBeGreaterThan(0);
    const target = beforeItems[0];
    const targetLower = target.name.toLowerCase();

    // After step 1: row1 active, meal_ids='A,B,C'. Stage to look like
    // user bought enough for meal A only.
    await stageGroceryRow(authedPage, {
      id: target.id,
      receipt_status: "matched",
      meal_ids: mealA,
    });

    const afterPartial = await fetchGrocery(authedPage);
    const partialMatches = activeNamesLower(afterPartial).filter(
      (n) => n === targetLower,
    );
    expect(partialMatches.length).toBeGreaterThanOrEqual(1);

    // The new active row's meal_ids should serve {B, C}. Find it.
    const activeForBC = flattenActive(afterPartial).find(
      (r) => r.name.toLowerCase() === targetLower && r.id !== target.id,
    );
    expect(activeForBC).toBeDefined();
    if (activeForBC) {
      // Stage the {B, C} row to receipt='matched' too — covers all three
      // occurrences.
      await stageGroceryRow(authedPage, {
        id: activeForBC.id,
        receipt_status: "matched",
        meal_ids: `${mealB},${mealC}`,
      });
    }

    const afterAll = await fetchGrocery(authedPage);
    expect(activeNamesLower(afterAll)).not.toContain(targetLower);
  });

  test("regulars overlap: meal needing the same ingredient does not duplicate the regular row", async ({
    authedPage,
  }) => {
    // User has a regular for "X". Then they add a meal whose recipe
    // contains "X". Regulars are intentionally independent of meals:
    // build_grocery_list filters staple/regular ingredients out of the
    // meal-derived list, so the meal can't auto-flow a duplicate "X". The
    // invariant that matters: still a single row, source='regular', and the
    // meal does NOT attach its name to the regular row (for_meals stays empty).
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);
    const ingredient = libMeal.ingredients[0];
    expect(ingredient).toBeTruthy();
    const ingredientLower = String(ingredient).toLowerCase();

    // Step 1: register the regular and add it to the grocery list.
    await addRegular(authedPage, ingredient);
    await addRegularsToGrocery(authedPage, [ingredient]);

    const beforeMeal = await fetchGrocery(authedPage);
    const regularRows = flattenActive(beforeMeal).filter(
      (r) => r.name.toLowerCase() === ingredientLower,
    );
    expect(regularRows).toHaveLength(1);
    expect(regularRows[0].source).toBe("regular");

    // Step 2: add the library meal — recipe contains this ingredient.
    await setMealOnDate(authedPage, todayIso(), libMeal.name);

    // Step 3: re-sync via /grocery. Expect attribution to be attached but
    // the regular row to remain a single row of source='regular'.
    const afterMeal = await fetchGrocery(authedPage);
    const overlappedRows = flattenActive(afterMeal).filter(
      (r) => r.name.toLowerCase() === ingredientLower,
    );
    expect(overlappedRows).toHaveLength(1);
    expect(overlappedRows[0].source).toBe("regular");
    // Regular stays independent — the overlapping meal does not tag it.
    expect(String(overlappedRows[0].for_meals || "")).toBe("");
  });

  test("long-tail accumulation: many stale receipt-tagged rows do not pollute a fresh meal sync", async ({
    authedPage,
  }) => {
    // Mimics the prod state we saw with 50+ stale legacy receipt-matched
    // rows from prior cycles (feedback id=108 / prod DB inspection on
    // 2026-05-03). With per-meal-id covered tracking, those stale rows
    // contribute zero coverage (their meal_ids=' ' has empty intersection
    // with the active plan), so the fresh meal sync isn't affected.
    const stalePrefix = `zzqqstale-${Date.now()}-`;
    const staleNames = Array.from({ length: 20 }, (_, i) => `${stalePrefix}${i}`);

    for (const name of staleNames) {
      await createGroceryRow(authedPage, {
        name,
        source: "extra",
        receipt_status: "matched",
        receipt_acknowledged: true,
        meal_ids: "",
      });
    }

    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);
    await setMealOnDate(authedPage, todayIso(), libMeal.name);

    const grocery = await fetchGrocery(authedPage);
    const activeNames = activeNamesLower(grocery);

    // None of the stale names should appear in items_by_group (they're
    // filtered out by is_active because receipt_status='matched').
    for (const stale of staleNames) {
      expect(activeNames).not.toContain(stale.toLowerCase());
    }

    // The meal's ingredients DO appear, exactly once each.
    for (const ing of libMeal.ingredients || []) {
      const lower = String(ing).toLowerCase();
      const matches = activeNames.filter((n) => n === lower);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // No duplicate phantom rows for the same canonical name.
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });
});
