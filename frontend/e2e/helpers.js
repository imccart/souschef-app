import { expect } from "@playwright/test";

export async function fetchLibrary(page) {
  const resp = await page.request.get("/api/onboarding/library");
  if (!resp.ok()) {
    throw new Error(`GET /api/onboarding/library ${resp.status()}`);
  }
  return await resp.json();
}

export async function pickLibraryMealWithIngredients(page) {
  const lib = await fetchLibrary(page);
  const meal = (lib.meals || []).find(
    (m) => Array.isArray(m.ingredients) && m.ingredients.length > 0,
  );
  if (!meal) {
    throw new Error("No library meals with ingredients found");
  }
  return meal;
}

export async function seedLibraryMeal(page, meal) {
  const resp = await page.request.post("/api/onboarding/select-recipes", {
    data: {
      meal_ids: [meal.id],
      side_ids: [],
      custom_meals: [],
      custom_sides: [],
    },
  });
  if (!resp.ok()) {
    throw new Error(`POST /api/onboarding/select-recipes ${resp.status()}`);
  }
}

export async function setMealOnDate(page, dateIso, recipeName) {
  const meals = await (await page.request.get("/api/meals")).json();
  if (!meals?.days) throw new Error("Could not load /api/meals");

  const recipesResp = await page.request.get("/api/recipes");
  const recipes = (await recipesResp.json()).recipes || [];
  const match = recipes.find(
    (r) => r.name.toLowerCase() === recipeName.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `Recipe "${recipeName}" not found on user. Seed it first via seedLibraryMeal.`,
    );
  }

  const resp = await page.request.post(`/api/meals/${dateIso}/set`, {
    data: { recipe_id: match.id, sides: [] },
  });
  if (!resp.ok()) {
    throw new Error(`POST /api/meals/${dateIso}/set ${resp.status()}`);
  }
  return match;
}

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export { expect };
