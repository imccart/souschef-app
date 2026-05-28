import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import MealPickerSheet from './MealPickerSheet'
import SidePickerSheet from './SidePickerSheet'
import MealIngredientsSheet from './MealIngredientsSheet'
import FeedbackFab from './FeedbackFab'
import styles from './PlanPage.module.css'

function formatDateRange(start, end) {
  if (!start || !end) return ''
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' })
  if (sMonth === eMonth) {
    return { text: `${sMonth} ${s.getDate()}`, endText: `${e.getDate()}` }
  }
  return { text: `${sMonth} ${s.getDate()}`, endText: `${eMonth} ${e.getDate()}` }
}

function isToday(dateStr) {
  return dateStr === new Date().toISOString().split('T')[0]
}

export default function PlanPage({ showHeader = true, onLoad, onNavigate }) {
  const [data, setData] = useState(null)
  const [actionDate, setActionDate] = useState(null) // date for action bottom sheet
  const [pickerDate, setPickerDate] = useState(null) // date for meal picker
  const [pickerMode, setPickerMode] = useState(null) // 'add' or 'replace'
  const [loading, setLoading] = useState(true)
  const [pastDays, setPastDays] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const [sidePickerDate, setSidePickerDate] = useState(null)
  const [ingredientsMeal, setIngredientsMeal] = useState(null)
  const [erasing, setErasing] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [cookingNotes, setCookingNotes] = useState('')
  const [showCookingNotes, setShowCookingNotes] = useState(false)
  // Action sheet view state: 'main' (top-level), 'change' (submenu), 'move' (day picker)
  const [actionView, setActionView] = useState('main')

  const [loadError, setLoadError] = useState(false)

  const load = async () => {
    try {
      const result = await api.getMeals()
      setData(result)
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (data && onLoad) onLoad(data)
  }, [data, onLoad])

  if (loading) return <><div className="loading">Setting the table...</div><FeedbackFab page="plan" /></>
  if (loadError) return <><div className="loading">Something went wrong loading meals. Try refreshing.</div><FeedbackFab page="plan" /></>
  if (!data) return null

  const { days, start_date, end_date } = data
  const dateRange = formatDateRange(start_date, end_date)
  const hasMeals = days.some(d => d.meal)

  // ── Tap handlers ──

  const handleMealTap = (date) => {
    if (actionDate === date) {
      setActionDate(null)
    } else {
      setActionDate(date)
      setActionView('main')
      const day = data?.days?.find(d => d.date === date)
      setNoteText(day?.meal?.notes || '')
      setShowCookingNotes(false)
      setCookingNotes('')
      if (day?.meal?.recipe_id) {
        api.getRecipeIngredients(day.meal.recipe_id)
          .then(r => setCookingNotes(r.cooking_notes || ''))
          .catch(() => {})
      }
    }
  }

  const handleEmptyTap = (date) => {
    setPickerDate(date)
    setPickerMode('add')
  }

  const handleReplace = (date) => {
    setActionDate(null)
    setPickerDate(date)
    setPickerMode('replace')
  }

  const handleSetMeal = async (date, recipeId, sides) => {
    try {
      const hasNewSides = sides?.some(s => !s.side_recipe_id)
      const result = await api.setMeal(date, recipeId, sides)
      setData(result)
      setPickerDate(null)
      setPickerMode(null)
      // Auto-open ingredients if new sides were created
      if (hasNewSides) {
        const day = result.days.find(d => d.date === date)
        if (day?.meal) setIngredientsMeal(day.meal)
      }
    } catch { await load() }
  }

  const handleFreeform = async (date, name) => {
    try {
      const result = await api.setFreeform(date, name)
      setData(result)
      setPickerDate(null)
      setPickerMode(null)
      setActionDate(null)
    } catch { await load() }
  }

  const handleClearDay = async (date) => {
    try {
      await api.removeMeal(date)
      setActionDate(null)
      await load()
    } catch { await load() }
  }

  const handleMoveTo = async (targetDate) => {
    if (!actionDate || targetDate === actionDate) return
    try {
      const result = await api.swapDays(actionDate, targetDate)
      setData(result)
    } catch { await load() }
    setActionDate(null)
  }

  const handleCreateNew = async (date, name) => {
    try {
      const recipe = await api.addRecipe(name)
      if (!recipe.id) return
      const result = await api.setMeal(date, recipe.id, [])
      setData(result)
      setPickerDate(null)
      setPickerMode(null)
      // Open ingredients sheet for the new meal
      const newDay = result.days.find(d => d.date === date)
      if (newDay?.meal) {
        setIngredientsMeal(newDay.meal)
      }
    } catch { await load() }
  }

  const handleOpenSidePicker = (date) => {
    setActionDate(null)
    setSidePickerDate(date)
  }

  const handleSetSide = async (date, sides) => {
    try {
      const result = await api.setSide(date, sides)
      setData(result)
      setSidePickerDate(null)
    } catch { await load() }
  }

  // Inline side-chip actions on the plan row. Remove sends the
  // remaining list to set-side; that's the same backend contract
  // the side picker uses, just with one fewer side.
  const handleRemoveSide = async (date, sideId) => {
    const day = data?.days?.find(d => d.date === date)
    if (!day?.meal?.sides) return
    const remaining = day.meal.sides
      .filter(s => s.id !== sideId)
      .map(s => ({ side_recipe_id: s.id, side_name: s.name }))
    try {
      const result = await api.setSide(date, remaining)
      setData(result)
    } catch { await load() }
  }


  const handleStartNewPlan = async () => {
    if (!window.confirm('This clears all your meals and your grocery list. Are you sure?')) return
    setErasing(true)
    setTimeout(async () => {
      try {
        const result = await api.freshStart()
        setData(result)
      } catch { await load() }
      setErasing(false)
    }, 700)
  }

  const handleViewPast = async () => {
    if (showPast) {
      setShowPast(false)
      return
    }
    try {
      const result = await api.getPastMeals()
      setPastDays(result.days)
      setShowPast(true)
    } catch { /* silent — toggle stays off */ }
  }

  const actionDay = actionDate ? days.find(d => d.date === actionDate) : null
  const actionMeal = actionDay?.meal
  const actionIsFreeform = actionMeal && !actionMeal.recipe_id
  const actionHasSide = actionMeal && actionMeal.sides?.length > 0 && !actionIsFreeform
  const actionDayName = actionDate
    ? new Date(actionDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    : ''

  // Get day name for picker
  const pickerDay = pickerDate ? days.find(d => d.date === pickerDate) : null
  const pickerDayName = pickerDay
    ? new Date(pickerDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    : ''

  // Only show "Tap to add a meal" on the first empty day
  let firstEmptyShown = false

  return (
    <>
      {showHeader && (
        <>
          <div className="page-header">
            <div className={styles.dateRangeBig}>
              {dateRange.text} <em>&ndash;</em> {dateRange.endText}
            </div>
            <div className={styles.dateSubtitle}>Your next 10 days</div>
          </div>
        </>
      )}

      {/* Past meals (read-only) */}
      <div className="past-toggle" onClick={handleViewPast}>
        {showPast ? 'Hide past meals' : 'View past meals'}
      </div>
      {showPast && pastDays && (
        <div className={`${styles.mealRows} ${styles.pastMeals}`}>
          {pastDays.map(({ date, day_short, meal }) => (
            <div key={date} className={`${styles.mealRow} ${styles.past}`}>
              <div className={styles.mealDay}>{day_short}</div>
              <div className={styles.mealInfo}>
                {meal ? (
                  <>
                    <div className={styles.mealName}>{meal.recipe_name}</div>
                    {meal.sides?.length > 0 && <div className={styles.mealSideText}>{meal.sides.map(s => s.name).join(', ')}</div>}
                  </>
                ) : (
                  <div className={`${styles.mealName} ${styles.freeform}`}>No meal</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`${styles.mealRows}${erasing ? ` ${styles.erasing}` : ''}`}>
        {days.map(({ date, day_short, meal }, idx) => {
          const today = isToday(date)
          const hasMeal = !!meal
          const isFreeform = hasMeal && !meal.recipe_id
          const onList = hasMeal && meal.on_grocery && !isFreeform

          if (!hasMeal) {
            const showHint = !firstEmptyShown
            firstEmptyShown = true
            return (
              <div
                key={date}
                data-role="add-meal-row"
                data-date={date}
                className={`${styles.addMealRow} ${today ? styles.today : ''}`}
                style={{ '--row-index': idx }}
                onClick={() => handleEmptyTap(date)}
              >
                <div className={styles.mealDay}>{day_short}</div>
                <div className={styles.addLabel}>
                  {showHint ? 'Tap to add a meal' : '+'}
                </div>
              </div>
            )
          }

          const sides = meal.sides || []
          const hasSides = sides.length > 0
          const canHaveSides = !isFreeform
          return (
            <div
              key={date}
              data-role="meal-row"
              data-date={date}
              style={{ '--row-index': idx }}
              className={`${styles.mealRow} ${today ? styles.today : ''} ${onList ? styles.onList : ''}`}
              onClick={() => handleMealTap(date)}
            >
              <div className={styles.mealDay}>{day_short}</div>
              <div className={styles.mealInfo}>
                <div className={`${styles.mealName} ${isFreeform ? styles.freeform : ''}`}>{meal.recipe_name}</div>
                {canHaveSides && hasSides && (
                  <div className={styles.sideStrip}>
                    {sides.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className={styles.sideChip}
                        onClick={(e) => { e.stopPropagation(); handleOpenSidePicker(date) }}
                        title={`Swap "${s.name}"`}
                      >
                        {s.name}
                        <span
                          role="button"
                          aria-label={`Remove ${s.name}`}
                          className={styles.sideChipX}
                          onClick={(e) => { e.stopPropagation(); handleRemoveSide(date, s.id) }}
                        >×</span>
                      </button>
                    ))}
                    {sides.length < 3 && (
                      <button
                        type="button"
                        className={styles.addSideIcon}
                        aria-label="Add a side"
                        title="Add a side"
                        onClick={(e) => { e.stopPropagation(); handleOpenSidePicker(date) }}
                      >+</button>
                    )}
                  </div>
                )}
                {canHaveSides && !hasSides && (
                  <div className={styles.sideStrip}>
                    <button
                      type="button"
                      className={styles.addSideEmpty}
                      onClick={(e) => { e.stopPropagation(); handleOpenSidePicker(date) }}
                    >+ sides</button>
                  </div>
                )}
                {meal.notes && <div className={styles.mealNote}>{meal.notes}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action bottom sheet for tapped meal */}
      {actionDate && actionMeal && (
        <Sheet onClose={() => setActionDate(null)}>
            {actionView === 'main' && (
              <>
                <div className="sheet-title">{actionDayName}</div>
                <div className="sheet-sub">{actionMeal.recipe_name}{actionMeal.sides?.length > 0 ? ` + ${actionMeal.sides.map(s => s.name).join(', ')}` : ''}</div>
                <div className="sheet-options">
                  <button className="sheet-option" onClick={() => setActionView('change')}>
                    <div className="sheet-opt-icon">{'\u{1F504}'}</div>
                    <div>
                      <div className="sheet-opt-title">Change meal</div>
                      <div className="sheet-opt-desc">Replace, move to a different day, or clear</div>
                    </div>
                  </button>
                  {!actionIsFreeform && (
                    <button className="sheet-option" onClick={() => { setIngredientsMeal(actionMeal); setActionDate(null) }}>
                      <div className="sheet-opt-icon">{'\u{1F4CB}'}</div>
                      <div>
                        <div className="sheet-opt-title">Ingredients</div>
                        <div className="sheet-opt-desc">View or edit what goes into this meal</div>
                      </div>
                    </button>
                  )}
                  {!actionIsFreeform && (
                    <button className="sheet-option" onClick={() => setShowCookingNotes(!showCookingNotes)}>
                      <div className="sheet-opt-icon">{'\u{1F4DD}'}</div>
                      <div>
                        <div className="sheet-opt-title">Cooking notes</div>
                        <div className="sheet-opt-desc">{cookingNotes ? 'View or edit cooking tips' : 'Add tips for how to cook this'}</div>
                      </div>
                    </button>
                  )}
                  {showCookingNotes && (
                    <div className="sheet-note">
                      <textarea
                        className="note-input"
                        placeholder="e.g., Cook sausage first, then add beans and broth..."
                        value={cookingNotes}
                        rows={3}
                        onChange={(e) => setCookingNotes(e.target.value)}
                        onBlur={() => {
                          if (actionMeal.recipe_id) {
                            api.updateRecipeNotes(actionMeal.recipe_id, cookingNotes).catch(() => {})
                          }
                        }}
                        style={{ resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                  )}
                </div>
                <div className="sheet-note">
                  <input
                    type="text"
                    className="note-input"
                    placeholder="Add a note..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onBlur={() => {
                      if (noteText !== (actionMeal.notes || '')) {
                        api.updateMealNote(actionDate, noteText).then(result => setData(result)).catch(() => {})
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.target.blur()
                      }
                    }}
                  />
                </div>
              </>
            )}

            {actionView === 'change' && (
              <>
                <button className="sheet-back" onClick={() => setActionView('main')}>{'‹'} Back</button>
                <div className="sheet-title">Change {actionDayName}</div>
                <div className="sheet-sub">{actionMeal.recipe_name}</div>
                <div className="sheet-options">
                  <button className="sheet-option" onClick={() => handleReplace(actionDate)}>
                    <div className="sheet-opt-icon">{'\u{1F37D}'}</div>
                    <div>
                      <div className="sheet-opt-title">Different meal</div>
                      <div className="sheet-opt-desc">Pick something else for this day</div>
                    </div>
                  </button>
                  {/* Side editing now lives on the meal row (chips + "+ sides" button). */}
                  <button className="sheet-option" onClick={() => setActionView('move')}>
                    <div className="sheet-opt-icon">{'\u{1F4C5}'}</div>
                    <div>
                      <div className="sheet-opt-title">Move to a different day</div>
                      <div className="sheet-opt-desc">Swap with another day on the plan</div>
                    </div>
                  </button>
                  <div className="sheet-divider" />
                  <button className={styles.chefsNightOption} onClick={() => handleFreeform(actionDate, "Chef's Night Off")}>
                    Chef's night off {'→'}
                  </button>
                  <button className="sheet-option sheet-option-destructive" onClick={() => handleClearDay(actionDate)}>
                    <div className="sheet-opt-icon">{'\u{1F5D1}'}</div>
                    <div>
                      <div className="sheet-opt-title">Clear this day</div>
                      <div className="sheet-opt-desc">Empty the slot — meal goes away</div>
                    </div>
                  </button>
                </div>
              </>
            )}

            {actionView === 'move' && (
              <>
                <button className="sheet-back" onClick={() => setActionView('change')}>{'‹'} Back</button>
                <div className="sheet-title">Move {actionMeal.recipe_name}</div>
                <div className="sheet-sub">From {actionDayName} to...</div>
                <div className="sheet-options">
                  {days.filter(d => d.date !== actionDate).map(d => {
                    const targetDayName = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })
                    const targetMealLabel = d.meal
                      ? d.meal.recipe_name + (d.meal.sides?.length ? ` + ${d.meal.sides.map(s => s.name).join(', ')}` : '')
                      : 'Empty'
                    return (
                      <button key={d.date} className="sheet-option" onClick={() => handleMoveTo(d.date)}>
                        <div className="sheet-opt-icon">{d.day_short}</div>
                        <div>
                          <div className="sheet-opt-title">{targetDayName}</div>
                          <div className="sheet-opt-desc">{targetMealLabel}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
        </Sheet>
      )}



      {/* Plan footer */}
      <div className={styles.planFooter}>
        <button className={styles.freshStartBtn} onClick={handleStartNewPlan}>
          {'\u{1F9F9}'} Fresh Start
        </button>
      </div>

      <FeedbackFab page="plan" />

      {/* Meal picker sheet */}
      {pickerDate && (
        <MealPickerSheet
          date={pickerDate}
          dayName={pickerDayName}
          onSelect={(recipeId, sides) => handleSetMeal(pickerDate, recipeId, sides)}
          onFreeform={(name) => handleFreeform(pickerDate, name)}
          onCreateNew={(name) => handleCreateNew(pickerDate, name)}
          onClose={() => { setPickerDate(null); setPickerMode(null) }}
        />
      )}


      {/* Side picker sheet */}
      {sidePickerDate && (
        <SidePickerSheet
          date={sidePickerDate}
          mealName={days.find(d => d.date === sidePickerDate)?.meal?.recipe_name || ''}
          onSelect={(sides) => handleSetSide(sidePickerDate, sides)}
          onClose={() => setSidePickerDate(null)}
        />
      )}

      {/* Meal ingredients sheet */}
      {ingredientsMeal && (
        <MealIngredientsSheet
          meal={ingredientsMeal}
          onClose={() => setIngredientsMeal(null)}
        />
      )}
    </>
  )
}