import { test, expect } from "./fixtures.js";
import {
  pickLibraryMealWithIngredients,
  seedLibraryMeal,
  setMealOnDate,
  todayIso,
} from "./helpers.js";

test.describe("App basics", () => {
  test("auth flow — lands on Plan tab after login", async ({ authedPage }) => {
    await authedPage.goto("/app");

    // Plan tab in the bottom nav should be marked active
    const planTab = authedPage.locator('[data-tour="plan-tab"]');
    await expect(planTab).toHaveClass(/active/);

    // Plan-specific text should render
    await expect(authedPage.getByText("Your next 10 days")).toBeVisible();
  });

  test("add meal — appears on Plan and populates Grocery", async ({
    authedPage,
  }) => {
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);

    await authedPage.goto("/app");

    // Click the first empty add-meal row (today)
    const firstAddRow = authedPage
      .locator('[data-role="add-meal-row"]')
      .first();
    await expect(firstAddRow).toBeVisible();
    await firstAddRow.click();

    // Meal picker opens — type the name and press Enter to pick the first match
    const search = authedPage.locator('input[placeholder*="Search or type"]');
    await expect(search).toBeVisible();
    await search.fill(libMeal.name);
    await search.press("Enter");

    // Sides step — click "No sides"
    await authedPage
      .getByRole("button", { name: /^No sides$/ })
      .click();

    // Plan should now have a meal-row with this name
    const mealRow = authedPage
      .locator('[data-role="meal-row"]')
      .filter({ hasText: libMeal.name });
    await expect(mealRow).toBeVisible();

    // Grocery sidebar (desktop viewport) should show at least one item.
    // CSS modules hash the class but preserve the base name.
    const groceryItems = authedPage.locator('[class*="groceryItemRow"]');
    await expect(groceryItems.first()).toBeVisible({ timeout: 10_000 });
  });

  test("grocery check-off — item hides and stays hidden on reload", async ({
    authedPage,
  }) => {
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);
    await setMealOnDate(authedPage, todayIso(), libMeal.name);

    await authedPage.goto("/app");

    const groceryItems = authedPage.locator('[class*="groceryItemRow"]');
    await expect(groceryItems.first()).toBeVisible({ timeout: 10_000 });

    // Grab the first item's name so we can assert it disappears
    const firstName = (await groceryItems.first().innerText())
      .split("\n")[0]
      .trim();
    expect(firstName.length).toBeGreaterThan(0);

    // Tap to expand the action bar, then click "Bought"
    await groceryItems.first().click();
    await authedPage
      .getByRole("button", { name: /^Bought$/ })
      .first()
      .click();

    // The row with that name should no longer appear in active items
    const matchingRow = authedPage
      .locator('[class*="groceryItemRow"]')
      .filter({ hasText: firstName });
    await expect(matchingRow).toHaveCount(0, { timeout: 5_000 });

    // Reload — still checked off
    await authedPage.reload();
    await expect(matchingRow).toHaveCount(0, { timeout: 10_000 });
  });
});
