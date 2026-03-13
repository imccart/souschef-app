const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  // Meals
  getMeals: () => request('/meals'),
  getPastMeals: () => request('/meals/past'),
  swapMeal: (date) => request(`/meals/${date}/swap`, { method: 'POST' }),
  swapMealSmart: (date, body = {}) => request(`/meals/${date}/swap-smart`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  swapSide: (date) => request(`/meals/${date}/swap-side`, { method: 'POST' }),
  getSides: (date) => request(`/meals/${date}/sides`),
  setSide: (date, side) => request(`/meals/${date}/set-side`, {
    method: 'POST',
    body: JSON.stringify({ side }),
  }),
  toggleGrocery: (date) => request(`/meals/${date}/toggle-grocery`, { method: 'POST' }),
  setMeal: (date, recipeId) => request(`/meals/${date}/set`, {
    method: 'POST',
    body: JSON.stringify({ recipe_id: recipeId }),
  }),
  suggestMeals: () => request('/meals/suggest', { method: 'POST' }),
  freshStart: () => request('/meals/fresh-start', { method: 'POST' }),
  allToGrocery: () => request('/meals/all-to-grocery', { method: 'POST' }),
  swapDays: (dateA, dateB) => request('/meals/swap-days', {
    method: 'POST',
    body: JSON.stringify({ date_a: dateA, date_b: dateB }),
  }),
  removeMeal: (date) => request(`/meals/${date}`, { method: 'DELETE' }),
  setFreeform: (date, name) => request(`/meals/${date}/set-freeform`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  getCandidates: (date) => request(`/meals/${date}/candidates`),
  getMealHistory: () => request('/meals/history'),
  addToPool: (name) => request('/meals/add-to-pool', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),

  // Order
  getOrder: () => request('/order'),
  searchProducts: (itemName) => request(`/order/search/${encodeURIComponent(itemName)}`),
  selectProduct: (itemName, product) => request('/order/select', {
    method: 'POST',
    body: JSON.stringify({ item_name: itemName, product }),
  }),
  deselectProduct: (itemName) => request(`/order/deselect/${encodeURIComponent(itemName)}`, { method: 'POST' }),
  submitOrder: () => request('/order/submit', { method: 'POST' }),

  // Grocery
  getGrocery: () => request('/grocery'),
  addGroceryItem: (name) => request('/grocery/add', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  toggleGroceryItem: (name) => request(`/grocery/toggle/${encodeURIComponent(name)}`, { method: 'POST' }),
  recategorizeItem: (name, shoppingGroup) => request('/grocery/recategorize', {
    method: 'POST',
    body: JSON.stringify({ name, shopping_group: shoppingGroup }),
  }),
  getGrocerySuggestions: () => request('/grocery/suggestions'),
  getGroceryTrips: () => request('/grocery/trips'),
  getCarryover: () => request('/grocery/carryover'),
  getActiveTrip: () => request('/grocery/active-trip'),
  buildMyList: (carryover = [], regulars = [], pantryItems = []) => request('/grocery/build', {
    method: 'POST',
    body: JSON.stringify({ carryover, regulars, pantry_items: pantryItems }),
  }),

  // Receipt
  getReceipt: () => request('/receipt'),
  uploadReceipt: (type, content) => request('/receipt/upload', {
    method: 'POST',
    body: JSON.stringify({ type, content }),
  }),
  resolveReceiptItem: (name, status) => request('/receipt/resolve', {
    method: 'POST',
    body: JSON.stringify({ name, status }),
  }),
  closeReceipt: () => request('/receipt/close', { method: 'POST' }),
  closeNoReceipt: () => request('/receipt/close-no-receipt', { method: 'POST' }),

  // Regulars
  getRegulars: () => request('/regulars'),
  addRegular: (name, shoppingGroup, storePref) => request('/regulars', {
    method: 'POST',
    body: JSON.stringify({ name, shopping_group: shoppingGroup || '', store_pref: storePref || 'either' }),
  }),
  toggleRegular: (id) => request(`/regulars/${id}/toggle`, { method: 'POST' }),
  removeRegular: (name) => request(`/regulars/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Recipes
  getRecipes: () => request('/recipes'),
  addRecipe: (name) => request('/recipes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  deleteRecipe: (id) => request(`/recipes/${id}`, { method: 'DELETE' }),
  getRecipeIngredients: (id) => request(`/recipes/${id}/ingredients`),
  addRecipeIngredient: (id, name) => request(`/recipes/${id}/ingredients`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  removeRecipeIngredient: (recipeId, riId) => request(`/recipes/${recipeId}/ingredients/${riId}`, { method: 'DELETE' }),

  // Pantry
  getPantry: () => request('/pantry'),
  addPantryItem: (name, shoppingGroup) => request('/pantry', {
    method: 'POST',
    body: JSON.stringify({ name, shopping_group: shoppingGroup || 'Other' }),
  }),
  removePantryItem: (id) => request(`/pantry/${id}`, { method: 'DELETE' }),

  // Stores
  getStores: () => request('/stores'),
  addStore: (name, key, mode, apiType) => request('/stores', {
    method: 'POST',
    body: JSON.stringify({ name, key, mode: mode || 'in-person', api: apiType || 'none' }),
  }),
  removeStore: (key) => request(`/stores/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // Auth
  getMe: () => request('/auth/me'),
  login: (email) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // Onboarding
  getOnboardingStatus: () => request('/onboarding/status'),
  completeOnboarding: () => request('/onboarding/complete', { method: 'POST' }),

  // Learning
  getLearningSuggestions: () => request('/learning/suggestions'),
  dismissLearning: (name) => request(`/learning/dismiss/${encodeURIComponent(name)}`, { method: 'POST' }),

  // Household
  getHouseholdMembers: () => request('/household/members'),
  inviteToHousehold: (email) => request('/household/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),
  inviteToBeta: (email) => request('/beta/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),

  // Feedback
  sendFeedback: (message, page) => request('/feedback', {
    method: 'POST',
    body: JSON.stringify({ message, page }),
  }),

  // Shopping feedback
  getFeedbackPatterns: () => request('/feedback/patterns'),
  dismissFeedback: (item, meal, kind) => request('/feedback/dismiss', {
    method: 'POST',
    body: JSON.stringify({ item, meal, kind }),
  }),
  applyFeedback: (item, meal, action) => request('/feedback/apply', {
    method: 'POST',
    body: JSON.stringify({ item, meal, action }),
  }),
  getFeedbackOverrides: () => request('/feedback/overrides'),
  removeFeedbackOverride: (item, meal) => request('/feedback/overrides', {
    method: 'DELETE',
    body: JSON.stringify({ item, meal }),
  }),
}
