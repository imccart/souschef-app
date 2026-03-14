import { useState, useEffect } from 'react'
import { api } from '../api/client'
import AutocompleteInput from './AutocompleteInput'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'

const GROUP_ORDER = [
  'Produce', 'Meat', 'Dairy & Eggs', 'Bread & Bakery',
  'Pasta & Grains', 'Spices & Baking', 'Condiments & Sauces',
  'Canned Goods', 'Frozen', 'Breakfast & Beverages', 'Snacks',
  'Personal Care', 'Household', 'Cleaning', 'Pets', 'Other'
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
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [recatItem, setRecatItem] = useState(null) // item name being recategorized
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('souschef_grocery_banner_seen') === 'true'
  )

  const load = async () => {
    try {
      const [g, m] = await Promise.all([api.getGrocery(), api.getMeals()])
      setGrocery(g)
      setMeals(m)
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }

  // Load item pool for autocomplete
  const [itemPool, setItemPool] = useState([])
  useEffect(() => {
    api.getGrocerySuggestions().then(data => {
      setItemPool(data.suggestions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [])

  if (loading) return <><div className="loading">Gathering ingredients...</div><FeedbackFab page="grocery" /></>
  if (loadError) return <><div className="loading">Something went wrong loading your list. Try refreshing.</div><FeedbackFab page="grocery" /></>

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

  // Count totals per group and overall
  let totalItems = 0
  let checkedCount = 0
  const groupCounts = {}
  for (const [group, items] of Object.entries(items_by_group)) {
    let groupRemaining = 0
    for (const item of items) {
      totalItems++
      const nameLower = item.name.toLowerCase()
      if (checkedSet.has(nameLower)) {
        checkedCount++
      } else if (!orderedSet.has(nameLower)) {
        groupRemaining++
      }
    }
    groupCounts[group] = { total: items.length, remaining: groupRemaining }
  }
  const remainingCount = totalItems - checkedCount

  // Sort groups by defined order
  const sortedGroups = Object.keys(items_by_group).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const hasItems = sortedGroups.length > 0

  // Auto-collapse groups where all items are checked or ordered
  const isGroupAllDone = (group) => {
    return groupCounts[group] && groupCounts[group].remaining === 0
  }

  const isGroupExpanded = (group) => {
    // If user has explicitly toggled, respect that
    if (collapsedGroups[group] !== undefined) return !collapsedGroups[group]
    // Auto-collapse if all done
    return !isGroupAllDone(group)
  }

  const handleGroupToggle = (group) => {
    const currentlyExpanded = isGroupExpanded(group)
    setCollapsedGroups(prev => ({ ...prev, [group]: currentlyExpanded }))
  }

  const handleToggle = async (name) => {
    const prev = grocery
    const newChecked = new Set(checkedSet)
    if (newChecked.has(name.toLowerCase())) {
      newChecked.delete(name.toLowerCase())
    } else {
      newChecked.add(name.toLowerCase())
    }
    setGrocery({ ...grocery, checked: [...newChecked] })
    try {
      await api.toggleGroceryItem(name)
    } catch {
      setGrocery(prev) // rollback on failure
    }
  }

  const handleRecategorize = async (group) => {
    if (!recatItem) return
    try {
      const result = await api.recategorizeItem(recatItem, group)
      setGrocery(result)
    } catch {
      // stay on current state
    }
    setRecatItem(null)
  }

  const handleAddSubmit = async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const result = await api.addGroceryItem(trimmed)
      setGrocery(result)
      setAddText('')
    } catch {
      // input stays so user can retry
    }
  }

  const showBanner = hasItems && !bannerDismissed

  const handleDismissBanner = () => {
    localStorage.setItem('souschef_grocery_banner_seen', 'true')
    setBannerDismissed(true)
  }

  const listContent = (
    <>
      {showBanner && (
        <div className="grocery-banner">
          <span>This list was built from your meals, minus what's in your pantry and regulars.</span>
          <button className="grocery-banner-dismiss" onClick={handleDismissBanner}>{'\u00D7'}</button>
        </div>
      )}
      {!hasItems ? (
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No items yet. Tap the cart on a meal to add it, or use Build My List to add everything at once.</p>
        </div>
      ) : (
        sortedGroups.map(group => {
          const items = items_by_group[group]
          const { remaining: groupLeft } = groupCounts[group]
          const expanded = isGroupExpanded(group)
          const allDone = isGroupAllDone(group)

          return (
            <div key={group} className="grocery-group">
              <button
                className={`grocery-group-header ${allDone ? 'all-done' : ''}`}
                onClick={() => handleGroupToggle(group)}
              >
                <span className="grocery-group-arrow">{expanded ? '\u25B4' : '\u25BE'}</span>
                <span className="grocery-group-title">{group}</span>
                {groupLeft > 0 ? (
                  <span className="group-left-count">{groupLeft} left</span>
                ) : (
                  <span className="group-left-count done">{'\u2713'} done</span>
                )}
              </button>
              {expanded && items.map(item => {
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
                    <button
                      className="recat-btn"
                      title="Move to different aisle"
                      onClick={(e) => { e.stopPropagation(); setRecatItem(item.name) }}
                    >{'\u2630'}</button>
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
          {addBar}
          {listContent}
        </>
      )}

      {recatItem && (
        <Sheet onClose={() => setRecatItem(null)}>
          <div className="sheet-title">Move "{recatItem}"</div>
          <div className="sheet-sub">Pick a shopping group</div>
          <div className="recat-options">
            {GROUP_ORDER.map(g => (
              <button
                key={g}
                className="recat-option"
                onClick={() => handleRecategorize(g)}
              >{g}</button>
            ))}
          </div>
        </Sheet>
      )}
      <FeedbackFab page="grocery" />
    </>
  )
}
