import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import AutocompleteInput from './AutocompleteInput'

const GROUP_ORDER = [
  'Produce', 'Meat', 'Dairy & Eggs', 'Bread & Bakery',
  'Pasta & Grains', 'Spices & Baking', 'Condiments & Sauces',
  'Canned Goods', 'Frozen', 'Breakfast & Beverages', 'Snacks', 'Other'
]

function formatDateRange(start, end) {
  if (!start || !end) return ''
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' })
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} \u2013 ${e.getDate()}`
  }
  return `${sMonth} ${s.getDate()} \u2013 ${eMonth} ${e.getDate()}`
}

export default function GroceryPage({ sidebar = false }) {
  const [grocery, setGrocery] = useState(null)
  const [meals, setMeals] = useState(null)
  const [addText, setAddText] = useState('')
  const [hideChecked, setHideChecked] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [g, m] = await Promise.all([api.getGrocery(), api.getMeals()])
    setGrocery(g)
    setMeals(m)
    setLoading(false)
  }

  // Load item pool for autocomplete
  const [itemPool, setItemPool] = useState([])
  useEffect(() => {
    api.getGrocerySuggestions().then(data => {
      setItemPool(data.suggestions || [])
    })
  }, [])

  useEffect(() => { load() }, [])

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (loading) return <div className="loading">Gathering ingredients...</div>

  const { items_by_group, checked, ordered, start_date, end_date } = grocery
  const checkedSet = new Set((checked || []).map(n => n.toLowerCase()))
  const orderedSet = new Set((ordered || []).map(n => n.toLowerCase()))

  // Items already on the list
  const onListSet = new Set()
  for (const group of Object.values(items_by_group)) {
    for (const item of group) {
      onListSet.add(item.name.toLowerCase())
    }
  }

  // Count totals
  let totalItems = 0
  let checkedCount = 0
  for (const group of Object.values(items_by_group)) {
    for (const item of group) {
      totalItems++
      if (checkedSet.has(item.name.toLowerCase())) checkedCount++
    }
  }
  const remainingCount = totalItems - checkedCount

  // Sort groups by defined order
  const sortedGroups = Object.keys(items_by_group).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const hasItems = sortedGroups.length > 0

  const handleToggle = async (name) => {
    const newChecked = new Set(checkedSet)
    if (newChecked.has(name.toLowerCase())) {
      newChecked.delete(name.toLowerCase())
    } else {
      newChecked.add(name.toLowerCase())
    }
    setGrocery({ ...grocery, checked: [...newChecked] })
    await api.toggleGroceryItem(name)
  }

  const handleAddSubmit = async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const result = await api.addGroceryItem(trimmed)
    setGrocery(result)
    setAddText('')
  }

  const listContent = (
    <>
      {hasItems && checkedCount > 0 && (
        <div className="grocery-controls">
          <button
            className="btn sm"
            onClick={() => setHideChecked(!hideChecked)}
          >
            {hideChecked ? 'Show all' : 'Hide checked'}
          </button>
        </div>
      )}

      {!hasItems ? (
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No items yet. Add meals to your grocery list from the Plan page, or add regulars above.</p>
        </div>
      ) : (
        sortedGroups.map(group => {
          const items = items_by_group[group]
          const visibleItems = hideChecked
            ? items.filter(item => !checkedSet.has(item.name.toLowerCase()))
            : items
          if (visibleItems.length === 0) return null

          const groupLeft = items.filter(i =>
            !checkedSet.has(i.name.toLowerCase()) && !orderedSet.has(i.name.toLowerCase())
          ).length

          return (
            <div key={group} className="grocery-group">
              <h3>
                {group}
                {groupLeft > 0 && <span className="group-left-count">{groupLeft} left</span>}
              </h3>
              {visibleItems.map(item => {
                const nameLower = item.name.toLowerCase()
                const isChecked = checkedSet.has(nameLower)
                const isOrdered = orderedSet.has(nameLower)
                const stateClass = isChecked ? 'checked' : isOrdered ? 'ordered' : ''
                return (
                  <div
                    key={item.name}
                    className={`grocery-item ${stateClass}`}
                    onClick={() => !isOrdered && handleToggle(item.name)}
                  >
                    <span className={`check ${stateClass}`}>
                      {isChecked ? '\u2713' : isOrdered ? '\u2191' : ''}
                    </span>
                    <span className={`item-name ${isChecked ? 'done-text' : isOrdered ? 'ordered-text' : ''}`}>
                      {item.name}
                      {item.meal_count > 1 && (
                        <span className="multi-badge">x{item.meal_count}</span>
                      )}
                    </span>
                    {item.for_meals && item.for_meals.length > 0 && (
                      <span className="item-meals">
                        {item.for_meals.join(', ')}
                        {isOrdered && ' \u00B7 ordered'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </>
  )

  const addBar = (
    <div className={`add-bar ${sidebar ? '' : 'add-bar-mobile'}`}>
      <div className="add-form">
        <AutocompleteInput
          value={addText}
          onChange={setAddText}
          onSubmit={handleAddSubmit}
          candidates={itemPool}
          exclude={onListSet}
          placeholder="Anything else while you're there?"
          inputClassName="add-input"
        />
        <button className="btn primary" onClick={() => addText.trim() && handleAddSubmit(addText)}>+</button>
      </div>
    </div>
  )

  const formatTripSubtitle = () => {
    if (!start_date) return ''
    const s = new Date(start_date + 'T00:00:00')
    const month = s.toLocaleDateString('en-US', { month: 'short' })
    const day = s.getDate()
    const itemText = `${remainingCount} item${remainingCount !== 1 ? 's' : ''} left`
    return `${month} ${day} trip \u00B7 ${itemText}`
  }

  const sidebarTitleBlock = (
    <div className="sidebar-title">
      <span>Grocery List</span>
      {remainingCount > 0 && (
        <span className="count-badge">
          {remainingCount} item{remainingCount !== 1 ? 's' : ''} left
        </span>
      )}
    </div>
  )

  const mobileTitleBlock = (
    <div className="page-header">
      <h2 className="screen-heading">Grocery List</h2>
      <div className="screen-sub">{formatTripSubtitle()}</div>
    </div>
  )

  return (
    <>
      {sidebar ? (
        <>
          <div className="sidebar-card">
            {sidebarTitleBlock}
            {listContent}
          </div>
          {addBar}
        </>
      ) : (
        <>
          {mobileTitleBlock}
          {meals && <StatusBar status={meals.status} />}
          {addBar}
          {listContent}
        </>
      )}
    </>
  )
}
