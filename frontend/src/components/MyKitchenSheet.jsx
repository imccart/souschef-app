import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import AutocompleteInput from './AutocompleteInput'
import { compareKey } from '../utils/compareKey'
import ls from '../shared/lists.module.css'
import styles from './MyKitchenSheet.module.css'

function _getWeekLabel(dateStr) {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d)
    monday.setDate(diff)
    return 'Week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

const CUISINE_OPTS = [
  ['italian', 'Italian'], ['mexican', 'Mexican'], ['asian', 'Asian'],
  ['american', 'American'], ['', 'Other'],
]

export default function MyKitchenSheet({ onClose }) {
  const [activeTab, setActiveTab] = useState('meals')
  const [detailRecipe, setDetailRecipe] = useState(null)
  const [cuisineVal, setCuisineVal] = useState('')
  const [recipes, setRecipes] = useState(null)
  // staples is one list with `mode: 'every_trip' | 'keep_on_hand'` per row.
  // Replaces the old separate regulars + pantry state — same UX, one source.
  const [staples, setStaples] = useState(null)
  const [allIngredients, setAllIngredients] = useState(null)

  // Meals/Sides add state
  const [addRecipeText, setAddRecipeText] = useState('')
  const [addSideText, setAddSideText] = useState('')
  const [mealDupe, setMealDupe] = useState(false)
  const [sideDupe, setSideDupe] = useState(false)
  const [newRecipeId, setNewRecipeId] = useState(null)

  // Staples add state
  const [addStapleText, setAddStapleText] = useState('')
  const [showStapleInfo, setShowStapleInfo] = useState(false)
  const [recatStaple, setRecatStaple] = useState(null) // { name, id }
  const [pendingStaple, setPendingStaple] = useState(null) // name waiting for mode choice

  // History state (replaces Favorites)
  const [purchases, setPurchases] = useState(null)

  // Detail view state
  const [detailIngredients, setDetailIngredients] = useState(null)
  const [detailAddText, setDetailAddText] = useState('')
  const [renamed, setRenamed] = useState(null)
  const [cookingNotes, setCookingNotes] = useState('')
  const [stapleSuggestion, setStapleSuggestion] = useState(null)

  const loadStaples = () =>
    api.getStaples().then(data => setStaples(data.staples)).catch(() => setStaples([]))

  useEffect(() => {
    api.getRecipes().then(data => setRecipes(data.recipes)).catch(() => setRecipes([]))
    loadStaples()
    api.getGrocerySuggestions().then(data => setAllIngredients(data.suggestions)).catch(() => {})
    api.getPurchases().then(data => setPurchases(data.purchases || [])).catch(() => setPurchases([]))
  }, [])

  // Load ingredients when entering detail view
  useEffect(() => {
    if (detailRecipe) {
      setDetailIngredients(null)
      setDetailAddText('')
      setRenamed(null)
      setCookingNotes('')
      setStapleSuggestion(null)
      setCuisineVal(detailRecipe.cuisine || '')
      api.getRecipeIngredients(detailRecipe.id)
        .then(data => {
          setDetailIngredients(data.ingredients)
          setCookingNotes(data.cooking_notes || '')
        })
        .catch(() => setDetailIngredients([]))
    }
  }, [detailRecipe])

  // Auto-expand newly added recipe
  useEffect(() => {
    if (newRecipeId && recipes) {
      const r = recipes.find(rec => rec.id === newRecipeId)
      if (r) {
        setDetailRecipe(r)
        setNewRecipeId(null)
      }
    }
  }, [newRecipeId, recipes])

  const handleAddRecipe = async (e) => {
    e.preventDefault()
    if (!addRecipeText.trim() || mealDupe) return
    try {
      const result = await api.addRecipe(addRecipeText.trim())
      setAddRecipeText('')
      setMealDupe(false)
      if (result.id) setNewRecipeId(result.id)
      const data = await api.getRecipes()
      setRecipes(data.recipes)
    } catch { /* ignore */ }
  }

  const handleAddSide = async (e) => {
    e.preventDefault()
    if (!addSideText.trim() || sideDupe) return
    try {
      const result = await api.addRecipe(addSideText.trim(), 'side')
      setAddSideText('')
      setSideDupe(false)
      if (result.id) setNewRecipeId(result.id)
      const data = await api.getRecipes()
      setRecipes(data.recipes)
    } catch { /* ignore */ }
  }

  const handleRemoveRecipe = async (id) => {
    try {
      const result = await api.deleteRecipe(id)
      if (!result.ok) {
        alert(result.error || 'Cannot remove this recipe')
        return
      }
      if (detailRecipe && detailRecipe.id === id) setDetailRecipe(null)
      const data = await api.getRecipes()
      setRecipes(data.recipes)
    } catch { /* ignore */ }
  }

  // Detail view ingredient handlers
  const handleAddIngredient = async (name) => {
    if (!name.trim() || !detailRecipe) return
    try {
      const result = await api.addRecipeIngredient(detailRecipe.id, name.trim())
      setDetailAddText('')
      if (result.renamed_from) {
        setRenamed({ from: result.renamed_from, to: result.name })
        setTimeout(() => setRenamed(null), 4000)
      }
      if (result.suggest_staple) {
        setStapleSuggestion(result.suggest_staple)
      }
      const data = await api.getRecipeIngredients(detailRecipe.id)
      setDetailIngredients(data.ingredients)
    } catch { /* ignore */ }
  }

  const handleRemoveIngredient = async (riId) => {
    if (!detailRecipe) return
    try {
      await api.removeRecipeIngredient(detailRecipe.id, riId)
      const data = await api.getRecipeIngredients(detailRecipe.id)
      setDetailIngredients(data.ingredients)
    } catch { /* ignore */ }
  }

  // Staples handlers
  const handleAddStaple = (name) => {
    if (!name.trim()) return
    setPendingStaple(name.trim())
    setAddStapleText('')
  }

  // mode is 'every_trip' (Every trip) or 'keep_on_hand' (Keep on hand).
  const handleConfirmStaple = async (mode) => {
    if (!pendingStaple) return
    try {
      await api.addStaple(pendingStaple, mode)
      await loadStaples()
    } catch { /* ignore */ }
    setPendingStaple(null)
  }

  const handleRemoveStaple = async (id) => {
    try {
      await api.removeStaple(id)
      await loadStaples()
    } catch { /* ignore */ }
  }

  // Mode flip — replaces the old "Move to pantry" / "Move to regulars"
  // delete-and-add dance with a single PATCH that toggles the mode column.
  const handleSetStapleMode = async (id, mode) => {
    try {
      await api.updateStaple(id, { mode })
      await loadStaples()
    } catch { /* ignore */ }
  }

  const handleRatePurchase = async (item, rating) => {
    const upc = item.upc || ''
    const desc = item.receipt_item || item.product_name || item.name
    const brand = item.brand || item.product_brand || ''
    const productKey = item.product_key || ''
    try {
      await api.rateProduct(upc, rating, desc, { brand, productKey })
      setPurchases(prev => (prev || []).map(p =>
        p.product_key === productKey ? { ...p, rating } : p
      ))
    } catch { /* ignore */ }
  }

  // Build unified staples list
  const STAPLE_GROUPS = [
    'Produce', 'Meat', 'Dairy & Eggs', 'Bread & Bakery',
    'Pasta & Grains', 'Spices & Baking', 'Condiments & Sauces',
    'Canned Goods', 'Frozen', 'Breakfast & Beverages', 'Snacks',
    'Personal Care', 'Household', 'Cleaning', 'Pets', 'Other'
  ]

  const handleRecatStaple = async (group) => {
    if (!recatStaple) return
    try {
      await api.updateStaple(recatStaple.id, { shoppingGroup: group })
      await loadStaples()
    } catch { /* ignore */ }
    setRecatStaple(null)
  }

  const stapleRows = (staples || []).map(s => ({
    ...s,
    shopping_group: s.shopping_group || 'Other',
  }))

  // Group staples by shopping_group
  const stapleGroups = {}
  for (const s of stapleRows) {
    const g = s.shopping_group
    if (!stapleGroups[g]) stapleGroups[g] = []
    stapleGroups[g].push(s)
  }

  const existingDetailNames = new Set((detailIngredients || []).map(i => compareKey(i.name)))
  const existingStapleNames = new Set(stapleRows.map(s => compareKey(s.name)))

  const meals = recipes ? recipes.filter(r => r.recipe_type !== 'side') : []
  const sides = recipes ? recipes.filter(r => r.recipe_type === 'side') : []

  // Detail view
  if (detailRecipe) {
    return (
      <Sheet onClose={onClose} className={styles.kitchenSheet}>
        <div className={styles.kitchenDetailHeader}>
          <button className={styles.kitchenBack} onClick={() => setDetailRecipe(null)}>{'\u2190'}</button>
          <div className={styles.kitchenDetailTitle}>{detailRecipe.name}</div>
        </div>
        {detailRecipe.recipe_type !== 'side' && (
          <div className={styles.cuisineEdit}>
            <div className={ls.sectionHint} style={{ marginBottom: 6 }}>Cuisine</div>
            <div className={styles.cuisineEditRow}>
              {CUISINE_OPTS.map(([val, label]) => {
                const sel = ['italian', 'mexican', 'asian', 'american'].includes(cuisineVal) ? cuisineVal : ''
                return (
                  <button
                    key={val || 'other'}
                    className={`${styles.cuisineEditChip} ${sel === val ? styles.cuisineEditChipOn : ''}`}
                    onClick={() => {
                      setCuisineVal(val)
                      api.setRecipeCuisine(detailRecipe.id, val).catch(() => {})
                      setRecipes(prev => prev ? prev.map(r => r.id === detailRecipe.id ? { ...r, cuisine: val } : r) : prev)
                    }}
                  >{label}</button>
                )
              })}
            </div>
          </div>
        )}
        {detailIngredients && (
          <div className={ls.sectionHint} style={{ marginBottom: 12 }}>
            {detailIngredients.length} ingredient{detailIngredients.length !== 1 ? 's' : ''}
          </div>
        )}
        <div className={ls.addRow} style={{ marginBottom: 12 }}>
          <AutocompleteInput
            value={detailAddText}
            onChange={setDetailAddText}
            onSubmit={handleAddIngredient}
            candidates={allIngredients || []}
            exclude={existingDetailNames}
            placeholder="Add ingredient..."
            inputClassName={ls.addInput}
          />
          <button className="btn primary" onClick={() => detailAddText.trim() && handleAddIngredient(detailAddText)}>+</button>
        </div>
        {renamed && <div className={ls.renamedHint}>"{renamed.from}" added as "{renamed.to}"</div>}
        {stapleSuggestion && (
          <div className={ls.renamedHint}>
            {stapleSuggestion.name} is a common staple.{' '}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--rust)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
              onClick={() => {
                api.addStaple(stapleSuggestion.name, 'keep_on_hand').catch(() => {})
                setStapleSuggestion(null)
              }}
            >Add as a staple?</button>
            {' '}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
              onClick={() => setStapleSuggestion(null)}
            >{'\u00D7'}</button>
          </div>
        )}
        {detailIngredients === null ? (
          <div className={ls.sectionHint}>Loading...</div>
        ) : detailIngredients.length === 0 ? (
          <div className={ls.sectionHint}>No ingredients yet</div>
        ) : (
          <div className={ls.list}>
            {detailIngredients.map(ing => (
              <div key={ing.id} className={ls.ingredientItem}>
                <span>{ing.name}</span>
                <button className={ls.remove} onClick={() => handleRemoveIngredient(ing.id)}>{'\u00D7'}</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <div className={ls.sectionHint} style={{ marginBottom: 6 }}>Cooking notes</div>
          <textarea
            className="note-input"
            placeholder="e.g., Cook sausage first, then add beans and broth..."
            value={cookingNotes}
            rows={3}
            onChange={(e) => setCookingNotes(e.target.value)}
            onBlur={() => {
              api.updateRecipeNotes(detailRecipe.id, cookingNotes).catch(() => {})
            }}
            style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <button
          className={ls.logout}
          style={{ marginTop: 24 }}
          onClick={() => handleRemoveRecipe(detailRecipe.id)}
        >
          Delete {detailRecipe.recipe_type === 'side' ? 'side' : 'meal'}
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} className={styles.kitchenSheet}>
      <div className="sheet-title">My Kitchen</div>

      <div className={styles.kitchenTabs}>
        {['meals', 'sides', 'staples', 'ratings'].map(tab => (
          <button
            key={tab}
            className={`${styles.kitchenTab}${activeTab === tab ? ` ${styles.active}` : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'meals' && (
        <div className={styles.kitchenTabContent}>
          <div className={ls.sectionHint}>What your family eats. We'll use these to build your grocery list.</div>
          <form onSubmit={handleAddRecipe} className={ls.addRow} style={{ marginBottom: 12 }}>
            <input
              className={`${ls.addInput}${mealDupe ? ` ${ls.dupe}` : ''}`}
              type="text"
              placeholder="Add a meal..."
              value={addRecipeText}
              onChange={(e) => {
                const val = e.target.value
                setAddRecipeText(val)
                setMealDupe(val.trim() && recipes && recipes.some(r => r.recipe_type !== 'side' && r.name.toLowerCase() === val.trim().toLowerCase()))
              }}
            />
            <button className="btn primary" type="submit" disabled={mealDupe}>+</button>
          </form>
          {mealDupe && <div className={ls.dupeMsg}>Already exists</div>}
          {recipes === null ? (
            <div className={ls.sectionHint}>Loading...</div>
          ) : (
            <div className={ls.list}>
              {meals.map(r => (
                <div key={r.id} className={ls.listItem} style={{ cursor: 'pointer' }} onClick={() => setDetailRecipe(r)}>
                  <span className={ls.listName}>{r.name}</span>
                  <span className={ls.listMeta}>{'\u203A'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'sides' && (
        <div className={styles.kitchenTabContent}>
          <div className={ls.sectionHint}>Your usual accompaniments.</div>
          <form onSubmit={handleAddSide} className={ls.addRow} style={{ marginBottom: 12 }}>
            <input
              className={`${ls.addInput}${sideDupe ? ` ${ls.dupe}` : ''}`}
              type="text"
              placeholder="Add a side..."
              value={addSideText}
              onChange={(e) => {
                const val = e.target.value
                setAddSideText(val)
                setSideDupe(val.trim() && recipes && recipes.some(r => r.recipe_type === 'side' && r.name.toLowerCase() === val.trim().toLowerCase()))
              }}
            />
            <button className="btn primary" type="submit" disabled={sideDupe}>+</button>
          </form>
          {sideDupe && <div className={ls.dupeMsg}>Already exists</div>}
          {recipes === null ? (
            <div className={ls.sectionHint}>Loading...</div>
          ) : (
            <div className={ls.list}>
              {sides.map(r => (
                <div key={r.id} className={ls.listItem} style={{ cursor: 'pointer' }} onClick={() => setDetailRecipe(r)}>
                  <span className={ls.listName}>{r.name}</span>
                  <span className={ls.listMeta}>{'\u203A'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'staples' && (
        <div className={styles.kitchenTabContent}>
          <div className={ls.sectionHint}>
            Your go-to items.{' '}
            <button className={styles.stapleInfoBtn} onClick={() => setShowStapleInfo(v => !v)}>
              {'\u24D8'}
            </button>
          </div>
          {showStapleInfo && (
            <div className={styles.stapleInfoBox}>
              <strong>Every trip</strong> — automatically added to your grocery list each time you build it.<br />
              <strong>Keep on hand</strong> — things you usually have at home; only added when you choose.<br />
              <span style={{ marginTop: 4, display: 'inline-block' }}>These are just defaults. You can always add or skip items when building your list.</span>
            </div>
          )}
          <div className={ls.addRow} style={{ marginBottom: 12 }}>
            <AutocompleteInput
              value={addStapleText}
              onChange={setAddStapleText}
              onSubmit={handleAddStaple}
              candidates={allIngredients || []}
              exclude={existingStapleNames}
              placeholder="Add a staple..."
              inputClassName={ls.addInput}
            />
            <button className="btn primary" onClick={() => addStapleText.trim() && handleAddStaple(addStapleText)}>+</button>
          </div>
          {pendingStaple && (
            <div className={styles.stapleTypePrompt}>
              <span className={styles.stapleTypeName}>{pendingStaple}</span>
              <div className={styles.stapleTogglePair}>
                <button className={styles.stapleToggle} onClick={() => handleConfirmStaple('every_trip')}>Every trip</button>
                <button className={styles.stapleToggle} onClick={() => handleConfirmStaple('keep_on_hand')}>Keep on hand</button>
              </div>
              <button className={styles.stapleTypeCancel} onClick={() => setPendingStaple(null)}>{'\u00D7'}</button>
            </div>
          )}
          {staples === null ? (
            <div className={ls.sectionHint}>Loading...</div>
          ) : stapleRows.length === 0 ? (
            <div className={ls.sectionHint}>No staples yet</div>
          ) : (
            <div className={ls.list}>
              {Object.keys(stapleGroups).sort().map(group => (
                <div key={group}>
                  <div className={ls.listGroup}>{group}</div>
                  {stapleGroups[group].map(s => (
                    <div key={s.id} className={ls.listItem}>
                      <span className={ls.listName}>{s.name}</span>
                      <button
                        className="recat-btn"
                        title="Change category"
                        onClick={() => setRecatStaple({ name: s.name, id: s.id })}
                      >{'\u2630'}</button>
                      <div className={styles.stapleTogglePair}>
                        <button
                          className={`${styles.stapleToggle}${s.mode === 'every_trip' ? ` ${styles.active}` : ''}`}
                          onClick={() => { if (s.mode !== 'every_trip') handleSetStapleMode(s.id, 'every_trip') }}
                        >
                          Every trip
                        </button>
                        <button
                          className={`${styles.stapleToggle}${s.mode === 'keep_on_hand' ? ` ${styles.active}` : ''}`}
                          onClick={() => { if (s.mode !== 'keep_on_hand') handleSetStapleMode(s.id, 'keep_on_hand') }}
                        >
                          Keep on hand
                        </button>
                      </div>
                      <button className={ls.remove} onClick={() => handleRemoveStaple(s.id)}>{'\u00D7'}</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {activeTab === 'ratings' && (
        <div className={styles.kitchenTabContent}>
          <div className={ls.sectionHint}>Products you've purchased. Rate them after you've tried them.</div>
          {purchases === null ? (
            <div className={ls.sectionHint}>Loading...</div>
          ) : purchases.length === 0 ? (
            <div className={ls.sectionHint}>No purchase history yet. Upload a receipt after a shopping trip.</div>
          ) : (
            <div className={ls.list}>
              {(() => {
                const byWeek = {}
                for (const p of purchases) {
                  const wk = p.date ? _getWeekLabel(p.date.slice(0, 10)) : 'Unknown'
                  if (!byWeek[wk]) byWeek[wk] = []
                  byWeek[wk].push(p)
                }
                return Object.entries(byWeek).map(([week, items]) => (
                  <div key={week}>
                    <div className={ls.listGroup}>{week}</div>
                    {items.map((p, i) => {
                      const desc = p.receipt_item || p.product_name || p.name
                      const brand = p.product_brand || p.brand || ''
                      const price = p.receipt_price ?? p.product_price
                      return (
                        <div key={`${p.product_key || p.name}-${i}`} className={`${ls.listItem} ${styles.historyItem}`}>
                          <div className={styles.historyItemInfo}>
                            <span className={ls.listName}>{desc}</span>
                            {desc !== p.name && <div className={styles.historyItemDetail}>{p.name}</div>}
                            <div className={styles.historyItemMeta}>
                              {brand && <span>{brand}</span>}
                              {brand && price != null && <span> · </span>}
                              {price != null && <span>${price.toFixed(2)}</span>}
                            </div>
                          </div>
                          <div className={styles.stapleTogglePair}>
                            <button
                              className={`${styles.stapleToggle}${p.rating === 1 ? ` ${styles.active}` : ''}`}
                              onClick={() => handleRatePurchase(p, p.rating === 1 ? 0 : 1)}
                            >
                              {'\uD83D\uDC4D'}
                            </button>
                            <button
                              className={`${styles.stapleToggle}${p.rating === -1 ? ` ${styles.active}` : ''}`}
                              onClick={() => handleRatePurchase(p, p.rating === -1 ? 0 : -1)}
                            >
                              {'\uD83D\uDC4E'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}

      {recatStaple && (
        <div className="recat-overlay" onClick={() => setRecatStaple(null)}>
          <div className="recat-picker" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Move "{recatStaple.name}"</div>
            <div className="sheet-sub">Pick a category</div>
            <div className="recat-options">
              {STAPLE_GROUPS.map(g => (
                <button key={g} className="recat-option" onClick={() => handleRecatStaple(g)}>{g}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}
