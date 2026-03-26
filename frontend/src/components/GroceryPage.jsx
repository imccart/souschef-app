import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import AutocompleteInput from './AutocompleteInput'
import BentSpoonIcon from './BentSpoonIcon'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'
import ls from '../shared/lists.module.css'
import styles from './GroceryPage.module.css'

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
  const [selectedItem, setSelectedItem] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [showRecent, setShowRecent] = useState(false)
  const [stapleSuggestion, setStapleSuggestion] = useState(null)
  const [shoppingMode, setShoppingMode] = useState(false)
  const [showShopChecked, setShowShopChecked] = useState(false)
  const [wakeLock, setWakeLock] = useState(null)

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

  const { items_by_group, checked, ordered, have_it, removed, recently_checked, start_date } = grocery
  const checkedSet = new Set((checked || []).map(n => n.toLowerCase()))
  const orderedSet = new Set((ordered || []).map(n => n.toLowerCase()))
  const haveItSet = new Set((have_it || []).map(n => n.toLowerCase()))
  const removedSet = new Set((removed || []).map(n => n.toLowerCase()))

  const onListSet = new Set()
  for (const group of Object.values(items_by_group)) {
    for (const item of group) {
      const nl = item.name.toLowerCase()
      if (!checkedSet.has(nl) && !haveItSet.has(nl) && !removedSet.has(nl)) {
        onListSet.add(nl)
      }
    }
  }

  // Count only active (not checked/have_it/ordered) items per group
  let totalActive = 0
  const groupCounts = {}
  for (const [group, items] of Object.entries(items_by_group)) {
    let groupRemaining = 0
    for (const item of items) {
      const nameLower = item.name.toLowerCase()
      if (!checkedSet.has(nameLower) && !haveItSet.has(nameLower) && !orderedSet.has(nameLower) && !removedSet.has(nameLower)) {
        groupRemaining++
        totalActive++
      }
    }
    groupCounts[group] = { remaining: groupRemaining }
  }

  const sortedGroups = Object.keys(items_by_group).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const hasItems = sortedGroups.length > 0
  const totalItems = totalActive + Object.values(groupCounts).reduce((sum, g) => sum - g.remaining, 0) + totalActive
  const checkedCount = Object.values(items_by_group).flat().filter(i => {
    const nl = i.name.toLowerCase()
    return checkedSet.has(nl) || haveItSet.has(nl)
  }).length

  // Shopping mode enter/exit
  const enterShoppingMode = async () => {
    setShoppingMode(true)
    try {
      const lock = await navigator.wakeLock.request('screen')
      setWakeLock(lock)
    } catch { /* wake lock not supported — fine */ }
  }

  const exitShoppingMode = () => {
    setShoppingMode(false)
    if (wakeLock) {
      wakeLock.release().catch(() => {})
      setWakeLock(null)
    }
  }

  const handleShopCheck = async (name) => {
    await handleItemAction(name, 'bought')
  }

  const handleShopUncheck = async (name) => {
    // Toggle bought back off
    await handleItemAction(name, 'bought')
  }

  // Shopping mode render
  if (shoppingMode) {
    const shopListRef = React.createRef()
    const allChecked = []
    const handleShopCheckAndScroll = async (name) => {
      await handleShopCheck(name)
      requestAnimationFrame(() => {
        if (shopListRef.current) shopListRef.current.scrollTop = 0
      })
    }

    return (
      <div className={styles.shoppingMode}>
        <div className={styles.shoppingHeader}>
          <div className={styles.shoppingCount}>
            {checkedCount} of {checkedCount + totalActive}
          </div>
          <button className={styles.shoppingDone} onClick={exitShoppingMode}>Done</button>
        </div>
        <div className={styles.shoppingList} ref={shopListRef}>
          {sortedGroups.map(group => {
            const items = items_by_group[group]
            const active = items.filter(i => {
              const nl = i.name.toLowerCase()
              return !checkedSet.has(nl) && !haveItSet.has(nl) && !removedSet.has(nl)
            })
            const done = items.filter(i => {
              const nl = i.name.toLowerCase()
              return checkedSet.has(nl) || haveItSet.has(nl)
            })
            done.forEach(item => allChecked.push(item))
            if (active.length === 0) return null
            return (
              <div key={group} className={styles.shoppingGroup}>
                <div className={styles.shoppingGroupHeader}>{group}</div>
                {active.map(item => (
                  <SwipeableItem
                    key={item.name}
                    className={styles.shoppingItem}
                    onSwipeRight={() => handleShopCheckAndScroll(item.name)}
                  >
                    <div className={styles.shoppingItemName} onClick={() => handleShopCheckAndScroll(item.name)}>
                      {item.name}
                      {item.meal_count > 1 && <span className={styles.shoppingMulti}>x{item.meal_count}</span>}
                    </div>
                  </SwipeableItem>
                ))}
              </div>
            )
          })}
          {totalActive === 0 && (
            <div className={styles.shoppingAllDone}>
              All done! {'\u{1F389}'}
            </div>
          )}
          {allChecked.length > 0 && (
            <div className={styles.shoppingCheckedSection}>
              <div
                className={styles.shoppingCheckedHeader}
                onClick={() => setShowShopChecked(prev => !prev)}
              >
                {showShopChecked ? '\u25BC' : '\u25B6'} {allChecked.length} checked
              </div>
              {showShopChecked && allChecked.map(item => (
                <div
                  key={item.name}
                  className={`${styles.shoppingItem} ${styles.checked}`}
                  onClick={() => handleShopUncheck(item.name)}
                >
                  <div className={styles.shoppingItemName}>{item.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

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

    if (action === 'remove') {
      // Optimistic: remove from all groups
      const updated = {}
      for (const [g, items] of Object.entries(items_by_group)) {
        updated[g] = items.filter(i => i.name.toLowerCase() !== nl)
      }
      setGrocery({ ...grocery, items_by_group: updated })
      try { await api.removeGroceryItem(name) } catch { setGrocery(prev) }
      return
    }

    // Bought or have_it — optimistically add to the right set
    const sets = {
      checked: new Set(checkedSet),
      have_it: new Set(haveItSet),
    }
    const targetKey = action === 'bought' ? 'checked' : 'have_it'
    if (sets[targetKey].has(nl)) {
      sets[targetKey].delete(nl)
    } else {
      sets[targetKey].add(nl)
      Object.keys(sets).filter(k => k !== targetKey).forEach(k => sets[k].delete(nl))
    }
    setGrocery({ ...grocery, checked: [...sets.checked], have_it: [...sets.have_it] })

    const apiCall = { bought: api.toggleGroceryItem, have_it: api.haveItGroceryItem }
    try {
      const result = await apiCall[action](name)
      if (result.suggest_staple) {
        setStapleSuggestion(result.suggest_staple)
      }
    } catch { setGrocery(prev) }
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
    if (regularsExpanded) {
      setRegularsExpanded(false)
      return
    }
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
  // Pantry handlers
  const handlePantryExpand = async () => {
    if (pantryExpanded) {
      setPantryExpanded(false)
      return
    }
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

  const handleUndoRecent = async (name) => {
    const prev = grocery
    // Optimistic: remove from checked/have_it/removed
    setGrocery({
      ...grocery,
      checked: (grocery.checked || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      have_it: (grocery.have_it || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      removed: (grocery.removed || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      recently_checked: (grocery.recently_checked || []).filter(r => r.name.toLowerCase() !== name.toLowerCase()),
    })
    try {
      const item = (grocery.recently_checked || []).find(r => r.name.toLowerCase() === name.toLowerCase())
      if (item?.type === 'bought') {
        await api.toggleGroceryItem(name)
      } else if (item?.type === 'removed') {
        const result = await api.undoRemoveGroceryItem(name)
        setGrocery(result)
        return
      } else {
        await api.haveItGroceryItem(name)
      }
    } catch { setGrocery(prev) }
  }

  const renderActionCard = ({ expanded, label, onExpand, onSubmit, data, checkedSet, setChecked, groupField }) => {
    if (expanded) {
      return (
        <div className={styles.groceryPromptCard}>
          <div className={styles.groceryPromptBody}>
            <div className={styles.groceryPromptTitle}>{label}</div>
            <div className={styles.groceryPromptDesc}>
              {groupField ? 'Uncheck anything you don\'t need this time.' : 'Check anything you need to restock.'}
            </div>
            {data && data.length > 0 ? (
              <div className={styles.groceryPromptChecklist}>
                {data.map(item => {
                  const alreadyOnList = onListSet.has(item.name.toLowerCase())
                  return (
                    <div
                      key={item.id}
                      className={`${styles.groceryPromptCheckItem} ${alreadyOnList ? styles.onList : ''}`}
                      onClick={() => {
                        if (alreadyOnList) return
                        setChecked(prev => {
                          const next = new Set(prev)
                          next.has(item.name) ? next.delete(item.name) : next.add(item.name)
                          return next
                        })
                      }}
                    >
                      <div className={`${styles.groceryPromptCheck} ${alreadyOnList ? styles.onList : checkedSet.has(item.name) ? styles.active : ''}`}>
                        {(alreadyOnList || checkedSet.has(item.name)) && '\u2713'}
                      </div>
                      <span>{item.name}</span>
                      {alreadyOnList && <span className={styles.groceryPromptOnList}>on list</span>}
                      {!alreadyOnList && groupField && item[groupField] && <span className={styles.groceryPromptGroup}>{item[groupField]}</span>}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.groceryPromptEmpty}>
                {groupField ? 'No regulars yet. Add them in My Kitchen.' : 'No staples yet. Add them in My Kitchen.'}
              </div>
            )}
            <div className={styles.groceryPromptActions}>
              <button className={styles.groceryPromptDismiss} onClick={() => { setChecked(new Set()); onExpand() }}>
                Cancel
              </button>
              <button className={styles.groceryPromptSubmit} onClick={onSubmit}>
                Add to list {checkedSet.size > 0 ? `(${checkedSet.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <button className={styles.groceryActionBtn} onClick={onExpand}>
        <span>{label}</span>
        <span className={styles.groceryPromptArrow}>{'\u203A'}</span>
      </button>
    )
  }

  const promptCards = (
    <>
      <div className={styles.groceryActions}>
        {renderActionCard({
          expanded: regularsExpanded,
          label: 'Add my regulars',
          onExpand: handleRegularsExpand, onSubmit: handleRegularsSubmit,
          data: regularsData, checkedSet: regularsChecked, setChecked: setRegularsChecked, groupField: 'shopping_group',
        })}
        {renderActionCard({
          expanded: pantryExpanded,
          label: 'Check my staples',
          onExpand: handlePantryExpand, onSubmit: handlePantrySubmit,
          data: pantryData, checkedSet: pantryChecked, setChecked: setPantryChecked, groupField: null,
        })}
      </div>
    </>
  )

  const renderItem = (item) => {
    const nameLower = item.name.toLowerCase()
    const isChecked = checkedSet.has(nameLower)
    const isOrdered = orderedSet.has(nameLower)
    const isHaveIt = haveItSet.has(nameLower)
    const isRemoved = removedSet.has(nameLower)
    const isDone = isChecked || isHaveIt || isRemoved
    const hasMeals = item.for_meals && item.for_meals.length > 0
    const isSelected = selectedItem === item.name

    // Hide checked/have_it/removed items — they go to "recently checked" section
    if (isDone) return null

    const handleToggle = (e) => {
      e.stopPropagation()
      setSelectedItem(isSelected ? null : item.name)
      setEditingNote(null)
    }

    const itemContent = (
      <>
        <div className={styles.groceryItemTop}>
          <span className={styles.itemName}>
            {item.name}
            {item.meal_count > 1 && <span className={styles.multiBadge}>x{item.meal_count}</span>}
          </span>
          {isOrdered && <span className={styles.orderedBadge}>{'\u2191'} ordered</span>}
          <button className="grocery-expand-btn" onClick={handleToggle} title="Actions">{'\u2630'}</button>
        </div>
        {item.notes && (
          <div className={styles.groceryNote}>
            {item.notes}
          </div>
        )}
        {hasMeals && (
          <div className={styles.groceryItemMeals}>
            <span className={styles.itemMeals}>{item.for_meals.join(', ')}</span>
          </div>
        )}
        {isSelected && (
          <>
            {editingNote === item.name ? (
              <input
                type="text"
                className={`note-input ${styles.groceryNoteInput}`}
                placeholder="Add a note..."
                value={noteText}
                autoFocus
                onChange={(e) => setNoteText(e.target.value)}
                onBlur={() => {
                  if (noteText !== (item.notes || '')) {
                    api.updateGroceryNote(item.name, noteText).then(result => setGrocery(result)).catch(() => {})
                  }
                  setEditingNote(null)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
            <div className={styles.groceryActionBar}>
              <button className={styles.groceryActionBtnItem} onClick={() => handleItemAction(item.name, 'bought')}>Bought</button>
              <button className={styles.groceryActionBtnItem} onClick={() => handleItemAction(item.name, 'have_it')}>Have it</button>
              <button className={styles.groceryActionBtnItem} onClick={(e) => { e.stopPropagation(); setEditingNote(item.name); setNoteText(item.notes || '') }}>Note</button>
              <button className={styles.groceryActionBtnItem} onClick={(e) => { e.stopPropagation(); setRecatItem(item.name) }}>Aisle</button>
              <button className={`${styles.groceryActionBtnItem} ${styles.remove}`} onClick={() => handleItemAction(item.name, 'remove')}>{'\u00D7'}</button>
            </div>
          </>
        )}
      </>
    )

    return (
      <SwipeableItem
        key={item.name}
        className={`${styles.groceryItemRow}${isSelected ? ` ${styles.selected}` : ''}`}
        onSwipeRight={() => handleItemAction(item.name, 'bought')}
      >
        {itemContent}
      </SwipeableItem>
    )
  }

  const listContent = (
    <>
      {!hasItems ? (
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No items yet. Tap the cart icon on a meal to add its ingredients.</p>
        </div>
      ) : totalActive === 0 ? (
        <div className="empty-state">
          <div className="icon"><BentSpoonIcon size={32} /></div>
          <p>Nothing left to grab.</p>
        </div>
      ) : (
        sortedGroups.map(group => {
          const items = items_by_group[group]
          const { remaining: groupLeft } = groupCounts[group]
          if (groupLeft === 0) return null

          const expanded = isGroupExpanded(group)

          return (
            <div key={group} className={styles.groceryGroup}>
              <button
                className={styles.groceryGroupHeader}
                onClick={() => handleGroupToggle(group)}
              >
                <span className={styles.groceryGroupArrow}>{expanded ? '\u25B4' : '\u25BE'}</span>
                <span className={styles.groceryGroupTitle}>{group}</span>
                <span className={styles.groupLeftCount}>{groupLeft}</span>
              </button>
              {expanded && items.map(renderItem)}
            </div>
          )
        })
      )}
      {/* Staple suggestion */}
      {stapleSuggestion && (
        <div className={styles.stapleSuggestion}>
          <span>You always have <strong>{stapleSuggestion}</strong> on hand.</span>
          <div className={styles.stapleSuggestionActions}>
            <button onClick={() => {
              api.addPantryItem(stapleSuggestion, '').catch(() => {})
              setStapleSuggestion(null)
            }}>Add to staples</button>
            <button className={styles.dismiss} onClick={() => setStapleSuggestion(null)}>Not now</button>
          </div>
        </div>
      )}
      {/* Recently checked — 24-hour undo window */}
      {recently_checked && recently_checked.length > 0 && (
        <div className={styles.recentlyChecked}>
          <button className={styles.recentlyCheckedToggle} onClick={() => setShowRecent(r => !r)}>
            Recently checked ({recently_checked.length})
            <span className={styles.groceryPromptArrow}>{showRecent ? '\u25B4' : '\u25BE'}</span>
          </button>
          {showRecent && (
            <div className={styles.recentlyCheckedList}>
              {recently_checked.map(r => (
                <div key={r.name} className={styles.recentlyCheckedItem}>
                  <span>{r.name}</span>
                  <span className={styles.recentlyCheckedType}>{r.type === 'bought' ? 'Bought' : r.type === 'removed' ? 'Removed' : 'Have it'}</span>
                  <button className={styles.recentlyCheckedUndo} onClick={() => handleUndoRecent(r.name)}>Undo</button>
                </div>
              ))}
            </div>
          )}
        </div>
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
          inputClassName={`add-input${addDupe ? ` ${ls.dupe}` : ''}`}
        />
        <button className="btn primary" onClick={() => addText.trim() && handleAddSubmit(addText)} disabled={addDupe}>+</button>
      </div>
      {addDupe && <div className={ls.dupeMsg} style={{ marginTop: 4 }}>Already on your list</div>}
    </div>
  )

  const formatTripSubtitle = () => {
    if (!start_date) return ''
    const s = new Date(start_date + 'T00:00:00')
    const month = s.toLocaleDateString('en-US', { month: 'short' })
    const day = s.getDate()
    const itemText = `${totalActive} item${totalActive !== 1 ? 's' : ''} left`
    return `${month} ${day} trip \u00B7 ${itemText}`
  }

  const sidebarTitleBlock = (
    <div className={styles.sidebarTitle}>
      <span>Grocery List</span>
      {totalActive > 0 && (
        <span className={styles.countBadge}>
          {totalActive} item{totalActive !== 1 ? 's' : ''} left
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
        <div className={styles.colGrocery}>
          <div className={styles.sidebarCard}>
            {sidebarTitleBlock}
            {promptCards}
            {listContent}
          </div>
          {addBar}
        </div>
      ) : (
        <>
          {mobileTitleBlock}
          {promptCards}
          {addBar}
          {listContent}
          {totalActive > 0 && (
            <button className={styles.shoppingNowBtn} onClick={enterShoppingMode}>
              Shopping Now
            </button>
          )}
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
