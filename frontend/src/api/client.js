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
  getSides: (date) => request(`/meals/${date}/sides`),
  setSide: (date, sides) => request(`/meals/${date}/set-side`, {
    method: 'POST',
    body: JSON.stringify({ sides }),
  }),
  toggleGrocery: (date) => request(`/meals/${date}/toggle-grocery`, { method: 'POST' }),
  updateMealNote: (date, notes) => request(`/meals/${date}/notes`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  }),
  setMeal: (date, recipeId, sides) => request(`/meals/${date}/set`, {
    method: 'POST',
    body: JSON.stringify({ recipe_id: recipeId, sides }),
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
  searchProducts: (itemName, fulfillment, start) => {
    const params = new URLSearchParams()
    if (fulfillment) params.set('fulfillment', fulfillment)
    if (start > 1) params.set('start', start)
    const qs = params.toString()
    return request(`/order/search/${encodeURIComponent(itemName)}${qs ? `?${qs}` : ''}`)
  },
  selectProduct: (itemName, product, quantity) => request('/order/select', {
    method: 'POST',
    body: JSON.stringify({ item_name: itemName, product, quantity: quantity || 1 }),
  }),
  deselectProduct: (itemName) => request(`/order/deselect/${encodeURIComponent(itemName)}`, { method: 'POST' }),
  submitOrder: (krogerUserId) => request('/order/submit', {
    method: 'POST',
    body: JSON.stringify(krogerUserId ? { kroger_user_id: krogerUserId } : {}),
  }),

  // Grocery
  getGrocery: () => request('/grocery'),
  addGroceryItem: (name) => request('/grocery/add', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  toggleGroceryItem: (name) => request(`/grocery/toggle/${encodeURIComponent(name)}`, { method: 'POST' }),
  updateGroceryNote: (name, notes) => request('/grocery/note', {
    method: 'POST',
    body: JSON.stringify({ name, notes }),
  }),
  recategorizeItem: (name, shoppingGroup) => request('/grocery/recategorize', {
    method: 'POST',
    body: JSON.stringify({ name, shopping_group: shoppingGroup }),
  }),
  getGrocerySuggestions: () => request('/grocery/suggestions'),
  haveItGroceryItem: (name) => request(`/grocery/have-it/${encodeURIComponent(name)}`, { method: 'POST' }),
  removeGroceryItem: (name) => request(`/grocery/item/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  addRegulars: (selected) => request('/grocery/add-regulars', {
    method: 'POST',
    body: JSON.stringify({ selected }),
  }),
  addPantryItems: (selected) => request('/grocery/add-pantry', {
    method: 'POST',
    body: JSON.stringify({ selected }),
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
  getFavorites: () => request('/product/favorites'),
  rateProduct: (upc, rating, productDescription, { brand, productKey } = {}) => request('/product/rate', {
    method: 'POST',
    body: JSON.stringify({
      upc: upc || '',
      rating,
      product_description: productDescription || '',
      brand: brand || '',
      product_key: productKey || '',
    }),
  }),

  // Staples
  recategorizeStaple: (name, type, id, shoppingGroup) => request('/staples/recategorize', {
    method: 'POST',
    body: JSON.stringify({ name, type, id, shopping_group: shoppingGroup }),
  }),

  // Regulars
  getRegulars: () => request('/regulars'),
  addRegular: (name, shoppingGroup, storePref) => request('/regulars', {
    method: 'POST',
    body: JSON.stringify({ name, shopping_group: shoppingGroup || '', store_pref: storePref || 'either' }),
  }),
  toggleRegular: (id) => request(`/regulars/${id}/toggle`, { method: 'POST' }),
  removeRegular: (id) => request(`/regulars/${id}`, { method: 'DELETE' }),

  // Recipes
  getRecipes: () => request('/recipes'),
  addRecipe: (name, recipeType) => request('/recipes', {
    method: 'POST',
    body: JSON.stringify({ name, recipe_type: recipeType || 'meal' }),
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

  // Kroger
  getKrogerStatus: () => request('/kroger/status'),
  connectKroger: () => request('/kroger/connect'),
  disconnectKroger: () => request('/kroger/disconnect', { method: 'POST' }),
  searchKrogerLocations: (zip) => request(`/kroger/locations?zip=${encodeURIComponent(zip)}`),
  getKrogerLocation: () => request('/kroger/location'),
  setKrogerLocation: (locationId) => request('/kroger/location', { method: 'POST', body: JSON.stringify({ location_id: locationId }) }),
  getKrogerHouseholdAccounts: () => request('/kroger/household-accounts'),
  setStoreHouseholdAccess: (allow) => request('/store/allow-household', {
    method: 'POST',
    body: JSON.stringify({ allow }),
  }),

  // Auth
  getMe: () => request('/auth/me'),
  login: (email) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // Account
  updateAccount: (data) => request('/account/update', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // Onboarding
  getOnboardingStatus: () => request('/onboarding/status'),
  completeOnboarding: () => request('/onboarding/complete', { method: 'POST' }),
  getOnboardingLibrary: () => request('/onboarding/library'),
  selectOnboardingRecipes: (mealIds, sideIds, customMeals, customSides) => request('/onboarding/select-recipes', {
    method: 'POST',
    body: JSON.stringify({ meal_ids: mealIds, side_ids: sideIds, custom_meals: customMeals, custom_sides: customSides }),
  }),

  // Learning
  getLearningSuggestions: () => request('/learning/suggestions'),
  dismissLearning: (name) => request(`/learning/dismiss/${encodeURIComponent(name)}`, { method: 'POST' }),

  // Household
  getHouseholdMembers: () => request('/household/members'),
  inviteToHousehold: (email) => request('/household/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),
  getPendingInvite: () => request('/household/pending-invite'),
  acceptInvite: () => request('/household/accept-invite', { method: 'POST' }),
  declineInvite: () => request('/household/decline-invite', { method: 'POST' }),
  inviteToBeta: (email) => request('/beta/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),

  // Community data
  submitCommunityData: (dataType, subject, suggestedValue) => request('/community-data', {
    method: 'POST',
    body: JSON.stringify({ data_type: dataType, subject, suggested_value: suggestedValue }),
  }),

  // Feedback
  sendFeedback: (message, page) => request('/feedback', {
    method: 'POST',
    body: JSON.stringify({ message, page }),
  }),
  getFeedbackResponses: () => request('/feedback/responses'),
  dismissFeedbackResponse: (id) => request(`/feedback/${id}/dismiss`, { method: 'POST' }),

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
