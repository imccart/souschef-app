# Souschef Onboarding — Full Design & Implementation Spec v2

## Product Context

Souschef is a meal planning and grocery shopping app for families. It automates weekly dinner planning, grocery list generation, store ordering (Kroger), and receipt reconciliation. Parent company: Aletheia (consumer transparency apps).

**Key differentiator**: This is NOT a recipe app. We don't expect users to follow intricate recipes or buy 1 tbsp of cumin. We build grocery lists the way most people actually do — a simple list of things you cross off as you buy them. The app knows that "tacos" means ground beef, tortillas, cheese, salsa. Spices, oils, and baking staples are assumed to be in the pantry already.

**Target user**: Families (2 adults, 1-2 kids). The person who plans dinners and does the grocery shopping. They want less mental load, not more.

---

## Design Goals

- **Calm and guided** — feels like a conversation, not a form. Warm, encouraging tone throughout.
- **Explain as we go** — each step tells the user what it's for and why it matters.
- **Defaults with encouragement** — always offer sensible defaults but actively encourage review and customization.
- **Reassurance** — every step notes they can always add/change things later. No pressure to get it perfect now.
- **Playful** — onboarding has more personality than the main app. Clippy the paperclip chef is the guide.

---

## Clippy — The Onboarding Guide

### Assets
- `clippy-chef.png` — main Clippy character (paperclip with chef's toque)
- `mouse-chef.png` — mouse with chef's hat (used in final reveal)
- **Both images need background removal before use** — use remove.bg or equivalent

### Placement
- Sits bottom-right of each onboarding screen on mobile
- Bottom-right panel on desktop
- Never obscures main content
- Speech bubble appears above Clippy's head, tail pointing down toward him

### Speech Bubble Style
- Background: white
- Border: `--brown` (#8B6F5E), 1.5px, border-radius 12px
- Font: DM Sans, 14px, `--dark` (#2C2420)
- Tail pointing down toward Clippy
- Max width: 260px on mobile

### Clippy Animations (CSS on PNG)
- **Idle:** gentle wobble side to side, continuous, subtle (±2deg rotation, 3s ease-in-out infinite)
- **Hat tip:** every 6 seconds, slight tilt left then back (±12deg, smooth ease)
- No per-frame blink needed — the illustration is expressive enough

### Mouse Reveal — Final Step Only
- Mouse starts hidden behind/below Clippy
- Slides out from behind Clippy's base, moves right across screen
- Pauses briefly, then scurries off screen right
- Clippy does a slight lean/wave simultaneously
- This is the final moment before the user enters the app

### Clippy Quips — One Per Step
Each step has a speech bubble with Clippy's commentary. These are the locked quips:

1. **Welcome:** *"Looks like you're trying to make dinner. 📎"*
2. **Meals + Sides:** *"It looks like you're trying to cook from scratch! Would you like me to open the 'Recipe vs. Reality' template, or should I just pre-load a shortcut to UberEats for 7:00 PM Thursday?"*
3. **Staples:** *"It looks like you're listing 'Flour.' I've noticed you haven't opened that bag since the Great Sourdough Craze of 2020. Should I change the quantity to 'One Small Bag for Dusting' or are we still pretending we're bakers?"*
4. **Regulars:** *"It looks like you're making a list of 'The Regulars.' Should I go ahead and hide the 'Vegetable' section since we both know how that ends?"*
5. **Store:** *"It looks like you're trying to Link an Account. Should I also link your credit card, your home address, and your deepest dietary secrets to the cloud? It makes the 'Buy Again' button so much shinier!"*
6. **Tour:** *"You're all done! Would you like me to minimize into a tiny, judgmental dot, or shall I transform into a spinning hourglass until you come back with snacks?"* → mouse reveal

---

## Onboarding Flow

### Progress Indicator
- Thin progress bar or dot indicators at top of screen
- Shows current step out of total
- Warm terracotta (`--accent`) for completed/active

### Transitions
- Smooth directional slide left-to-right between steps
- No jarring cuts

---

### Step 1: Welcome

**Purpose:** Set the tone. Explain what Souschef is and what it does.

**Framing sentence at top:** *"Tell us how your household eats and we'll handle the rest."*

**Content:**
- Souschef logo + ladle animation (existing welcome screen animation)
- Warm greeting
- Brief value prop: *"We help you plan dinners, build grocery lists, and order from your favorite store — so you spend less time thinking about what's for dinner."*
- *"Let's get your kitchen set up. It takes about 5 minutes."*
- CTA: **"Let's get started"**

**Clippy quip:** *"Looks like you're trying to make dinner. 📎"*

---

### Step 2: Meals + Sides (Combined)

**Purpose:** Build their dinner rotation and common sides in one step.

**Header:** *"What does your family eat?"*

**Helper text:** *"Pick the meals your family makes regularly. We'll use these to build your grocery list. Don't overthink it — you can always add more later."*

**Layout:**
- **Mobile:** Two stacked sections — "Meals" on top, "Sides" below, each with clear label
- **Desktop:** Two columns side by side — "Meals" left, "Sides" right

**Meals grid:**
- Tap-to-toggle tiles (grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)))
- Selected state: warm fill (`--accent-bg`) with terracotta border, subtle bounce animation on select
- Pre-select 8-10 sensible defaults from the library
- Ingredient preview: small expandable chip appears instantly below tile when selected — shows simple ingredient names (e.g. "ground beef, tortillas, cheese, salsa")
- Freeform input at bottom: "Add your own meal..." — creates a stub recipe

**Sides grid:**
- Same tap-to-toggle pattern
- No pre-selections — user picks what applies
- Freeform input at bottom: "Add your own side..."

**Key messaging:** *"We keep it simple. 'Tacos' means ground beef, tortillas, cheese, and salsa. We won't ask you to buy a tablespoon of cumin."*

**Skip:** "Skip for now" — moves to next step without selecting anything

**Clippy quip:** *"It looks like you're trying to cook from scratch! Would you like me to open the 'Recipe vs. Reality' template, or should I just pre-load a shortcut to UberEats for 7:00 PM Thursday?"*

---

### Step 3: Staples — "What's already in your kitchen?"

**Purpose:** Identify pantry items the user always has on hand.

**Header:** *"What's already in your kitchen?"*

**Helper text:** *"Things you always have at home. We'll leave these off your grocery list."*

**Interaction:**
- Checklist grouped by category: Spices, Oils & Vinegars, Baking, Condiments
- Pre-check common defaults based on `is_pantry_staple` flag (salt, pepper, olive oil, flour, sugar, etc.)
- Users uncheck things they don't have
- Can add items not on the list
- *"If you run out of something, you can always add it to your grocery list manually."*

**Skip:** "Skip for now"

**Clippy quip:** *"It looks like you're listing 'Flour.' I've noticed you haven't opened that bag since the Great Sourdough Craze of 2020. Should I change the quantity to 'One Small Bag for Dusting' or are we still pretending we're bakers?"*

---

### Step 4: Regulars — "What's always in your cart?"

**Purpose:** Grocery items bought every week not tied to specific meals.

**Header:** *"What's always in your cart?"*

**Helper text:** *"Things you buy almost every trip. These go on your list automatically."*

**Interaction:**
- Categorized suggestions:
  - Dairy & Eggs: milk, eggs, yogurt, cheese
  - Bread & Bakery: bread, bagels, english muffins
  - Breakfast: cereal, oatmeal, granola bars
  - Drinks: juice, coffee, sparkling water
  - Snacks: chips, crackers, fruit snacks
  - Lunch: deli meat, sandwich bread
  - Household: paper towels, trash bags, dish soap
  - Pets: (user adds their own)
- Check what applies, add custom items
- *"These show up every week — one tap to add them all to your grocery list."*

**Skip:** "Skip for now"

**Clippy quip:** *"It looks like you're making a list of 'The Regulars.' Should I go ahead and hide the 'Vegetable' section since we both know how that ends?"*

---

### Step 5: Store Setup

**Purpose:** Connect their grocery store for online ordering.

**Header:** *"Where do you order groceries?"*

**Helper text:** *"Connect your store to send your grocery list straight to your cart."*

**Interaction:**
- Kroger OAuth connection (existing flow)
- Store/location selection by zip code
- Pickup vs delivery preference
- *"You can skip this and set it up later in Online Ordering."*

**Skip:** "Skip for now" — explicitly skippable, don't block progress

**Clippy quip:** *"It looks like you're trying to Link an Account. Should I also link your credit card, your home address, and your deepest dietary secrets to the cloud? It makes the 'Buy Again' button so much shinier!"*

---

### Step 6: App Tour

**Purpose:** Orient the user before releasing them into the app.

**Header:** *"Here's where everything lives."*

**Skip behavior:** Single **"Skip tour"** button exits the entire tour at once — no per-step skip. The tour itself is already step-by-step so per-step skip would be redundant.

**Tour stops (6 steps):**
1. **Plan** — *"Your dinners for the week. Tap a day to pick a meal."*
2. **Grocery** — *"Everything you need to buy, organized by aisle."*
3. **Order** — *"Pick products from your store and send your cart."*
4. **Receipt** — *"Upload your receipt to track what you bought."*
5. **Kitchen (bent spoon)** — *"Your meals, sides, and staples. Your kitchen."*
6. **Account (apron icon)** — *"Store connections, household sharing, and settings."*

**Final moment:**
- Clippy quip: *"You're all done! Would you like me to minimize into a tiny, judgmental dot, or shall I transform into a spinning hourglass until you come back with snacks?"*
- Mouse slides out from behind Clippy, pauses, scurries off screen right
- Clippy waves
- Transition to Plan tab

**Clippy disappears after onboarding — never seen again in the main app.**

---

## Baseline Time Survey (Step 2 — after meal selection)

After the user selects their meals, show a single inline question before advancing:

*"Before Souschef, how long did meal planning and grocery shopping take each week?"*
- Less than 30 minutes
- 30–60 minutes
- 1–2 hours
- More than 2 hours

Store as `onboarding_time_baseline` in user settings. Used later for value reporting.

---

## After Onboarding

User lands on Plan tab with:
- Selected meals suggested for the week
- Grocery list preview populated from meal ingredients (minus staples)
- Regulars ready to add with one tap
- Store connected (if they chose to)
- First grocery list banner (one-time): *"This list was built from your meals, minus what's in your pantry and regulars."* — dismissible, never shows again

---

## Tone & Voice

- Warm, casual, encouraging
- First person plural ("we") — souschef is a helper, not a tool
- Never condescending
- Short sentences, simple words
- Clippy is wry and self-aware — classic Clippy energy, not mean

---

## Technical Notes

- Onboarding state tracked via `onboarding_completed` flag on user
- Recipe library exists (`user_id='__library__'`) — deep-copied to user on selection
- Ingredient database has 604 items with `is_pantry_staple` flag (66 flagged as staples)
- Regulars and pantry systems already exist — onboarding populates them
- Store OAuth flow already implemented for Kroger
- "Reset my kitchen / Redo onboarding" option to be added in Preferences (About You section)
- Session time tracking per tab to be added alongside onboarding for value reporting

---

## Open Questions (Resolved)

- Pre-select 8-10 meals as defaults ✓
- Don't suggest specific meals for specific days during onboarding ✓
- Tour skippable all-at-once via single "Skip tour" button ✓
- "Redo onboarding" option in Preferences ✓
- Meals and Sides combined into one step ✓
