import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'

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
      api.getSides(date).then(data => setSides(data.sides || [])).catch(() => setSides([]))
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

  const confirmSides = () => {
    const sidesPayload = selectedSides.map(s => ({
      side_recipe_id: s.custom ? null : s.id,
      side_name: s.name,
    }))
    onSelect(pickedRecipe.id, sidesPayload)
  }

  // Step 2: Side selection (multi-select)
  if (pickedRecipe) {
    const query = sideSearch.trim().toLowerCase()
    const filtered = query && sides
      ? sides.filter(s => s.name.toLowerCase().includes(query))
      : sides || []

    const selectedIds = new Set(selectedSides.map(s => s.id))

    return (
      <Sheet onClose={onClose} className="meal-picker-sheet">
        <div className="sheet-title">{dayName}</div>
        <div className="sheet-sub">{pickedRecipe.name} + sides? ({selectedSides.length}/{MAX_SIDES})</div>
        {!sides ? (
          <div className="loading">Loading sides...</div>
        ) : (
          <>
            <input
              className="picker-search"
              type="text"
              placeholder="Search sides..."
              value={sideSearch}
              onChange={(e) => setSideSearch(e.target.value)}
            />
            {query && filtered.length === 0 ? (
              <div className="picker-results">
                <button className="picker-option freeform" onClick={() => {
                  if (selectedSides.length < MAX_SIDES) {
                    const custom = { id: `custom-${sideSearch.trim()}`, name: sideSearch.trim(), custom: true }
                    setSelectedSides(prev => [...prev, custom])
                    setSideSearch('')
                  }
                }}>
                  Add "{sideSearch.trim()}" as a side
                </button>
              </div>
            ) : (
              <div className="picker-pills">
                {filtered.map(s => (
                  <button
                    key={s.id}
                    className={`meal-pill ${selectedIds.has(s.id) ? 'selected-side' : ''} ${s.in_use ? 'in-use' : ''}`}
                    onClick={() => toggleSide(s)}
                    disabled={!selectedIds.has(s.id) && selectedSides.length >= MAX_SIDES}
                  >
                    {s.name}
                    {selectedIds.has(s.id) && ' \u2713'}
                  </button>
                ))}
              </div>
            )}
            <div className="picker-side-actions">
              <button className="btn primary" onClick={confirmSides}>
                {selectedSides.length === 0 ? 'No sides' : `Done (${selectedSides.length})`}
              </button>
            </div>
            <button className="picker-back" onClick={() => { setPickedRecipe(null); setSides(null); setSideSearch(''); setSelectedSides([]) }}>
              {'\u2190'} Back to meals
            </button>
          </>
        )}
      </Sheet>
    )
  }

  // Step 1: Meal selection
  if (error) return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">Couldn't load recipes</div>
      <input
        className="picker-search"
        type="text"
        placeholder="Type a meal name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && search.trim()) onCreateNew(search.trim())
        }}
      />
      {search.trim() && (
        <button className="picker-option freeform" onClick={() => onCreateNew(search.trim())}>
          Create "{search.trim()}" as a new meal
        </button>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="picker-option freeform" onClick={() => onFreeform('Eating Out')}>Eating Out</button>
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

  // Recipes the user hasn't cooked yet
  const historyIds = new Set((history || []).map(h => h.recipe_id))
  const otherRecipes = candidates.filter(r => !historyIds.has(r.id)).slice(0, 6)

  const pickMeal = (id, name) => {
    setPickedRecipe({ id, name })
    setSearch('')
  }

  return (
    <Sheet onClose={onClose} className="meal-picker-sheet">
      <div className="sheet-title">{dayName}</div>
      <div className="sheet-sub">What are you making?</div>
      <input
        className="picker-search"
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
        <div className="picker-results">
          {filtered.length > 0 ? (
            filtered.map(r => {
              const h = (history || []).find(x => x.recipe_id === r.id)
              return (
                <button key={r.id} className="picker-option" onClick={() => pickMeal(r.id, r.name)}>
                  {r.name}
                  {h && (
                    <span className="picker-favorite-meta">
                      Made {h.cook_count} time{h.cook_count !== 1 ? 's' : ''}, last {daysAgo(h.last_made)}
                    </span>
                  )}
                </button>
              )
            })
          ) : (
            <button className="picker-option freeform" onClick={() => onCreateNew(search.trim())}>
              Create "{search.trim()}" as a new meal
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Favorites */}
          {favorites.length > 0 && (
            <>
              <div className="picker-section-label">Your favorites</div>
              <div className="picker-pills" style={{ marginBottom: '16px' }}>
                {favorites.map(f => (
                  <button
                    key={f.recipe_id}
                    className="meal-pill"
                    onClick={() => pickMeal(f.recipe_id, f.recipe_name)}
                    title={`Made ${f.cook_count} times, last ${daysAgo(f.last_made)}`}
                  >
                    {f.recipe_name}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Suggested / Other */}
          <div className="picker-section-label">
            {favorites.length > 0 ? 'Other recipes' : 'Suggested'}
          </div>
          <div className="picker-pills">
            {(favorites.length > 0 ? otherRecipes : candidates.slice(0, 8)).map(r => (
              <button key={r.id} className="meal-pill" onClick={() => pickMeal(r.id, r.name)}>
                {r.name}
              </button>
            ))}
            <button
              className="meal-pill eating-out"
              onClick={() => onFreeform('Eating Out')}
            >
              Eating Out
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
