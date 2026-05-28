import { test, expect } from "./fixtures.js";
import {
  pickLibraryMealWithIngredients,
  seedLibraryMeal,
  todayIso,
  dateOffset,
} from "./helpers.js";

// Coverage for the redesigned meal picker (MealPickerSheet): empty-state
// chrome (search + surprise dice + cuisine chips), pick → checklist sides →
// Done, the "Something else…" custom-side path, and "Chef's night off".
// These flows replaced the old two-step / "No sides" picker.

test.describe("Meal picker (redesign)", () => {
  async function openPickerOnFirstEmptyDay(page) {
    await page.goto("/app");
    const addRow = page.locator('[data-role="add-meal-row"]').first();
    await expect(addRow).toBeVisible();
    await addRow.click();
    const sheet = page.locator(".sheet").first();
    await expect(sheet.getByText("What's for dinner?")).toBeVisible();
    return sheet;
  }

  test("empty state shows search, surprise dice, and cuisine filter", async ({
    authedPage,
  }) => {
    const sheet = await openPickerOnFirstEmptyDay(authedPage);

    await expect(
      sheet.getByRole("button", { name: "Surprise me" }),
    ).toBeVisible();
    await expect(sheet.getByPlaceholder(/Search or add/)).toBeVisible();

    // Cuisine filter is a custom dropdown; defaults to "All cuisines",
    // opens on tap, and reflects the chosen option.
    const filterBtn = sheet.getByRole("button", { name: "Filter by cuisine" });
    await expect(filterBtn).toContainText(/All cuisines/);
    await filterBtn.click();
    await sheet.getByRole("option", { name: "Italian" }).click();
    await expect(filterBtn).toContainText("Italian");
  });

  test("pick a meal → Done with no sides → lands on Plan", async ({
    authedPage,
  }) => {
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);

    const sheet = await openPickerOnFirstEmptyDay(authedPage);

    // Type + Enter picks the first match and enters the picked state.
    const search = sheet.getByPlaceholder(/Search or add/);
    await search.fill(libMeal.name);
    await search.press("Enter");

    // Picked state: meal name + "— with —" + single Done button.
    await expect(sheet.getByText(/— with —/)).toBeVisible();
    await sheet.getByRole("button", { name: /^Done$/ }).click();

    const mealRow = authedPage
      .locator('[data-role="meal-row"]')
      .filter({ hasText: libMeal.name });
    await expect(mealRow).toBeVisible();
  });

  test("'Something else…' adds a custom side that persists on the meal", async ({
    authedPage,
  }) => {
    const libMeal = await pickLibraryMealWithIngredients(authedPage);
    await seedLibraryMeal(authedPage, libMeal);

    const sheet = await openPickerOnFirstEmptyDay(authedPage);
    const search = sheet.getByPlaceholder(/Search or add/);
    await search.fill(libMeal.name);
    await search.press("Enter");

    // Open the custom-side input, type a side, commit with Enter.
    await sheet.getByText(/add a new side/i).click();
    const sideInput = sheet.getByPlaceholder(/add a new side/i);
    await sideInput.fill("Garlic Bread");
    await sideInput.press("Enter");

    // The typed side now shows as a selected checklist row.
    await expect(sheet.getByText("Garlic Bread")).toBeVisible();
    await sheet.getByRole("button", { name: /^Done$/ }).click();

    // Assert it persisted on today's meal (adding a new side opens the
    // ingredients sheet over the plan, so verify via the API rather than DOM).
    await expect
      .poll(async () => {
        const meals = await (await authedPage.request.get("/api/meals")).json();
        const day = (meals.days || []).find((d) => d.date === todayIso());
        const sides = day?.meal?.sides || [];
        return sides.some((s) => s.name === "Garlic Bread");
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test("'Chef's night off' sets a freeform meal on the Plan", async ({
    authedPage,
  }) => {
    // Use a later empty day so it doesn't collide with other specs on today.
    await authedPage.goto("/app");
    const targetDate = dateOffset(3);
    const addRow = authedPage.locator(
      `[data-role="add-meal-row"][data-date="${targetDate}"]`,
    );
    await expect(addRow).toBeVisible();
    await addRow.click();

    const sheet = authedPage.locator(".sheet").first();
    await expect(sheet.getByText("What's for dinner?")).toBeVisible();
    await sheet.getByText(/Chef's night off/).click();

    const mealRow = authedPage
      .locator('[data-role="meal-row"]')
      .filter({ hasText: /Chef's Night Off/ });
    await expect(mealRow).toBeVisible();
  });
});
