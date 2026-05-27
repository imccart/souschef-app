import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import dieImg from '../assets/die.png'
import styles from './MealPickerSheet.module.css'

const MAX_SIDES = 3

const CUISINES = [
  ['all', 'All'], ['italian', 'Italian'], ['mexican', 'Mexican'],
  ['asian', 'Asian'], ['american', 'American'],
]

function relMade(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today - d) / 86400000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 7) return 'last ' + d.toLocaleDateString('en-US', { weekday: 'short' })
  if (diff < 14) return 'last week'
  if (diff < 60) return `${Math.floor(diff / 7)}w ago`
  return `${Math.floor(diff / 30)}mo ago`
}

function usageHint(cookCount, lastMade) {
  if (!lastMade || !cookCount) return 'never made'
  return `${cookCount}× · ${relMade(lastMade)}`
}

export default function MealPickerSheet({ date, dayName, onSelect, onFreeform, onCreateNew, onClose }) {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [cuisine, setCuisine] = useState('all')
  const [pickedRecipe, setPickedRecipe] = useState(null)
  const [sides, setSides] = useState(null)
  const [selectedSides, setSelectedSides] = useState([])
  const [addingCustom, setAddingCustom] = useState(false)
  const [sideSearch, setSideSearch] = useState('')
  const [surprise, setSurprise] = useState(null)
  const [surpriseSeen, setSurpriseSeen] = useState([])
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    Promise.all([api.getCandidates(date), api.getMealHistory()])
      .then(([candidates, hist]) => { setData(candidates); setHistory(hist.history || []) })
      .catch(() => setError(true))
  }, [date])

  // Load sides once a meal is picked; reset side state when un-picked.
  useEffect(() => {
    if (pickedRecipe) {
      api.getSides(date).then(d => setSides(d.sides || [])).catch(() => setSides([]))
    } else {
      setSides(null)
      setSelectedSides([])
      setAddingCustom(false)
      setSideSearch('')
    }
  }, [pickedRecipe, date])

  const pickMeal = (id, name) => {
    setSurprise(null)
    setSearch('')
    setPickedRecipe({ id, name })
  }

  const toggleSide = (side) => {
    setSelectedSides(prev => {
      const exists = prev.find(s => s.id === side.id)
      if (exists) return prev.filter(s => s.id !== side.id)
      if (prev.length >= MAX_SIDES) return prev
      return [...prev, { id: side.id, name: side.name, custom: side.custom }]
    })
  }

  const commitCustomSide = (raw) => {
    const n = (raw || '').trim()
    if (!n || selectedSides.length >= MAX_SIDES) { setSideSearch(''); setAddingCustom(false); return }
    const existing = (sides || []).find(s => s.name.toLowerCase() === n.toLowerCase())
    if (existing) {
      if (!selectedSides.find(s => s.id === existing.id))
        setSelectedSides(prev => [...prev, { id: existing.id, name: existing.name }])
    } else {
      setSelectedSides(prev => [...prev, { id: `custom-${n}`, name: n, custom: true }])
    }
    setSideSearch(''); setAddingCustom(false)
  }

  const confirmSelection = () => {
    if (!pickedRecipe) return
    onSelect(pickedRecipe.id, selectedSides.map(s => ({
      side_recipe_id: s.custom ? null : s.id, side_name: s.name,
    })))
  }

  const rollSurprise = async () => {
    setRolling(true)
    try {
      const res = await api.surprisePick(date, cuisine, surpriseSeen)
      if (res && res.meal) {
        setSurprise(res)
        setSurpriseSeen(prev => [...prev, res.meal.id])
      }
    } catch { /* ignore — banner just won't appear */ }
    setRolling(false)
  }

  const acceptSurprise = () => {
    if (!surprise?.meal) return
    const m = surprise.meal, sd = surprise.side
    setSearch('')
    setPickedRecipe({ id: m.id, name: m.name })
    if (sd && sd.side_recipe_id) setSelectedSides([{ id: sd.side_recipe_id, name: sd.side_name }])
    setSurprise(null)
  }

  // ── Error state ──
  if (error) return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">Couldn't load recipes</div>
      <input
        className={styles.pickerSearch}
        type="text"
        placeholder="Type a meal name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && search.trim()) onCreateNew(search.trim()) }}
      />
      {search.trim() && (
        <button className={styles.kitchenRow} onClick={() => onCreateNew(search.trim())}>
          <span className={`${styles.kitchenName} ${styles.createNew}`}>Create "{search.trim()}" as a new meal</span>
        </button>
      )}
      <button className={styles.chefsNight} onClick={() => onFreeform("Chef's Night Off")}>Chef's night off →</button>
    </Sheet>
  )

  if (!data) return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="loading">Flipping through recipes...</div>
    </Sheet>
  )

  const meals = data.all_recipes.filter(r => r.recipe_type === 'meal')
  const recipeById = new Map(meals.map(r => [r.id, r]))
  const histById = new Map((history || []).map(h => [h.recipe_id, h]))
  const query = search.trim().toLowerCase()

  const matchCuisine = (r) => {
    if (!r) return false
    if (cuisine === 'all') return true
    return r.cuisine === cuisine
  }

  const searchResults = query ? meals.filter(r => r.name.toLowerCase().includes(query)) : []

  const favorites = (history || [])
    .filter(h => h.cook_count >= 2)
    .map(h => ({ ...h, recipe: recipeById.get(h.recipe_id) }))
    .filter(f => f.recipe && matchCuisine(f.recipe))
    .slice(0, 8)
  const favIds = new Set(favorites.map(f => f.recipe_id))

  const kitchen = meals
    .filter(r => !favIds.has(r.id) && matchCuisine(r))
    .map(r => ({ recipe: r, hist: histById.get(r.id) }))
    .sort((a, b) => {
      const am = a.hist ? a.hist.cook_count : -1
      const bm = b.hist ? b.hist.cook_count : -1
      if (am !== bm) return bm - am
      return a.recipe.name.localeCompare(b.recipe.name)
    })

  // ── Sides (picked state) ──
  const customSelected = selectedSides.filter(s => s.custom)
  const sideOptions = sides ? [...sides, ...customSelected] : []
  const selectedSideIds = new Set(selectedSides.map(s => s.id))
  const sideMatches = (addingCustom && sideSearch.trim() && sides)
    ? sides.filter(s => s.name.toLowerCase().includes(sideSearch.trim().toLowerCase()) && !selectedSideIds.has(s.id))
    : []

  return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">{pickedRecipe ? pickedRecipe.name : "What's for dinner?"}</div>

      <div key={pickedRecipe ? 'picked' : 'empty'} className={styles.pickerBody}>
        {!pickedRecipe ? (
          <>
            <div className={styles.searchRow}>
              <input
                className={styles.pickerSearch}
                type="text"
                placeholder="Search or add a new meal"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search.trim()) {
                    if (searchResults.length > 0) pickMeal(searchResults[0].id, searchResults[0].name)
                    else onCreateNew(search.trim())
                  }
                }}
              />
              <button
                type="button"
                className={styles.diceBtn}
                onClick={rollSurprise}
                disabled={rolling}
                aria-label="Surprise me"
                title="Surprise me"
              >
                <img src={dieImg} alt="" className={styles.dieGlyph} />
              </button>
            </div>

            {surprise && surprise.meal && (
              <div className={styles.surpriseBanner}>
                <button className={styles.bannerDismiss} onClick={() => setSurprise(null)} aria-label="Dismiss">×</button>
                <div className={styles.bannerContent}>
                  <div className={styles.bannerMeal}>{surprise.meal.name}</div>
                  {surprise.side && surprise.side.side_name && (
                    <div className={styles.bannerSide}>with <strong>{surprise.side.side_name}</strong></div>
                  )}
                </div>
                <div className={styles.bannerActions}>
                  <button className={styles.bannerReroll} onClick={rollSurprise} disabled={rolling} aria-label="Another suggestion">↻</button>
                  <button className={styles.bannerAccept} onClick={acceptSurprise} aria-label="Use this meal">✓</button>
                </div>
              </div>
            )}

            {query ? (
              <div className={styles.scrollList}>
                {searchResults.length > 0 ? searchResults.map(r => {
                  const h = histById.get(r.id)
                  return (
                    <button key={r.id} className={styles.kitchenRow} onClick={() => pickMeal(r.id, r.name)}>
                      <span className={styles.kitchenName}>{r.name}</span>
                      <span className={styles.kitchenHint}>{usageHint(h?.cook_count, h?.last_made)}</span>
                    </button>
                  )
                }) : (
                  <button className={styles.kitchenRow} onClick={() => onCreateNew(search.trim())}>
                    <span className={`${styles.kitchenName} ${styles.createNew}`}>Create "{search.trim()}" as a new meal</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className={styles.cuisineRow}>
                  {CUISINES.map(([val, label]) => (
                    <button
                      key={val}
                      className={`${styles.cuisineChip} ${cuisine === val ? styles.cuisineChipOn : ''}`}
                      onClick={() => setCuisine(val)}
                    >{label}</button>
                  ))}
                </div>

                {favorites.length > 0 && (
                  <>
                    <div className={styles.sectionLabel}>Your favorites</div>
                    <div className={styles.scrollListShort}>
                      {favorites.map(f => (
                        <button key={f.recipe_id} className={styles.kitchenRow} onClick={() => pickMeal(f.recipe_id, f.recipe.name)}>
                          <span className={styles.kitchenName}>{f.recipe.name}</span>
                          <span className={styles.kitchenHint}>{usageHint(f.cook_count, f.last_made)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className={styles.sectionLabel}>From your kitchen</div>
                <div className={styles.scrollListShort}>
                  {kitchen.length > 0 ? kitchen.map(({ recipe, hist }) => (
                    <button key={recipe.id} className={styles.kitchenRow} onClick={() => pickMeal(recipe.id, recipe.name)}>
                      <span className={styles.kitchenName}>{recipe.name}</span>
                      <span className={styles.kitchenHint}>{usageHint(hist?.cook_count, hist?.last_made)}</span>
                    </button>
                  )) : (
                    <div className={styles.emptyHint}>No meals match this filter.</div>
                  )}
                </div>

                <button className={styles.chefsNight} onClick={() => onFreeform("Chef's Night Off")}>Chef's night off →</button>
              </>
            )}
          </>
        ) : (
          <>
            <button className={styles.backLink} onClick={() => setPickedRecipe(null)}>‹ Choose a different meal</button>

            <div className={styles.pickedMeal}>{pickedRecipe.name}</div>
            <div className={styles.withLabel}>— with —</div>

            {!sides ? (
              <div className="loading">Loading sides...</div>
            ) : (
              <div className={styles.sideList}>
                {sideOptions.map(s => {
                  const on = selectedSideIds.has(s.id)
                  return (
                    <button key={s.id} className={styles.sideRow} onClick={() => toggleSide(s)}>
                      <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>{on ? '✓' : ''}</span>
                      <span className={`${styles.sideName} ${on ? styles.sideNameOn : ''}`}>{s.name}</span>
                    </button>
                  )
                })}

                {addingCustom ? (
                  <>
                    <div className={`${styles.sideRow} ${styles.sideRowInput}`}>
                      <span className={`${styles.tick} ${styles.tickDashed}`}>+</span>
                      <input
                        className={styles.customInline}
                        type="text"
                        placeholder="Search or add a new side"
                        value={sideSearch}
                        autoFocus
                        onChange={(e) => setSideSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (sideMatches.length === 1) toggleSide(sideMatches[0])
                            else commitCustomSide(sideSearch)
                            setSideSearch(''); setAddingCustom(false)
                          } else if (e.key === 'Escape') { setSideSearch(''); setAddingCustom(false) }
                        }}
                        onBlur={() => setTimeout(() => { setSideSearch(''); setAddingCustom(false) }, 150)}
                      />
                    </div>
                    {sideMatches.map(s => (
                      <button
                        key={s.id}
                        className={styles.sideRow}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { toggleSide(s); setSideSearch(''); setAddingCustom(false) }}
                      >
                        <span className={styles.suggestPrefix}>Already in your kitchen:</span>
                        <span className={styles.sideName}>{s.name}</span>
                      </button>
                    ))}
                    {sideSearch.trim() && (
                      <button
                        className={styles.sideRow}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commitCustomSide(sideSearch)}
                      >
                        <span className={`${styles.somethingElseLabel}`}>Add "{sideSearch.trim()}" as a new side</span>
                      </button>
                    )}
                  </>
                ) : selectedSides.length < MAX_SIDES ? (
                  <button className={styles.sideRow} onClick={() => setAddingCustom(true)}>
                    <span className={`${styles.tick} ${styles.tickDashed}`}>+</span>
                    <span className={styles.somethingElseLabel}>Search or add a new side</span>
                  </button>
                ) : null}
              </div>
            )}

            <div className={styles.doneRow}>
              <button className="btn primary" onClick={confirmSelection}>Done</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
