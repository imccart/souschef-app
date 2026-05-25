const BASE = '/api'

const TOAST_MESSAGES = [
  "Lost the ticket — give it another tap.",
  "Couldn't reach the kitchen — try again.",
  "Stove misfired — one more try.",
  "That order got dropped — try again.",
  "Ticket didn't print — give it another tap.",
  "Burner went out — one more try.",
]

let _offlineDetected = false

function emitToast() {
  // Don't spam toasts when fully offline — the offline banner handles that
  if (!navigator.onLine || _offlineDetected) {
    if (!_offlineDetected) {
      _offlineDetected = true
      window.dispatchEvent(new Event('mealrunner-offline'))
      window.addEventListener('online', () => { _offlineDetected = false }, { once: true })
    }
    return
  }
  const msg = TOAST_MESSAGES[Math.floor(Math.random() * TOAST_MESSAGES.length)]
  window.dispatchEvent(new CustomEvent('mealrunner-toast', { detail: msg }))
}

// Paths where errors are handled by the caller (no toast)
const SILENT_PATHS = ['/auth/me', '/auth/login', '/auth/google', '/auth/google-client-id', '/tip/stripe-config']

async function request(path, options = {}) {
  const silent = SILENT_PATHS.some(p => path.startsWith(p))
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch (err) {
    if (!silent) {
      // Network error likely means offline
      _offlineDetected = true
      window.dispatchEvent(new Event('mealrunner-offline'))
      window.addEventListener('online', () => { _offlineDetected = false }, { once: true })
    }
    throw err
  }
  if (!res.ok) {
    if (!silent) emitToast()
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  // Meals
  getMeals: () => request('/meals'),
  getPastMeals: () => request('/meals/past'),
  swapMeal: (date) => request(`/meals/${date}/swap`, { method: 'POST' }),
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
  deletePreference: (upc) => request(`/order/preference/${encodeURIComponent(upc)}`, { method: 'DELETE' }),
  getPriceComparison: () => request('/order/price-comparison'),
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
  toggleGroceryItem: (id) => request(`/grocery/toggle/${id}`, { method: 'POST' }),
  updateGroceryNote: (id, notes) => request('/grocery/note', {
    method: 'POST',
    body: JSON.stringify({ id, notes }),
  }),
  updateGroceryQuantity: (id, quantity) => request('/grocery/quantity', {
    method: 'POST',
    body: JSON.stringify({ id, quantity }),
  }),
  recategorizeItem: (id, shoppingGroup) => request('/grocery/recategorize', {
    method: 'POST',
    body: JSON.stringify({ id, shopping_group: shoppingGroup }),
  }),
  getGrocerySuggestions: () => request('/grocery/suggestions'),
  haveItGroceryItem: (id) => request(`/grocery/have-it/${id}`, { method: 'POST' }),
  removeGroceryItem: (id) => request(`/grocery/item/${id}`, { method: 'DELETE' }),
  undoGroceryItem: (id) => request(`/grocery/undo/${id}`, { method: 'POST' }),
  buyElsewhere: (id) => request(`/grocery/buy-elsewhere/${id}`, { method: 'POST' }),
  addStaplesToGrocery: (selected, mode) => request('/grocery/add-staples', {
    method: 'POST',
    body: JSON.stringify({ selected, mode }),
  }),

  // Receipt
  getReceipt: () => request('/receipt'),
  uploadReceipt: (type, content) => request('/receipt/upload', {
    method: 'POST',
    body: JSON.stringify({ type, content }),
  }),
  resolveReceiptItem: (id, status) => request('/receipt/resolve', {
    method: 'POST',
    body: JSON.stringify({ id, status }),
  }),
  matchExtra: (extraName, groceryId, receiptPrice, receiptUpc) => request('/receipt/match-extra', {
    method: 'POST',
    body: JSON.stringify({ extra_name: extraName, grocery_id: groceryId, receipt_price: receiptPrice, receipt_upc: receiptUpc }),
  }),
  dismissExtra: (name) => request('/receipt/dismiss-extra', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }),
  getPurchases: () => request('/purchases'),
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

  // Staples (unified — replaces the old regulars + pantry endpoints).
  // mode is 'every_trip' or 'keep_on_hand'.
  getStaples: (mode) => request(`/staples${mode ? `?mode=${mode}` : ''}`),
  addStaple: (name, mode, shoppingGroup, storePref) => request('/staples', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mode,
      shopping_group: shoppingGroup || '',
      store_pref: storePref || 'either',
    }),
  }),
  updateStaple: (id, { mode, shoppingGroup } = {}) => request(`/staples/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(mode !== undefined ? { mode } : {}),
      ...(shoppingGroup !== undefined ? { shopping_group: shoppingGroup } : {}),
    }),
  }),
  removeStaple: (id) => request(`/staples/${id}`, { method: 'DELETE' }),

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
  updateRecipeNotes: (id, notes) => request(`/recipes/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  }),

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
  setKrogerLocation: (locationId, zipCode) => request('/kroger/location', { method: 'POST', body: JSON.stringify({ location_id: locationId, zip_code: zipCode || '' }) }),
  getKrogerHouseholdAccounts: () => request('/kroger/household-accounts'),
  getNearbyStores: () => request('/stores/nearby'),
  saveNearbyStores: (stores) => request('/stores/nearby', { method: 'POST', body: JSON.stringify({ stores }) }),
  setStoreHouseholdAccess: (allow) => request('/store/allow-household', {
    method: 'POST',
    body: JSON.stringify({ allow }),
  }),

  // Auth
  getMe: () => request('/auth/me'),
  login: (email) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  googleClientId: () => request('/auth/google-client-id'),
  googleAuth: (credential) => request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // Account
  updateAccount: (data) => request('/account/update', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  acceptTos: (version = '1.0') => request('/account/accept-tos', {
    method: 'POST',
    body: JSON.stringify({ version }),
  }),

  // Onboarding
  getOnboardingStatus: () => request('/onboarding/status'),
  completeOnboarding: () => request('/onboarding/complete', { method: 'POST' }),
  getOnboardingLibrary: () => request('/onboarding/library'),
  selectOnboardingRecipes: (mealIds, sideIds, customMeals, customSides) => request('/onboarding/select-recipes', {
    method: 'POST',
    body: JSON.stringify({ meal_ids: mealIds, side_ids: sideIds, custom_meals: customMeals, custom_sides: customSides }),
  }),
  getOnboardingStaples: () => request('/onboarding/staples'),
  saveOnboardingStaples: (names, mode) => request('/onboarding/save-staples', {
    method: 'POST',
    body: JSON.stringify({ names, mode }),
  }),
  saveTimeBaseline: (value) => request('/onboarding/time-baseline', {
    method: 'POST',
    body: JSON.stringify({ value }),
  }),
  saveHomeZip: (zip) => request('/settings/home-zip', {
    method: 'POST',
    body: JSON.stringify({ zip }),
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
  removeHouseholdMember: (userId) => request(`/household/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  inviteToBeta: (email) => request('/beta/invite', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),

  // Community data
  submitCommunityData: (dataType, subject, suggestedValue) => request('/community-data', {
    method: 'POST',
    body: JSON.stringify({ data_type: dataType, subject, suggested_value: suggestedValue }),
  }),

  // Price tracking settings
  getPriceTracking: () => request('/settings/price-tracking'),
  setPriceTracking: (settings) => request('/settings/price-tracking', {
    method: 'POST',
    body: JSON.stringify(settings),
  }),

  // Price insights
  getBestDay: (scope = 'trip') => request(`/price-tracking/best-day?scope=${scope}`),
  getBasketTrend: () => request('/price-tracking/basket-trend'),

  // Feedback
  sendFeedback: (message, page) => request('/feedback', {
    method: 'POST',
    body: JSON.stringify({ message, page }),
  }),
  getFeedbackResponses: () => request('/feedback/responses'),
  dismissFeedbackResponse: (id) => request(`/feedback/${id}/dismiss`, { method: 'POST' }),

  // Admin feedback
  getAdminMetrics: () => request('/admin/metrics'),
  getAdminDetail: (key) => request(`/admin/detail/${key}`),
  approveWaitlist: (email) => request('/admin/waitlist/approve', { method: 'POST', body: JSON.stringify({ email }) }),
  dismissWaitlist: (email) => request('/admin/waitlist/dismiss', { method: 'POST', body: JSON.stringify({ email }) }),
  cancelInvite: (id) => request('/admin/invite/cancel', { method: 'POST', body: JSON.stringify({ id }) }),
  revokeUser: (email) => request('/admin/user/revoke', { method: 'POST', body: JSON.stringify({ email }) }),
  deleteUserAdmin: (email) => request('/admin/user/delete', { method: 'POST', body: JSON.stringify({ email }) }),
  deleteAccount: () => request('/account/delete', { method: 'POST' }),
  getAllFeedback: () => request('/feedback/all'),
  respondToFeedback: (id, response) => request(`/feedback/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ response }),
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

  // Tip jar
  // Returns parsed body whether response is 200 or 503 (the 503 carries
  // {ok: false, fake: bool} which the icon-gating code needs to distinguish
  // staging-fake-mode from production-not-yet-wired).
  getStripeConfig: async () => {
    const res = await fetch(`${BASE}/tip/stripe-config`)
    try { return await res.json() } catch { return { ok: false, fake: false } }
  },
  createTipCheckoutSession: (mode, amountCents) => request('/tip/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ mode, amount_cents: amountCents }),
  }),
  getTipHistory: () => request('/tip/history'),
  getTipPortalUrl: () => request('/tip/portal', { method: 'POST' }),
  // Fake-mode only — lets us click through on staging before Stripe is wired.
  // Returns 404 in production / when STRIPE_SECRET_KEY is configured.
  devCompleteTipSession: (sessionId) => request('/tip/dev-complete-session', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  }),
}
