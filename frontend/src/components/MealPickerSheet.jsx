import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import styles from './MealPickerSheet.module.css'

function daysAgo(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today - d) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 7) return `${diff} days ago`
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`
  return `${Math.floor(diff / 30)}mo ago`
}

const MAX_SIDES = 3

export default function MealPickerSheet({ date, dayName, onSelect, onFreeform, onCreateNew, onClose }) {
  const [data, setData] = useState(null)
  const [history, setHistory] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(false)
  const [pickedRecipe, setPickedRecipe] = useState(null)
  const [sides, setSides] = useState(null)
  const [sideSearch, setSideSearch] = useState('')
  const [showSideSearch, setShowSideSearch] = useState(false)
  const [selectedSides, setSelectedSides] = useState([])

  useEffect(() => {
    Promise.all([
      api.getCandidates(date),
      api.getMealHistory(),
    ]).then(([candidates, hist]) => {
      setData(candidates)
      setHistory(hist.history || [])
    }).catch(() => setError(true))
  }, [date])

  // Load sides when a meal is picked
  useEffect(() => {
    if (pickedRecipe) {
      api.getSides(date).then(d => setSides(d.sides || [])).catch(() => setSides([]))
    } else {
      setSides(null)
      setSideSearch('')
      setShowSideSearch(false)
      setSelectedSides([])
    }
  }, [pickedRecipe, date])

  const toggleSide = (side) => {
    setSelectedSides(prev => {
      const exists = prev.find(s => s.id === side.id)
      if (exists) return prev.filter(s => s.id !== side.id)
      if (prev.length >= MAX_SIDES) return prev
      return [...prev, side]
    })
  }

  const confirmSelection = () => {
    if (!pickedRecipe) return
    const sidesPayload = selectedSides.map(s => ({
      side_recipe_id: s.custom ? null : s.id,
      side_name: s.name,
    }))
    onSelect(pickedRecipe.id, sidesPayload)
  }

  const pickMeal = (id, name) => {
    setPickedRecipe({ id, name })
    setSearch('')
  }

  // ── Error state ──
  if (error) return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">Couldn't load recipes</div>
      <input
        className={styles.pickerSearch}
        type="text"
        placeholder="Type a meal name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && search.trim()) onCreateNew(search.trim())
        }}
      />
      {search.trim() && (
        <button className={`${styles.pickerOption} ${styles.freeform}`} onClick={() => onCreateNew(search.trim())}>
          Create "{search.trim()}" as a new meal
        </button>
      )}
      <div style={{ marginTop: 12 }}>
        <button className={`${styles.pickerOption} ${styles.freeform}`} onClick={() => onFreeform('Eating Out')}>Eating Out</button>
      </div>
    </Sheet>
  )

  if (!data) return (
    <Sheet onClose={onClose}>
      <div className="loading">Flipping through recipes...</div>
    </Sheet>
  )

  const { candidates, all_recipes } = data
  const query = search.trim().toLowerCase()
  const filtered = query
    ? all_recipes.filter(r => r.name.toLowerCase().includes(query))
    : []

  // Build favorites from history (cooked 2+ times, sorted by frequency)
  const favorites = history
    ? history.filter(h => h.cook_count >= 2).slice(0, 8)
    : []
  const historyIds = new Set((history || []).map(h => h.recipe_id))
  const otherRecipes = candidates.filter(r => !historyIds.has(r.id)).slice(0, 6)

  // ── Side filtering (inline section) ──
  const sideQuery = sideSearch.trim().toLowerCase()
  const filteredSides = sideQuery && sides
    ? sides.filter(s => s.name.toLowerCase().includes(sideQuery))
    : sides || []
  const selectedSideIds = new Set(selectedSides.map(s => s.id))

  const renderMealPill = (id, name, opts = {}) => (
    <button
      key={id}
      className={`${styles.mealPill} ${pickedRecipe?.id === id ? styles.selectedSide : ''}`}
      onClick={() => pickMeal(id, name)}
      title={opts.title}
    >
      {name}
    </button>
  )

  return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">
        {pickedRecipe
          ? `${pickedRecipe.name}${selectedSides.length > 0 ? ` + ${selectedSides.length} side${selectedSides.length > 1 ? 's' : ''}` : ''}`
          : "What's for dinner?"}
      </div>

      {pickedRecipe && (
        <button
          type="button"
          className={styles.pickerBack}
          onClick={() => setPickedRecipe(null)}
        >{'‹'} Choose a different meal</button>
      )}

      {!pickedRecipe && (
        <>
      <input
        className={styles.pickerSearch}
        type="text"
        placeholder="Search or type a meal..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && search.trim()) {
            if (filtered.length > 0) {
              pickMeal(filtered[0].id, filtered[0].name)
            } else {
              onCreateNew(search.trim())
            }
          }
        }}
      />

      {query ? (
        <div className={styles.pickerResults}>
          {filtered.length > 0 ? (
            filtered.map(r => {
              const h = (history || []).find(x => x.recipe_id === r.id)
              return (
                <button key={r.id} className={styles.pickerOption} onClick={() => pickMeal(r.id, r.name)}>
                  {r.name}
                  {h && (
                    <span className={styles.pickerFavoriteMeta}>
                      Made {h.cook_count} time{h.cook_count !== 1 ? 's' : ''}, last {daysAgo(h.last_made)}
                    </span>
                  )}
                </button>
              )
            })
          ) : (
            <button className={`${styles.pickerOption} ${styles.freeform}`} onClick={() => onCreateNew(search.trim())}>
              Create "{search.trim()}" as a new meal
            </button>
          )}
        </div>
      ) : (
        <>
          {favorites.length > 0 && (
            <>
              <div className={styles.pickerSectionLabel}>Your favorites</div>
              <div className={styles.pickerPills} style={{ marginBottom: '16px' }}>
                {favorites.map(f => renderMealPill(f.recipe_id, f.recipe_name, {
                  title: `Made ${f.cook_count} times, last ${daysAgo(f.last_made)}`,
                }))}
              </div>
            </>
          )}

          <div className={styles.pickerSectionLabel}>
            {favorites.length > 0 ? 'Other recipes' : 'Suggested'}
          </div>
          <div className={styles.pickerPills}>
            {(favorites.length > 0 ? otherRecipes : candidates.slice(0, 8)).map(r => renderMealPill(r.id, r.name))}
            <button
              className={`${styles.mealPill} ${styles.eatingOut}`}
              onClick={() => onFreeform('Eating Out')}
            >
              Eating Out
            </button>
          </div>
        </>
      )}
        </>
      )}

      {/* Inline sides — appears once a meal is picked */}
      {pickedRecipe && (
        <div className={styles.inlineSides}>
          <div className={styles.inlineSidesHead}>
            <span className={styles.inlineSidesTitle}>
              Add sides <span className={styles.inlineSidesCount}>({selectedSides.length}/{MAX_SIDES})</span>
            </span>
            <button
              type="button"
              className={styles.inlineSidesSearchToggle}
              onClick={() => setShowSideSearch(v => !v)}
              aria-label="Search sides"
              title={showSideSearch ? 'Hide search' : 'Search sides'}
            >{showSideSearch ? '×' : '\u{1F50D}'}</button>
          </div>

          {showSideSearch && (
            <input
              className={styles.pickerSearch}
              style={{ marginBottom: 10 }}
              type="text"
              placeholder="Search sides..."
              value={sideSearch}
              onChange={(e) => setSideSearch(e.target.value)}
              autoFocus
            />
          )}

          {!sides ? (
            <div className="loading">Loading sides...</div>
          ) : sideQuery && filteredSides.length === 0 ? (
            <button
              className={`${styles.pickerOption} ${styles.freeform}`}
              onClick={() => {
                if (selectedSides.length < MAX_SIDES) {
                  const custom = { id: `custom-${sideSearch.trim()}`, name: sideSearch.trim(), custom: true }
                  setSelectedSides(prev => [...prev, custom])
                  setSideSearch('')
                }
              }}>
              Add "{sideSearch.trim()}" as a side
            </button>
          ) : (
            <div className={styles.pickerPills}>
              {filteredSides.map(s => (
                <button
                  key={s.id}
                  className={`${styles.mealPill} ${selectedSideIds.has(s.id) ? styles.selectedSide : ''} ${s.in_use ? styles.inUse : ''}`}
                  onClick={() => toggleSide(s)}
                  disabled={!selectedSideIds.has(s.id) && selectedSides.length >= MAX_SIDES}
                >
                  {s.name}
                  {selectedSideIds.has(s.id) && ' ✓'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Done button — only visible after a meal is picked */}
      {pickedRecipe && (
        <div className={styles.pickerSideActions}>
          <button className="btn primary" onClick={confirmSelection}>
            {selectedSides.length === 0
              ? `Done · ${pickedRecipe.name}`
              : `Done · ${pickedRecipe.name} + ${selectedSides.length} side${selectedSides.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </Sheet>
  )
}
