# Souschef Onboarding — Design Spec

## Product Context

Souschef is a meal planning and grocery shopping app for families. It automates weekly dinner planning, grocery list generation, store ordering (Kroger), and receipt reconciliation. Parent company: Aletheia (consumer transparency apps).

**Key differentiator**: This is NOT a recipe app. We don't expect users to follow intricate recipes or buy 1 tbsp of cumin. We build grocery lists the way most people actually do — a simple list of things you cross off as you buy them. The app knows that "tacos" means ground beef, tortillas, cheese, salsa. Spices, oils, and baking staples are assumed to be in the pantry already.

**Target user**: Families (2 adults, 1-2 kids). The person who plans dinners and does the grocery shopping. They want less mental load, not more.

## Current State

The current onboarding is minimal — just a recipe selection screen and a "complete" button. No explanation of the app, no guidance, no pantry/regulars setup. Users are dropped into the app cold.

## Design Goals

- **Calm and guided** — feels like a conversation, not a form. Warm, encouraging tone throughout.
- **Explain as we go** — each step tells the user what it's for and why it matters. They should understand the app's value before they start using it.
- **Defaults with encouragement** — always offer sensible defaults but actively encourage review and customization. The app works best when personalized.
- **Reassurance** — every step notes that they can always add/change things later. No pressure to get it perfect now.

## Onboarding Flow

### Step 1: Welcome

**Purpose**: Set the tone. Explain what souschef is and what it does.

**Content**:
- App name, logo, warm greeting
- "Your kitchen and meal assistant"
- Brief value prop: "We help you plan dinners, build grocery lists, and order from your favorite store — so you spend less time thinking about what's for dinner."
- Overview of the flow: "Let's get your kitchen set up. It takes about 5 minutes."
- CTA: "Let's get started"

### Step 2: Meals

**Purpose**: Build their dinner rotation.

**Framing**: "What does your family eat for dinner? Don't overthink this — just the meals you make regularly. We're not building fancy recipes, just figuring out what goes on your grocery list."

**Interaction**:
- Show the recipe library organized by category (tacos, pasta, burgers, stir fry, etc.)
- Pre-check a reasonable default set (8-10 common family meals)
- Easy to add custom meals by typing a name
- Each meal shows its ingredients (simple names: "ground beef", "taco seasoning", "tortillas" — not "1 lb 93/7 lean ground beef")
- Users can tap to review/edit ingredients
- Encourage: "The more meals you add, the better your grocery lists will be. You can always add more later."

**Key messaging**: "We keep it simple. 'Tacos' means ground beef, tortillas, cheese, and salsa. We won't ask you to buy a tablespoon of cumin — we assume you have spices on hand."

### Step 3: Sides

**Purpose**: Common side dishes that pair with meals.

**Framing**: "What about sides? These are things like corn, salad, rice, or rolls that go alongside your dinners."

**Interaction**:
- Show side library (corn on the cob, green beans, salad, rolls, mac and cheese, etc.)
- Suggest common pairings based on selected meals
- Custom sides by typing
- Same ingredient review as meals
- "Sides are optional — some meals don't need them."

### Step 4: Staples — "What's already in your kitchen?"

**Purpose**: Identify pantry items the user always has on hand, so they don't appear on the grocery list.

**Framing**: "These are things most families keep in the pantry — spices, oils, baking basics. Check off what you already have at home, and we won't put them on your grocery list."

**Interaction**:
- Checklist grouped by category (Spices, Oils & Vinegars, Baking, Condiments)
- Pre-check common defaults (salt, pepper, olive oil, flour, sugar, etc.) based on `is_pantry_staple` flag in ingredient database
- Users uncheck things they don't have
- Can add items not on the list
- "If you run out of something, you can always add it to your grocery list manually."

**What this sets up**: Items checked here go into the user's "Keep on hand" pantry. The grocery list builder skips these ingredients automatically.

### Step 5: Regulars — "What else is always in your cart?"

**Purpose**: Grocery items bought every week that aren't tied to specific meals.

**Framing**: "Beyond dinner ingredients, what do you pick up every week? Think drinks, snacks, breakfast, lunch stuff, and household items."

**Interaction**:
- Categorized suggestions:
  - **Dairy & Eggs**: milk, eggs, yogurt, cheese
  - **Bread & Bakery**: bread, bagels, english muffins
  - **Breakfast**: cereal, oatmeal, granola bars
  - **Drinks**: juice, coffee, sparkling water
  - **Snacks**: chips, crackers, fruit snacks
  - **Lunch**: deli meat, sandwich bread, chips
  - **Household**: paper towels, trash bags, dish soap
  - **Personal care**: (user adds their own)
  - **Pets**: (user adds their own)
- Check what applies, add custom items
- "These show up as 'regulars' — one tap to add them all to your grocery list each week."

### Step 6: Store Setup

**Purpose**: Connect their grocery store for online ordering.

**Framing**: "Where do you shop? Connect your store to send your grocery list straight to your cart."

**Interaction**:
- Store selection (Kroger currently, more coming)
- OAuth connection flow
- Store/location selection by zip code
- Pickup vs delivery preference
- "You can skip this and set it up later in your account."

### Step 7: App Tour

**Purpose**: Orient the user before releasing them into the app.

**Framing**: "You're all set! Here's a quick look at where everything lives."

**Interaction**:
- Guided overlay/popup tour highlighting each section:
  - **Plan** — "Your dinners for the week. Tap a day to pick a meal, drag to rearrange."
  - **Grocery** — "Everything you need to buy. Tap the hamburger icon for options. Swipe to remove."
  - **Order** — "Search and pick products from your store. Send your cart when ready."
  - **Receipt** — "Upload your receipt to confirm what you bought and rate products."
  - **Kitchen** (bent spoon icon) — "Your meals, sides, staples, and product ratings."
  - **Account** (apron icon) — "Store connections, household, and settings."
- Each step: brief description + highlight of the UI element
- "Skip tour" option for impatient users
- Final: "Welcome to souschef! Your first week of meals is ready."

## Tone & Voice

- Warm, casual, encouraging
- First person plural ("we") — souschef is a helper, not a tool
- Never condescending or overly instructional
- Short sentences, simple words
- Humor is ok if subtle (the app has cooking puns in loading states)

## Technical Notes

- Current onboarding state tracked via `onboarding_completed` flag on user
- Recipe library exists (`user_id='__library__'`) — deep-copied to user on selection
- Ingredient database has 604 items with `is_pantry_staple` flag (66 flagged as staples)
- Regulars and pantry systems already exist — onboarding just needs to populate them
- Store OAuth flow already implemented for Kroger

## What Comes After Onboarding

User lands on the Plan page with:
- Their selected meals suggested for the week (auto-filled based on day themes)
- Grocery list auto-populated from meal ingredients (minus staples)
- Regulars ready to add with one tap
- Store connected (if they chose to)

## Open Questions

- How many meals should we pre-select as defaults?
- Should we suggest specific meals for specific days (using day themes)?
- Should the tour be skippable per-step or all-or-nothing?
- Mobile vs desktop — does the tour adapt?
- Should there be a "redo onboarding" option in settings?
