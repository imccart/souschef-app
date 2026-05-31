import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import AutocompleteInput from './AutocompleteInput'
import BentSpoonIcon from './BentSpoonIcon'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'
import { compareKey } from '../utils/compareKey'
import ls from '../shared/lists.module.css'
import styles from './GroceryPage.module.css'

const GROUP_ORDER = [
  'Produce', 'Meat', 'Dairy & Eggs', 'Bread & Bakery',
  'Pasta & Grains', 'Spices & Baking', 'Condiments & Sauces',
  'Canned Goods', 'Frozen', 'Breakfast & Beverages', 'Snacks',
  'Personal Care', 'Household', 'Cleaning', 'Pets', 'Other'
]

const SWIPE_THRESHOLD = 80
const LOCK_THRESHOLD = 12
const HORIZONTAL_LOCK_RATIO = 1.8

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
    e.stopPropagation()
  }, [])

  const onTouchMove = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    if (locked.current === null) {
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)
      // Only lock once a clear gesture has emerged. Require horizontal motion
      // to clearly dominate vertical (1.8x) before locking horizontal —
      // otherwise a scroll with slight diagonal drift gets misread as a swipe.
      if (adx > LOCK_THRESHOLD && adx > ady * HORIZONTAL_LOCK_RATIO) {
        locked.current = 'horizontal'
      } else if (ady > LOCK_THRESHOLD) {
        locked.current = 'vertical'
      }
    }

    if (locked.current !== 'horizontal') return

    e.stopPropagation()
    setOffsetX(Math.max(0, dx))
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current
    startX.current = null
    startY.current = null

    if (locked.current === 'horizontal') {
      e.stopPropagation()
    }
    locked.current = null

    // Re-check the FINAL motion vector at touch-end. The lock above commits
    // early based on the first few samples; if the user started slightly right
    // then went up/down, the locked state would still trigger the swipe even
    // though the gesture ended mostly vertical. Require the final dx to clear
    // the threshold AND clearly dominate dy.
    const finalIsHorizontalSwipe =
      dx > SWIPE_THRESHOLD && dx > Math.abs(dy) * HORIZONTAL_LOCK_RATIO

    if (finalIsHorizontalSwipe) {
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
  const [qtyEditing, setQtyEditing] = useState(null)
  const [showRecent, setShowRecent] = useState(false)
  const [stapleSuggestion, setStapleSuggestion] = useState(null)
  const [shoppingMode, setShoppingMode] = useState(false)
  const [showShopChecked, setShowShopChecked] = useState(false)
  const shopListRef = useRef(null)
  const [wakeLock, setWakeLock] = useState(null)

  // Inline prompt state
  const [regularsData, setRegularsData] = useState(null)
  const [regularsChecked, setRegularsChecked] = useState(new Set())
  const [regularsExpanded, setRegularsExpanded] = useState(false)
  const [pantryData, setPantryData] = useState(null)
  const [pantryChecked, setPantryChecked] = useState(new Set())
  const [pantryExpanded, setPantryExpanded] = useState(false)
  const [bundlesData, setBundlesData] = useState(null)
  const [bundlesExpanded, setBundlesExpanded] = useState(false)

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

  // Refetch when app regains focus (picks up changes from household members)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (loading) return <><div className="loading">Gathering ingredients...</div><FeedbackFab page="grocery" /></>
  if (loadError) return <><div className="loading">Something went wrong loading your list. Try refreshing.</div><FeedbackFab page="grocery" /></>

  const { items_by_group, checked, ordered, have_it, removed, recently_checked, start_date } = grocery
  // items_by_group from the backend now contains ONLY active rows (not have-it'd,
  // checked, or removed). The checked / have_it / removed name lists below still
  // include completed-state rows, but they're only for the recently-checked
  // section and "ordered" badge — they no longer drive active-list filtering
  // (would incorrectly hide a fresh active row sharing a name with a stale
  // completed one).
  const checkedSet = new Set((checked || []).map(n => n.toLowerCase()))
  const orderedSet = new Set((ordered || []).map(n => n.toLowerCase()))
  const haveItSet = new Set((have_it || []).map(n => n.toLowerCase()))
  const removedSet = new Set((removed || []).map(n => n.toLowerCase()))

  // Items "on the list" exclude ordered rows (sent to Kroger, awaiting
  // reconciliation — they live on the Order page). User can still re-add the
  // same item as an active sibling row (e.g., picking it up in-store too).
  // Keyed on compareKey so plural/singular variants of the same item resolve
  // to one entry (matches the backend's INSERT-time dedup).
  const onListSet = new Set()
  for (const group of Object.values(items_by_group)) {
    for (const item of group) {
      const nl = item.name.toLowerCase()
      if (!orderedSet.has(nl)) onListSet.add(compareKey(item.name))
    }
  }

  let totalActive = 0
  const groupCounts = {}
  for (const [group, items] of Object.entries(items_by_group)) {
    const groupRemaining = items.filter(i => !orderedSet.has(i.name.toLowerCase())).length
    totalActive += groupRemaining
    groupCounts[group] = { remaining: groupRemaining }
  }

  const sortedGroups = Object.keys(items_by_group).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const hasItems = sortedGroups.length > 0

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

  // On a failed mutation, the in-memory `prev` snapshot may itself be stale —
  // a previous concurrent optimistic update could have already removed items
  // from it. Refetch from the server (the source of truth) so we don't restore
  // a snapshot that's missing rows. Snapshot is the last-resort fallback if
  // even the refetch fails (e.g. offline).
  const rollback = async (prev) => {
    try { setGrocery(await api.getGrocery()) }
    catch { setGrocery(prev) }
  }

  const handleItemAction = async (item, action) => {
    const prev = grocery
    const nl = item.name.toLowerCase()

    if (action === 'remove') {
      // Optimistic: remove from all groups
      const updated = {}
      for (const [g, items] of Object.entries(items_by_group)) {
        updated[g] = items.filter(i => i.id !== item.id)
      }
      setGrocery({ ...grocery, items_by_group: updated })
      try { await api.removeGroceryItem(item.id) } catch { rollback(prev) }
      return
    }

    // Bought or have_it — optimistically remove the row from items_by_group
    // (it's no longer active) and add the name to the right list.
    const optimisticGroups = {}
    for (const [g, gItems] of Object.entries(items_by_group)) {
      optimisticGroups[g] = gItems.filter(i => i.id !== item.id)
    }
    const targetField = action === 'bought' ? 'checked' : 'have_it'
    setGrocery({
      ...grocery,
      items_by_group: optimisticGroups,
      [targetField]: [...(grocery[targetField] || []), item.name],
    })

    const apiCall = { bought: api.toggleGroceryItem, have_it: api.haveItGroceryItem }
    try {
      const result = await apiCall[action](item.id)
      setGrocery(result)
      if (result.suggest_staple) {
        setStapleSuggestion(result.suggest_staple)
      }
    } catch { rollback(prev) }
  }

  const handleQtyChange = (item, delta) => {
    const current = item.quantity || 1
    const next = Math.max(1, Math.min(99, current + delta))
    if (next === current) return
    const prev = grocery
    // Optimistic local bump so rapid taps don't all read the stale `current`
    // off the original prop. Server response is discarded — the next /grocery
    // fetch is what ultimately reconciles.
    setGrocery(prev => {
      if (!prev || !prev.items_by_group) return prev
      const newGroups = {}
      for (const [g, gItems] of Object.entries(prev.items_by_group)) {
        newGroups[g] = gItems.map(i => i.id === item.id ? { ...i, quantity: next } : i)
      }
      return { ...prev, items_by_group: newGroups }
    })
    api.updateGroceryQuantity(item.id, next).catch(() => rollback(prev))
  }

  const handleShopCheck = async (item) => {
    await handleItemAction(item, 'bought')
  }

  const handleShopUncheck = async (item) => {
    // The check endpoint is now one-way mark-checked; un-checking goes through
    // /grocery/undo. Optimistically remove from the checked set, then call undo.
    const prev = grocery
    const nl = item.name.toLowerCase()
    const newChecked = (grocery.checked || []).filter(n => n.toLowerCase() !== nl)
    setGrocery({ ...grocery, checked: newChecked })
    try {
      const result = await api.undoGroceryItem(item.id)
      setGrocery(result)
    } catch { rollback(prev) }
  }

  // Shopping mode render
  if (shoppingMode) {
    // The "checked" section in walk-the-aisles is sourced from recently_checked
    // (24-hour undo window items). recently_checked entries carry id + name +
    // type, which is everything the unchecked-row click path needs.
    const allChecked = (recently_checked || [])
      .filter(r => r.type === 'bought' || r.type === 'have_it')
    const handleShopCheckAndScroll = async (item) => {
      await handleShopCheck(item)
      requestAnimationFrame(() => {
        if (shopListRef.current) shopListRef.current.scrollTop = 0
      })
    }

    return (
      <div className={styles.shoppingMode}>
        <div className={styles.shoppingHeader}>
          <div className={styles.shoppingCount}>
            {allChecked.length} of {allChecked.length + totalActive}
          </div>
          <button className={styles.shoppingDone} onClick={exitShoppingMode}>Done</button>
        </div>
        <div className={styles.shoppingList} ref={shopListRef}>
          {sortedGroups.map(group => {
            const items = items_by_group[group]
            // items_by_group is active-only from the backend; the "ordered"
            // filter below excludes items that are sent to Kroger (they show
            // up in the Order page instead, not in walk-the-aisles).
            const active = items.filter(i => !orderedSet.has(i.name.toLowerCase()))
            if (active.length === 0) return null
            return (
              <div key={group} className={styles.shoppingGroup}>
                <div className={styles.shoppingGroupHeader}>{group}</div>
                {active.map(item => (
                  <SwipeableItem
                    key={item.name}
                    className={styles.shoppingItem}
                    onSwipeRight={() => handleShopCheckAndScroll(item)}
                  >
                    <div className={styles.shoppingItemName} onClick={() => handleShopCheckAndScroll(item)}>
                      {item.name}
                      {item.quantity > 1 && <span className={styles.shoppingMulti}>x {item.quantity}</span>}
                      {item.for_meals && item.for_meals.length > 0 && (
                        <span className={styles.shoppingItemMeals}>{item.for_meals.join(', ')}</span>
                      )}
                      {item.notes && (
                        <span className={styles.shoppingItemNote}>{item.notes}</span>
                      )}
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
                  key={item.id}
                  className={`${styles.shoppingItem} ${styles.checked}`}
                  onClick={() => handleShopUncheck(item)}
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


  const handleRecategorize = async (group) => {
    if (!recatItem) return
    try {
      const result = await api.recategorizeItem(recatItem.id, group)
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

  // Collapse every action card. Used when switching between cards so only
  // one expansion is open at a time (the expanded card replaces the entire
  // button row, so two open at once would stack confusingly).
  const collapseAllActions = () => {
    setRegularsExpanded(false)
    setPantryExpanded(false)
    setBundlesExpanded(false)
  }

  // "Every trip" staples — the regulars prompt. Pre-checks staples that
  // aren't already on the list, so the user can one-tap-add what they need.
  const handleRegularsExpand = async () => {
    if (regularsExpanded) {
      setRegularsExpanded(false)
      return
    }
    try {
      const data = await api.getStaples('every_trip')
      const items = data.staples || []
      setRegularsData(items)
      setRegularsChecked(new Set(items.filter(s => !onListSet.has(compareKey(s.name))).map(s => s.name)))
    } catch {
      setRegularsData([])
    }
    collapseAllActions()
    setRegularsExpanded(true)
  }

  const handleRegularsSubmit = async () => {
    await submitPrompt((selected) => api.addStaplesToGrocery(selected, 'every_trip'), [...regularsChecked])
    setRegularsExpanded(false)
  }

  // "Keep on hand" staples — the pantry prompt. Defaults to nothing checked
  // (user opts in to what they actually need this trip).
  const handlePantryExpand = async () => {
    if (pantryExpanded) {
      setPantryExpanded(false)
      return
    }
    try {
      const data = await api.getStaples('keep_on_hand')
      setPantryData(data.staples || [])
      setPantryChecked(new Set())
    } catch {
      setPantryData([])
    }
    collapseAllActions()
    setPantryExpanded(true)
  }

  const handlePantrySubmit = async () => {
    await submitPrompt((selected) => api.addStaplesToGrocery(selected, 'keep_on_hand'), [...pantryChecked])
    setPantryExpanded(false)
  }

  const handleBundlesExpand = async () => {
    if (bundlesExpanded) {
      setBundlesExpanded(false)
      return
    }
    try {
      const data = await api.getBundles()
      setBundlesData(data.bundles || [])
    } catch {
      setBundlesData([])
    }
    collapseAllActions()
    setBundlesExpanded(true)
  }

  const handleBundlePick = async (bundleId) => {
    try {
      const result = await api.addBundleToGrocery(bundleId)
      setGrocery(result)
    } catch {}
    setBundlesExpanded(false)
  }

  const handleUndoRecent = async (id, name) => {
    const prev = grocery
    // Optimistic: remove from all non-active states. Filter recently_checked
    // by id (multiple completed rows can share a name now).
    setGrocery({
      ...grocery,
      checked: (grocery.checked || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      have_it: (grocery.have_it || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      removed: (grocery.removed || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      ordered: (grocery.ordered || []).filter(n => n.toLowerCase() !== name.toLowerCase()),
      recently_checked: (grocery.recently_checked || []).filter(r => r.id !== id),
    })
    try {
      const result = await api.undoGroceryItem(id)
      setGrocery(result)
    } catch { rollback(prev) }
  }

  const renderActionCard = ({ expanded, verb, noun, onExpand, onSubmit, data, checkedSet, setChecked, groupField }) => {
    if (expanded) {
      return (
        <div className={styles.groceryPromptCard}>
          <button
            className={styles.groceryPromptClose}
            onClick={() => { setChecked(new Set()); onExpand() }}
            aria-label="Close"
          >{'×'}</button>
          <div className={styles.groceryPromptBody}>
            <div className={styles.groceryPromptTitle}>{`${verb} ${noun}`}</div>
            <div className={styles.groceryPromptDesc}>
              {groupField ? 'Uncheck anything you don\'t need this time.' : 'Check anything you need to restock.'}
            </div>
            {data && data.length > 0 ? (
              <div className={styles.groceryPromptChecklist}>
                {data.map(item => {
                  const alreadyOnList = onListSet.has(compareKey(item.name))
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
        <span className={styles.groceryActionVerb}>{verb}</span>
        <span className={styles.groceryActionNoun}>{noun}</span>
      </button>
    )
  }

  const renderBundlesCard = () => {
    if (bundlesExpanded) {
      return (
        <div className={styles.groceryPromptCard}>
          <button
            className={styles.groceryPromptClose}
            onClick={handleBundlesExpand}
            aria-label="Close"
          >{'×'}</button>
          <div className={styles.groceryPromptBody}>
            <div className={styles.groceryPromptTitle}>Add a bundle</div>
            <div className={styles.groceryPromptDesc}>
              Bundles are named sets of items you buy together — like ingredients for homemade dog food or a Sunday breakfast spread. Tap one to add its items to your list. You can create or edit bundles in My Kitchen.
            </div>
            {bundlesData && bundlesData.length > 0 ? (
              <div className={styles.groceryPromptChecklist}>
                {bundlesData.map(b => (
                  <div
                    key={b.id}
                    className={styles.groceryPromptCheckItem}
                    onClick={() => handleBundlePick(b.id)}
                  >
                    <span>{b.name}</span>
                    <span className={styles.groceryPromptGroup}>
                      {b.items.length} {b.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.groceryPromptEmpty}>
                No bundles yet. Create one in My Kitchen.
              </div>
            )}
          </div>
        </div>
      )
    }
    return (
      <button className={styles.groceryActionBtn} onClick={handleBundlesExpand}>
        <span className={styles.groceryActionVerb}>Add</span>
        <span className={styles.groceryActionNoun}>bundle</span>
      </button>
    )
  }

  const anyActionExpanded = regularsExpanded || pantryExpanded || bundlesExpanded
  const promptCards = (
    <>
      {!anyActionExpanded && (
        <div className={styles.groceryActions}>
          {renderActionCard({
            expanded: false,
            verb: 'Add', noun: 'every-trip items',
            onExpand: handleRegularsExpand, onSubmit: handleRegularsSubmit,
            data: regularsData, checkedSet: regularsChecked, setChecked: setRegularsChecked, groupField: 'shopping_group',
          })}
          {renderActionCard({
            expanded: false,
            verb: 'Check', noun: 'on-hand items',
            onExpand: handlePantryExpand, onSubmit: handlePantrySubmit,
            data: pantryData, checkedSet: pantryChecked, setChecked: setPantryChecked, groupField: null,
          })}
          <button className={styles.groceryActionBtn} onClick={handleBundlesExpand}>
            <span className={styles.groceryActionVerb}>Add</span>
            <span className={styles.groceryActionNoun}>bundle</span>
          </button>
        </div>
      )}
      {regularsExpanded && renderActionCard({
        expanded: true,
        verb: 'Add', noun: 'every-trip items',
        onExpand: handleRegularsExpand, onSubmit: handleRegularsSubmit,
        data: regularsData, checkedSet: regularsChecked, setChecked: setRegularsChecked, groupField: 'shopping_group',
      })}
      {pantryExpanded && renderActionCard({
        expanded: true,
        verb: 'Check', noun: 'on-hand items',
        onExpand: handlePantryExpand, onSubmit: handlePantrySubmit,
        data: pantryData, checkedSet: pantryChecked, setChecked: setPantryChecked, groupField: null,
      })}
      {bundlesExpanded && renderBundlesCard()}
    </>
  )

  const renderItem = (item) => {
    const nameLower = item.name.toLowerCase()
    // items_by_group from the backend is already active-only (no have-it'd /
    // checked / removed rows). Only need to suppress 'ordered' here, since
    // ordered rows are active but live on the Order page, not the grocery list.
    const isOrdered = orderedSet.has(nameLower)
    const hasMeals = item.for_meals && item.for_meals.length > 0
    const isSelected = selectedItem === item.name

    if (isOrdered) return null

    const handleToggle = (e) => {
      e.stopPropagation()
      setSelectedItem(isSelected ? null : item.name)
      setEditingNote(null)
      setQtyEditing(null)
    }

    const itemContent = (
      <>
        <div className={styles.groceryItemTop}>
          <span className={styles.itemName}>
            {item.name}
            {item.quantity > 1 && <span className={styles.multiBadge}>x {item.quantity}</span>}
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
                    api.updateGroceryNote(item.id, noteText).then(result => setGrocery(result)).catch(() => {})
                  }
                  setEditingNote(null)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
            <div className={styles.groceryActionBar}>
              {qtyEditing === item.id ? (
                <div className={styles.qtyStepper} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleQtyChange(item, -1)} aria-label="Decrease quantity">{'\u2212'}</button>
                  <span>{item.quantity || 1}</span>
                  <button onClick={() => handleQtyChange(item, 1)} aria-label="Increase quantity">+</button>
                  <button className={styles.qtyDone} onClick={() => setQtyEditing(null)} aria-label="Done editing quantity">{'\u2713'}</button>
                </div>
              ) : (
                <button className={styles.qtyPill} onClick={(e) => { e.stopPropagation(); setQtyEditing(item.id) }}>{'\u00D7 '}{item.quantity || 1}</button>
              )}
              <button className={styles.groceryActionBtnItem} onClick={() => handleItemAction(item, 'bought')}>Bought</button>
              <button className={styles.groceryActionBtnItem} onClick={() => handleItemAction(item, 'have_it')}>Have it</button>
              <button className={styles.groceryActionBtnItem} onClick={(e) => { e.stopPropagation(); setRecatItem(item) }}>Aisle</button>
              <button className={styles.groceryActionBtnItem} onClick={(e) => { e.stopPropagation(); setEditingNote(item.name); setNoteText(item.notes || '') }}>Note</button>
              <button className={`${styles.groceryActionBtnItem} ${styles.remove}`} onClick={() => handleItemAction(item, 'remove')}>{'\u00D7'}</button>
            </div>
          </>
        )}
      </>
    )

    return (
      <SwipeableItem
        key={item.name}
        className={`${styles.groceryItemRow}${isSelected ? ` ${styles.selected}` : ''}`}
        onSwipeRight={() => handleItemAction(item, 'bought')}
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
          <p>No items yet. Add items from your meal ingredients or add them manually.</p>
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
              api.addStaple(stapleSuggestion, 'keep_on_hand').catch(() => {})
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
                <div key={r.id} className={styles.recentlyCheckedItem}>
                  <span>{r.name}</span>
                  <span className={styles.recentlyCheckedType}>{r.type === 'bought' ? 'Bought' : r.type === 'removed' ? 'Removed' : r.type === 'ordered' ? 'Ordered' : 'Have it'}</span>
                  <button className={styles.recentlyCheckedUndo} onClick={() => handleUndoRecent(r.id, r.name)}>Undo</button>
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
            setAddDupe(val.trim() && onListSet.has(compareKey(val)))
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
              Walk the Aisles
            </button>
          )}
        </>
      )}

      {recatItem && (
        <Sheet onClose={() => setRecatItem(null)}>
          <div className="sheet-title">Move "{recatItem.name}"</div>
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
