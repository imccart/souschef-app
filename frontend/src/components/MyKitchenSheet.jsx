import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import AutocompleteInput from './AutocompleteInput'
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

export default function MyKitchenSheet({ onClose }) {
  const [activeTab, setActiveTab] = useState('meals')
  const [detailRecipe, setDetailRecipe] = useState(null)
  const [recipes, setRecipes] = useState(null)
  const [regulars, setRegulars] = useState(null)
  const [pantry, setPantry] = useState(null)
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
  const [recatStaple, setRecatStaple] = useState(null) // { name, type, id }
  const [pendingStaple, setPendingStaple] = useState(null) // name waiting for type choice

  // History state (replaces Favorites)
  const [purchases, setPurchases] = useState(null)

  // Detail view state
  const [detailIngredients, setDetailIngredients] = useState(null)
  const [detailAddText, setDetailAddText] = useState('')
  const [renamed, setRenamed] = useState(null)

  useEffect(() => {
    api.getRecipes().then(data => setRecipes(data.recipes)).catch(() => setRecipes([]))
    api.getRegulars().then(data => setRegulars(data.regulars)).catch(() => setRegulars([]))
    api.getPantry().then(data => setPantry(data.items)).catch(() => setPantry([]))
    api.getGrocerySuggestions().then(data => setAllIngredients(data.suggestions)).catch(() => {})
    api.getPurchases().then(data => setPurchases(data.purchases || [])).catch(() => setPurchases([]))
  }, [])

  // Load ingredients when entering detail view
  useEffect(() => {
    if (detailRecipe) {
      setDetailIngredients(null)
      setDetailAddText('')
      setRenamed(null)
      api.getRecipeIngredients(detailRecipe.id)
        .then(data => setDetailIngredients(data.ingredients))
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

  const handleConfirmStaple = async (type) => {
    if (!pendingStaple) return
    try {
      if (type === 'regular') {
        await api.addRegular(pendingStaple)
        const data = await api.getRegulars()
        setRegulars(data.regulars)
      } else {
        await api.addPantryItem(pendingStaple)
        const data = await api.getPantry()
        setPantry(data.items)
      }
    } catch { /* ignore */ }
    setPendingStaple(null)
  }

  const handleRemoveRegular = async (id) => {
    try {
      await api.removeRegular(id)
      const data = await api.getRegulars()
      setRegulars(data.regulars)
    } catch { /* ignore */ }
  }

  const handleRemovePantry = async (id) => {
    try {
      await api.removePantryItem(id)
      const data = await api.getPantry()
      setPantry(data.items)
    } catch { /* ignore */ }
  }

  const handleMoveToPantry = async (id, name, shoppingGroup) => {
    try {
      await api.removeRegular(id)
      await api.addPantryItem(name, shoppingGroup || 'Other')
      const [rData, pData] = await Promise.all([api.getRegulars(), api.getPantry()])
      setRegulars(rData.regulars)
      setPantry(pData.items)
    } catch { /* ignore */ }
  }

  const handleMoveToRegulars = async (name, id, shoppingGroup) => {
    setPantry(prev => (prev || []).filter(p => p.id !== id))
    try {
      await api.removePantryItem(id)
      await api.addRegular(name, shoppingGroup || '')
      const rData = await api.getRegulars()
      setRegulars(rData.regulars)
    } catch {
      const pData = await api.getPantry()
      setPantry(pData.items)
    }
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
      await api.recategorizeStaple(recatStaple.name, recatStaple.type, recatStaple.id, group)
      const [rData, pData] = await Promise.all([api.getRegulars(), api.getPantry()])
      setRegulars(rData.regulars)
      setPantry(pData.items)
    } catch { /* ignore */ }
    setRecatStaple(null)
  }

  const staples = []
  if (regulars) {
    for (const r of regulars) {
      staples.push({ ...r, type: 'regular' })
    }
  }
  if (pantry) {
    for (const p of pantry) {
      staples.push({ ...p, type: 'pantry', shopping_group: p.shopping_group || 'Other' })
    }
  }

  // Group staples by shopping_group
  const stapleGroups = {}
  for (const s of staples) {
    const g = s.shopping_group || 'Other'
    if (!stapleGroups[g]) stapleGroups[g] = []
    stapleGroups[g].push(s)
  }

  const existingDetailNames = new Set((detailIngredients || []).map(i => i.name.toLowerCase()))
  const existingStapleNames = new Set(staples.map(s => s.name.toLowerCase()))

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
                <button className={styles.stapleToggle} onClick={() => handleConfirmStaple('regular')}>Every trip</button>
                <button className={styles.stapleToggle} onClick={() => handleConfirmStaple('pantry')}>Keep on hand</button>
              </div>
              <button className={styles.stapleTypeCancel} onClick={() => setPendingStaple(null)}>{'\u00D7'}</button>
            </div>
          )}
          {regulars === null && pantry === null ? (
            <div className={ls.sectionHint}>Loading...</div>
          ) : staples.length === 0 ? (
            <div className={ls.sectionHint}>No staples yet</div>
          ) : (
            <div className={ls.list}>
              {Object.keys(stapleGroups).sort().map(group => (
                <div key={group}>
                  <div className={ls.listGroup}>{group}</div>
                  {stapleGroups[group].map(s => (
                    <div key={`${s.type}-${s.id}`} className={ls.listItem}>
                      <span className={ls.listName}>{s.name}</span>
                      <button
                        className="recat-btn"
                        title="Change category"
                        onClick={() => setRecatStaple({ name: s.name, type: s.type, id: s.id })}
                      >{'\u2630'}</button>
                      <div className={styles.stapleTogglePair}>
                        <button
                          className={`${styles.stapleToggle}${s.type === 'regular' ? ` ${styles.active}` : ''}`}
                          onClick={() => { if (s.type !== 'regular') handleMoveToRegulars(s.name, s.id, s.shopping_group) }}
                        >
                          Every trip
                        </button>
                        <button
                          className={`${styles.stapleToggle}${s.type === 'pantry' ? ` ${styles.active}` : ''}`}
                          onClick={() => { if (s.type !== 'pantry') handleMoveToPantry(s.id, s.name, s.shopping_group) }}
                        >
                          Keep on hand
                        </button>
                      </div>
                      <button className={ls.remove} onClick={() => {
                        if (s.type === 'regular') handleRemoveRegular(s.id)
                        else handleRemovePantry(s.id)
                      }}>{'\u00D7'}</button>
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
