# Canonical Ingredient Database Research

Research date: 2026-03-13

## Current State

- **88 seed ingredients** in `data/seed_ingredients.yaml`
- Schema: `id, name, category, aisle, default_unit, store_pref, is_pantry_staple, root`
- `aisle` field doubles as shopping group (used to resolve `trip_items.shopping_group`)
- 12 shopping groups defined in `_GROUP_ORDER`:
  Produce, Meat, Dairy & Eggs, Bread & Bakery, Pasta & Grains, Spices & Baking, Condiments & Sauces, Canned Goods, Frozen, Breakfast & Beverages, Snacks, Other
- `_infer_group()` in `regulars.py` uses keyword matching as a fallback when no ingredient match exists
- `_resolve_shopping_group()` in `web/api.py` cascades: user override > ingredient aisle > regulars table > keyword inference

## Open Datasets Evaluated

### 1. Instacart Market Basket Analysis (Kaggle)

**Best fit for souschef.** This is the dataset to use.

- **Source**: Kaggle (`instacart-market-basket-analysis`), originally released by Instacart for a 2017 competition
- **License**: Custom non-commercial research license (Instacart). Fine for a private/personal-use seeding script. For production, the generated mapping (not the raw data) would be the deliverable.
- **Format**: CSV files
- **Size**: ~49,688 unique products across 134 aisles and 21 departments
- **Key files**:
  - `products.csv` — `product_id, product_name, aisle_id, department_id`
  - `aisles.csv` — `aisle_id, aisle` (134 aisles like "fresh vegetables", "packaged cheese", "energy granola bars")
  - `departments.csv` — `department_id, department` (21 departments like "produce", "dairy eggs", "snacks", "beverages", "frozen")
- **Why it fits**:
  - Real grocery store aisle/department structure maps naturally to souschef's shopping groups
  - Product names are actual grocery items (not USDA nutrient-science names)
  - Department-level grouping is very close to our 12 shopping groups
  - 49K products is far more than we need, so we can filter to common/staple items
- **Mapping effort**: The 21 Instacart departments map cleanly to our 12 groups:
  - `produce` -> Produce
  - `meat seafood` -> Meat
  - `dairy eggs` -> Dairy & Eggs
  - `bakery` -> Bread & Bakery
  - `pasta` (doesn't exist as dept, but aisles like "pasta sauce", "dry pasta") -> Pasta & Grains
  - `pantry`, `canned goods` -> Canned Goods
  - `frozen` -> Frozen
  - `snacks` -> Snacks
  - `beverages`, `breakfast` -> Breakfast & Beverages
  - `condiments` -> Condiments & Sauces
  - `spices seasonings` -> Spices & Baking
  - Remaining departments (`household`, `pets`, `personal care`, etc.) are not grocery food items and get excluded
- **Aisle-level detail** (134 aisles) provides even finer control. For example, `fresh fruits` and `fresh vegetables` both map to Produce, while `packaged vegetables fruits` might map to Canned Goods or Frozen depending on the item.

### 2. USDA FoodData Central

- **Source**: USDA (fdc.nal.usda.gov), free API + bulk download
- **License**: Public domain (US government)
- **Format**: JSON API or bulk CSV/JSON download
- **Size**: ~400,000+ foods across multiple datasets (SR Legacy, Foundation, Branded, Survey FNDDS)
- **Categories**: Uses USDA food groups (25 groups like "Dairy and Egg Products", "Spices and Herbs", "Vegetables and Vegetable Products", "Cereal Grains and Pasta")
- **Strengths**: Authoritative nutrition data, public domain, excellent API
- **Weaknesses for souschef**:
  - Names are scientific/nutritional, not how shoppers think ("Chicken, broilers or fryers, breast, skinless, boneless, meat only, cooked, braised" vs "chicken breast")
  - No aisle/store layout information (it's a nutrition database, not a grocery database)
  - Food groups are nutrition-oriented, not shopping-oriented (e.g., "Legumes and Legume Products" spans canned beans, dried beans, tofu, peanut butter)
  - Massive size with lots of irrelevant entries (baby food, restaurant items, etc.)
  - Would require heavy transformation to get usable ingredient names
- **Verdict**: Poor fit as a primary source. Could supplement with nutrition data later (Phase 4 value reporting), but not useful for seeding shopping-group-mapped ingredients.

### 3. Open Food Facts

- **Source**: world.openfoodfacts.org
- **License**: Open Database License (ODbL) — open, attribution required
- **Format**: CSV dump, MongoDB dump, or REST API
- **Size**: ~3 million products (heavily European-skewed, growing US coverage)
- **Categories**: Hierarchical category taxonomy (e.g., "en:plant-based-foods > en:plant-based-foods-and-beverages > en:beverages > en:juices")
- **Strengths**: Already integrated for NOVA/Nutri-Score in souschef's Kroger order flow. Truly open license. Rich product-level data.
- **Weaknesses for souschef**:
  - Product-level, not ingredient-level (tracks "Kraft Macaroni & Cheese 7.25oz" not "elbow macaroni")
  - Category taxonomy is deep and inconsistent (user-contributed)
  - No aisle mapping (categories are food-science oriented)
  - US coverage is spotty compared to European products
  - Would need to extract ingredient-level concepts from product names, which is noisy
- **Verdict**: Not suitable for ingredient seeding. Already used appropriately for product-level NOVA/Nutri-Score scoring.

### 4. GroceryDB (Tufts)

- **Source**: Academic dataset from Tufts University (2022)
- **License**: Research use
- **Format**: CSV
- **Size**: ~50,000 products from Walmart, Target, Whole Foods
- **Categories**: Store departments and aisles
- **Strengths**: Real US store aisle mappings, includes nutrition processing scores
- **Weaknesses**: Research-only license, product-level not ingredient-level, requires academic access
- **Verdict**: Interesting for research but licensing is restrictive and it's product-level data.

### 5. Spoonacular / Edamam Ingredient Databases

- **Source**: Commercial APIs (spoonacular.com, edamam.com)
- **License**: Commercial, requires API key, rate-limited free tiers
- **Format**: REST API (JSON)
- **Size**: Spoonacular has ~1,100 common ingredients with aisle mappings; Edamam has ~900 foods
- **Strengths**: Spoonacular specifically has an "aisle" field per ingredient (e.g., "Produce", "Baking", "Spices and Seasonings") that maps well to grocery shopping groups
- **Weaknesses**: Commercial license, can't bulk-download and redistribute. Free tier is limited (150 requests/day for Spoonacular).
- **Verdict**: The Spoonacular ingredient list is conceptually the closest to what we want, but the license prevents bulk seeding. However, its ~1,100 ingredient taxonomy is a useful reference for what a complete list looks like.

### 6. Recipe1M+ / RecipeNLG Ingredient Vocabularies

- **Source**: Academic datasets of recipe ingredient lines
- **License**: Research use
- **Format**: JSON
- **Size**: RecipeNLG has ~2 million recipes; extracted ingredient vocabularies have 5,000-15,000 unique ingredient names
- **Strengths**: Real ingredient names as people write them in recipes
- **Weaknesses**: Extremely noisy (includes quantities, prep notes mixed in), no category mapping, requires NLP extraction
- **Verdict**: Not directly usable, but the extracted vocabulary lists can validate completeness of our ingredient list.

## Recommendation: Instacart Dataset + Manual Curation

### Why Instacart

The Instacart dataset is the clear winner because it provides real grocery product names organized by actual store aisles and departments. No other open dataset combines grocery-relevant naming with aisle/department categorization.

### Seeding Plan

**Step 1: Download and filter the Instacart data**

Download `products.csv`, `aisles.csv`, `departments.csv` from Kaggle. Filter to food-related departments only (exclude household, pets, personal care, babies, etc.).

Relevant departments (~13 of 21):
- produce, dairy eggs, frozen, bakery, meat seafood, snacks, beverages, breakfast, canned goods, condiments, dry goods pasta, spices seasonings, deli

**Step 2: Extract ingredient-level names from product names**

Instacart product names are brand-specific ("Organic Hass Avocados" or "Honeycrisp Apples"). We need to normalize to ingredient-level names:

```
"Organic Baby Spinach" -> "baby spinach" or "spinach"
"Banana" -> "banana"
"Large Lemon" -> "lemon"
"2% Reduced Fat Milk" -> "milk"
"Boneless Skinless Chicken Breasts" -> "chicken breast"
```

Approach: For each Instacart aisle, extract the most common 20-50 "root" ingredient names. Many aisles will contribute few items (e.g., "energy drinks" -> just "energy drinks"). This naturally produces 500-800 ingredients.

**Step 3: Map to souschef shopping groups**

| Instacart Department | Instacart Aisles (examples) | Souschef Group |
|---|---|---|
| produce | fresh fruits, fresh vegetables, fresh herbs | Produce |
| meat seafood | packaged meat, fresh meat, seafood | Meat |
| dairy eggs | milk, eggs, cheese, yogurt, cream | Dairy & Eggs |
| bakery | bread, tortillas, buns rolls | Bread & Bakery |
| dry goods pasta | pasta, rice, grains, cereal | Pasta & Grains |
| spices seasonings | spices seasonings | Spices & Baking |
| condiments | oils vinegars, sauces, dressings | Condiments & Sauces |
| canned goods | canned meals beans, soup broth, canned fruit | Canned Goods |
| frozen | frozen produce, frozen meals, ice cream | Frozen |
| breakfast | cereal, granola bars, pancake mixes | Breakfast & Beverages |
| beverages | juice, water, tea, coffee | Breakfast & Beverages |
| snacks | chips, crackers, cookies, nuts | Snacks |
| deli | deli meats, prepared meals | Other |

**Step 4: Build the seed YAML**

For each ingredient, populate:
- `name`: lowercase, simple (how the family thinks of it)
- `category`: broad type (produce, protein, dairy, grain, pantry, frozen, condiment)
- `aisle`: one of the 12 shopping groups (this is what the app actually uses)
- `default_unit`: inferred from ingredient type (lb for meats, count for produce items, oz for canned/frozen, tsp for spices, cup for liquids)
- `store_pref`: default to "either" (user-specific, not something a dataset can tell us)
- `is_pantry_staple`: true for spices, oils, flour, sugar, etc.
- `root`: only set when the display name differs from the search noun (e.g., "frozen meatballs" -> root "meatballs")

**Step 5: Merge with existing 88 ingredients**

The existing seed data has family-specific preferences (store_pref, is_pantry_staple, root) that must be preserved. The new ingredients extend coverage but don't override existing entries.

### Target: ~600 ingredients across groups

| Shopping Group | Estimated Count | Notes |
|---|---|---|
| Produce | 80-100 | Fruits, vegetables, herbs, fresh items |
| Meat | 40-50 | Cuts, ground meats, poultry, seafood, deli meats |
| Dairy & Eggs | 30-40 | Milk types, cheeses, yogurts, cream, eggs |
| Bread & Bakery | 20-30 | Breads, tortillas, buns, rolls, pita, naan |
| Pasta & Grains | 30-40 | Pastas, rice types, grains, cereal, oats |
| Spices & Baking | 60-80 | Spices, herbs, flour, sugar, baking supplies |
| Condiments & Sauces | 40-50 | Oils, vinegars, sauces, dressings, honey, syrup |
| Canned Goods | 40-50 | Beans, soups, broths, canned vegetables, tomato products |
| Frozen | 30-40 | Frozen vegetables, meals, pizza, ice cream |
| Breakfast & Beverages | 20-30 | Coffee, tea, juice, cereal, pancake mix |
| Snacks | 20-30 | Chips, crackers, cookies, nuts, popcorn |
| Other | 10-20 | Miscellaneous (paper towels excluded, but things like tofu, specialty items) |

**Total: ~500-650 ingredients**

### Implementation Script

A Python script (`scripts/build_ingredient_seed.py`) would:

1. Load the Instacart CSVs
2. Filter to food departments
3. For each aisle, extract normalized ingredient names (strip brands, sizes, "organic" prefix)
4. Map aisles to souschef shopping groups
5. Assign default units based on category heuristics
6. Flag pantry staples (spices, oils, basic baking)
7. Merge with existing `seed_ingredients.yaml` (preserve existing entries)
8. Output an expanded `seed_ingredients.yaml`

Manual review pass after script: ~2-3 hours to clean up names, fix categorization errors, add `root` fields where needed.

### Alternative: Skip the Dataset, Use LLM-Generated List

Given that the Instacart dataset requires a Kaggle download and significant transformation, a pragmatic alternative is to generate the ingredient list directly using domain knowledge:

1. Start with the 88 existing ingredients
2. Expand each shopping group to cover common US grocery items
3. Cross-reference against Spoonacular's ~1,100 ingredient list (publicly documented in their API docs) for completeness
4. Have the family validate the list against their actual shopping patterns

This approach:
- No license concerns
- No data pipeline to build
- Faster (hours, not days)
- Equally accurate for the use case (we need "what do American families buy" not "every possible ingredient")

The Instacart data would primarily validate completeness rather than serve as the primary source.

### Recommended Next Step

**Go with the LLM-assisted curation approach**, using Instacart's department/aisle taxonomy as the organizational framework. Produce a `seed_ingredients_expanded.yaml` with ~600 entries, then diff against the Instacart product list for any major gaps.

The script would:
1. Read existing `seed_ingredients.yaml`
2. Generate new entries organized by shopping group
3. Validate no duplicates, consistent naming conventions
4. Output the expanded YAML

This can be done in a single session without any external data downloads.
