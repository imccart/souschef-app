import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import AutocompleteInput from './AutocompleteInput'
import BentSpoonIcon from './BentSpoonIcon'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'

const GROUP_ORDER = [
  'Produce', 'Meat', 'Dairy & Eggs', 'Bread & Bakery',
  'Pasta & Grains', 'Spices & Baking', 'Condiments & Sauces',
  'Canned Goods', 'Frozen', 'Breakfast & Beverages', 'Snacks',
  'Personal Care', 'Household', 'Cleaning', 'Pets', 'Other'
]

const SWIPE_THRESHOLD = 50

function SwipeableItem({ children, onSwipeRight, className }) {
  const startX = useRef(null)
  const startY = useRef(null)
  const locked = useRef(null)
  const [offsetX, setOffsetX] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    locked.current = null
    setTransitioning(false)
  }, [])

  const onTouchMove = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    if (locked.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }

    if (locked.current !== 'horizontal') return

    e.stopPropagation()
    // Only allow rightward swipe
    setOffsetX(Math.max(0, dx))
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    startX.current = null
    startY.current = null

    if (locked.current === 'horizontal') {
      e.stopPropagation()
    }
    locked.current = null

    if (dx > SWIPE_THRESHOLD) {
      setTransitioning(true)
      setOffsetX(300)
      setTimeout(() => {
        onSwipeRight()
        setOffsetX(0)
        setTransitioning(false)
      }, 200)
    } else {
      setTransitioning(true)
      setOffsetX(0)
      setTimeout(() => setTransitioning(false), 150)
    }
  }, [onSwipeRight])

  const style = offsetX !== 0 || transitioning
    ? {
        transform: `translateX(${offsetX}px)`,
        transition: transitioning ? 'transform 0.2s ease-out' : 'none',
        opacity: offsetX > SWIPE_THRESHOLD ? 0.5 : 1,
      }
    : undefined

  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={style}
    >
      {children}
    </div>
  )
}

export default function GroceryPage({ sidebar = false }) {
  const [grocery, setGrocery] = useState(null)
  const [addText, setAddText] = useState('')
  const [addDupe, setAddDupe] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [recatItem, setRecatItem] = useState(null)
  const [hideDone, setHideDone] = useState(false)

  // Inline prompt state
  const [regularsData, setRegularsData] = useState(null)
  const [regularsChecked, setRegularsChecked] = useState(new Set())
  const [regularsExpanded, setRegularsExpanded] = useState(false)
  const [pantryData, setPantryData] = useState(null)
  const [pantryChecked, setPantryChecked] = useState(new Set())
  const [pantryExpanded, setPantryExpanded] = useState(false)

  const load = async () => {
    try {
      const g = await api.getGrocery()
      setGrocery(g)
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }

  const [itemPool, setItemPool] = useState([])
  useEffect(() => {
    api.getGrocerySuggestions().then(data => {
      setItemPool(data.suggestions || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [])

  if (loading) return <><div className="loading">Gathering ingredients...</div><FeedbackFab page="grocery" /></>
  if (loadError) return <><div className="loading">Something went wrong loading your list. Try refreshing.</div><FeedbackFab page="grocery" /></>

  const { items_by_group, checked, ordered, skipped, have_it, start_date, end_date, regulars_state, pantry_state } = grocery
  const checkedSet = new Set((checked || []).map(n => n.toLowerCase()))
  const orderedSet = new Set((ordered || []).map(n => n.toLowerCase()))
  const skippedSet = new Set((skipped || []).map(n => n.toLowerCase()))
  const haveItSet = new Set((have_it || []).map(n => n.toLowerCase()))

  const onListSet = new Set()
  for (const group of Object.values(items_by_group)) {
    for (const item of group) {
      onListSet.add(item.name.toLowerCase())
    }
  }

  let totalItems = 0
  let doneCount = 0
  const groupCounts = {}
  for (const [group, items] of Object.entries(items_by_group)) {
    let groupRemaining = 0
    for (const item of items) {
      totalItems++
      const nameLower = item.name.toLowerCase()
      if (checkedSet.has(nameLower) || skippedSet.has(nameLower) || haveItSet.has(nameLower) || orderedSet.has(nameLower)) {
        doneCount++
      } else {
        groupRemaining++
      }
    }
    groupCounts[group] = { total: items.length, remaining: groupRemaining }
  }
  const remainingCount = totalItems - doneCount

  const sortedGroups = Object.keys(items_by_group).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const hasItems = sortedGroups.length > 0

  const isGroupAllDone = (group) => {
    return groupCounts[group] && groupCounts[group].remaining === 0
  }

  const isGroupExpanded = (group) => {
    if (collapsedGroups[group] !== undefined) return !collapsedGroups[group]
    return !isGroupAllDone(group)
  }

  const handleGroupToggle = (group) => {
    const currentlyExpanded = isGroupExpanded(group)
    setCollapsedGroups(prev => ({ ...prev, [group]: currentlyExpanded }))
  }

  // Unified handler for bought/have-it/skip actions
  const handleItemAction = async (name, action) => {
    const prev = grocery
    const nl = name.toLowerCase()
    const sets = {
      checked: new Set(checkedSet),
      skipped: new Set(skippedSet),
      have_it: new Set(haveItSet),
    }

    // Unskip is a special case — just remove from skipped
    if (action === 'skip' && sets.skipped.has(nl)) {
      sets.skipped.delete(nl)
      setGrocery({ ...grocery, skipped: [...sets.skipped] })
      try { await api.unskipGroceryItem(name) } catch { setGrocery(prev) }
      return
    }

    // Toggle target set, clear the others
    const keyMap = { bought: 'checked', have_it: 'have_it', skip: 'skipped' }
    const targetKey = keyMap[action]
    if (sets[targetKey].has(nl)) {
      sets[targetKey].delete(nl)
    } else {
      sets[targetKey].add(nl)
      Object.keys(sets).filter(k => k !== targetKey).forEach(k => sets[k].delete(nl))
    }
    setGrocery({ ...grocery, checked: [...sets.checked], skipped: [...sets.skipped], have_it: [...sets.have_it] })

    const apiCall = { bought: api.toggleGroceryItem, have_it: api.haveItGroceryItem, skip: api.skipGroceryItem }
    try { await apiCall[action](name) } catch { setGrocery(prev) }
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
    if (!trimmed || addDupe) return
    try {
      const result = await api.addGroceryItem(trimmed)
      setGrocery(result)
      setAddText('')
      setAddDupe(false)
    } catch {
      // input stays so user can retry
    }
  }

  const submitPrompt = async (apiFn, selected) => {
    try {
      const result = await apiFn(selected)
      setGrocery(result)
    } catch {}
  }

  // Regulars prompt handlers
  const handleRegularsExpand = async () => {
    try {
      const data = await api.getRegulars()
      const active = (data.regulars || []).filter(r => r.active)
      setRegularsData(active)
      // Pre-check items NOT already on the list
      setRegularsChecked(new Set(active.filter(r => !onListSet.has(r.name.toLowerCase())).map(r => r.name)))
    } catch {
      setRegularsData([])
    }
    setRegularsExpanded(true)
  }

  const handleRegularsSubmit = async () => {
    await submitPrompt(api.addRegulars, [...regularsChecked])
    setRegularsExpanded(false)
  }
  const handleRegularsDismiss = async () => {
    await submitPrompt(api.addRegulars, [])
    setRegularsExpanded(false)
  }

  // Pantry prompt handlers
  const handlePantryExpand = async () => {
    try {
      const data = await api.getPantry()
      setPantryData(data.items || [])
      setPantryChecked(new Set()) // default unchecked, user checks what they need
    } catch {
      setPantryData([])
    }
    setPantryExpanded(true)
  }

  const handlePantrySubmit = async () => {
    await submitPrompt(api.addPantryItems, [...pantryChecked])
    setPantryExpanded(false)
  }
  const handlePantryDismiss = async () => {
    await submitPrompt(api.addPantryItems, [])
    setPantryExpanded(false)
  }

  // Inline prompt cards — "prompt" = full card, "done" = compact row
  const renderPromptCard = ({ state, expanded, label, doneLabel, onExpand, onSubmit, onDismiss, data, checkedSet, setChecked, groupField }) => {
    if (expanded) {
      return (
        <div className="grocery-prompt-card">
          <div className="grocery-prompt-body">
            <div className="grocery-prompt-title">{label}</div>
            <div className="grocery-prompt-desc">
              {groupField ? 'Uncheck anything you don\'t need this time.' : 'Check anything you need to restock.'}
            </div>
            {data && data.length > 0 ? (
              <div className="grocery-prompt-checklist">
                {data.map(item => {
                  const alreadyOnList = onListSet.has(item.name.toLowerCase())
                  return (
                    <div
                      key={item.id}
                      className={`grocery-prompt-check-item ${alreadyOnList ? 'on-list' : ''}`}
                      onClick={() => {
                        if (alreadyOnList) return
                        setChecked(prev => {
                          const next = new Set(prev)
                          next.has(item.name) ? next.delete(item.name) : next.add(item.name)
                          return next
                        })
                      }}
                    >
                      <div className={`grocery-prompt-check ${alreadyOnList ? 'on-list' : checkedSet.has(item.name) ? 'active' : ''}`}>
                        {(alreadyOnList || checkedSet.has(item.name)) && '\u2713'}
                      </div>
                      <span>{item.name}</span>
                      {alreadyOnList && <span className="grocery-prompt-on-list">on list</span>}
                      {!alreadyOnList && groupField && item[groupField] && <span className="grocery-prompt-group">{item[groupField]}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grocery-prompt-empty">
                {groupField ? 'No active regulars yet.' : 'No pantry items yet. Add them in My Kitchen.'}
              </div>
            )}
            <div className="grocery-prompt-actions">
              <button className="grocery-prompt-dismiss" onClick={onDismiss}>
                {groupField ? 'Not this time' : 'Skip'}
              </button>
              <button className="grocery-prompt-submit" onClick={onSubmit}>
                Add to list {checkedSet.size > 0 ? `(${checkedSet.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (state === 'done') {
      return (
        <button className="grocery-prompt-compact" onClick={onExpand}>
          <span className="grocery-prompt-compact-check">{'\u2713'}</span>
          <span>{doneLabel}</span>
          <span className="grocery-prompt-compact-edit">Update</span>
        </button>
      )
    }

    // state === 'prompt'
    return (
      <div className="grocery-prompt-card">
        <button className="grocery-prompt-trigger" onClick={onExpand}>
          <BentSpoonIcon size={18} />
          <span>{label}</span>
          <span className="grocery-prompt-arrow">{'\u203A'}</span>
        </button>
      </div>
    )
  }

  const promptCards = (
    <>
      {renderPromptCard({
        state: regulars_state, expanded: regularsExpanded,
        label: 'Add your regulars', doneLabel: 'Regulars added',
        onExpand: handleRegularsExpand, onSubmit: handleRegularsSubmit, onDismiss: handleRegularsDismiss,
        data: regularsData, checkedSet: regularsChecked, setChecked: setRegularsChecked, groupField: 'shopping_group',
      })}
      {renderPromptCard({
        state: pantry_state, expanded: pantryExpanded,
        label: 'Running low on anything?', doneLabel: 'Pantry checked',
        onExpand: handlePantryExpand, onSubmit: handlePantrySubmit, onDismiss: handlePantryDismiss,
        data: pantryData, checkedSet: pantryChecked, setChecked: setPantryChecked, groupField: null,
      })}
    </>
  )

  const isItemHidden = (nameLower) => {
    return hideDone && (checkedSet.has(nameLower) || skippedSet.has(nameLower) || haveItSet.has(nameLower) || orderedSet.has(nameLower))
  }

  const renderItem = (item) => {
    const nameLower = item.name.toLowerCase()
    const isChecked = checkedSet.has(nameLower)
    const isOrdered = orderedSet.has(nameLower)
    const isSkipped = skippedSet.has(nameLower)
    const isHaveIt = haveItSet.has(nameLower)
    const isDone = isChecked || isHaveIt
    const stateClass = isChecked ? 'checked' : isHaveIt ? 'have-it' : isOrdered ? 'ordered' : isSkipped ? 'skipped' : ''
    const hasMeals = item.for_meals && item.for_meals.length > 0

    if (isOrdered) {
      return (
        <div key={item.name} className="grocery-item-row ordered">
          <div className="grocery-item-top">
            <span className="check ordered">{'\u2191'}</span>
            <span className="item-name ordered-text">
              {item.name}
              {item.meal_count > 1 && <span className="multi-badge">x{item.meal_count}</span>}
            </span>
          </div>
          {hasMeals && (
            <div className="grocery-item-bottom">
              <span className="item-meals">{item.for_meals.join(', ')} {'\u00B7'} ordered</span>
            </div>
          )}
        </div>
      )
    }

    if (isSkipped) {
      return (
        <div
          key={item.name}
          className="grocery-item-row skipped"
          onClick={() => handleItemAction(item.name, 'skip')}
        >
          <div className="grocery-item-top">
            <span className="item-name skipped-text">
              {item.name}
              {item.meal_count > 1 && <span className="multi-badge">x{item.meal_count}</span>}
            </span>
            <span className="grocery-item-undo">Undo</span>
          </div>
        </div>
      )
    }

    const itemContent = (
      <>
        <div className="grocery-item-top">
          {isDone && <span className="check done">{'\u2713'}</span>}
          <span className={`item-name ${isDone ? 'done-text' : ''}`}>
            {item.name}
            {item.meal_count > 1 && <span className="multi-badge">x{item.meal_count}</span>}
          </span>
          <button
            className="recat-btn"
            title="Move to different aisle"
            onClick={(e) => { e.stopPropagation(); setRecatItem(item.name) }}
          >{'\u2630'}</button>
        </div>
        <div className="grocery-item-bottom">
          {hasMeals && (
            <span className="item-meals">{item.for_meals.join(', ')}</span>
          )}
          <div className="grocery-item-actions">
            <button
              className="grocery-skip-btn"
              onClick={() => handleItemAction(item.name, 'skip')}
              title="Don't need this time"
            >Nevermind</button>
            <div className="grocery-item-toggle">
              <button
                className={`toggle-seg bought ${isChecked ? 'active' : ''}`}
                onClick={() => handleItemAction(item.name, 'bought')}
                title="Picked up at the store"
              >Bought</button>
              <button
                className={`toggle-seg have-it ${isHaveIt ? 'active' : ''}`}
                onClick={() => handleItemAction(item.name, 'have_it')}
                title="Already have it at home"
              >Have it</button>
            </div>
          </div>
        </div>
      </>
    )

    return (
      <SwipeableItem
        key={item.name}
        className={`grocery-item-row ${stateClass}`}
        onSwipeRight={() => handleItemAction(item.name, 'skip')}
      >
        {itemContent}
      </SwipeableItem>
    )
  }

  const listContent = (
    <>
      {hasItems && doneCount > 0 && (
        <button className="hide-checked-toggle" onClick={() => setHideDone(h => !h)}>
          {hideDone ? `Show done` : `Hide done`} ({doneCount})
        </button>
      )}
      {!hasItems ? (
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No items yet. Tap the cart icon on a meal to add its ingredients.</p>
        </div>
      ) : remainingCount === 0 ? (
        <div className="empty-state">
          <div className="closed-sign">
            <div className="closed-sign-hole" />
            <div className="closed-sign-text">Kitchen's closed</div>
          </div>
        </div>
      ) : (
        sortedGroups.map(group => {
          const items = items_by_group[group]
          const visibleItems = items.filter(item => !isItemHidden(item.name.toLowerCase()))
          if (visibleItems.length === 0) return null

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
              {expanded && visibleItems.map(renderItem)}
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
          onChange={(val) => {
            setAddText(val)
            setAddDupe(val.trim() && onListSet.has(val.trim().toLowerCase()))
          }}
          onSubmit={handleAddSubmit}
          candidates={itemPool}
          exclude={onListSet}
          placeholder="Anything else while you're there?"
          inputClassName={`add-input${addDupe ? ' prefs-dupe' : ''}`}
        />
        <button className="btn primary" onClick={() => addText.trim() && handleAddSubmit(addText)} disabled={addDupe}>+</button>
      </div>
      {addDupe && <div className="prefs-dupe-msg" style={{ marginTop: 4 }}>Already on your list</div>}
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
            {promptCards}
            {listContent}
          </div>
          {addBar}
        </>
      ) : (
        <>
          {mobileTitleBlock}
          {addBar}
          {promptCards}
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
