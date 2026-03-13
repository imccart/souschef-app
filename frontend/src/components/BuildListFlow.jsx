import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'

export default function BuildListFlow({ onComplete, onClose }) {
  const [step, setStep] = useState('loading')
  const [carryoverItems, setCarryoverItems] = useState([])
  const [carryoverSelected, setCarryoverSelected] = useState(new Set())
  const [regulars, setRegulars] = useState([])
  const [regularsChecked, setRegularsChecked] = useState(new Set())
  const [learningSuggestions, setLearningSuggestions] = useState([])
  const [learningAccepted, setLearningAccepted] = useState(new Set())
  const [pantry, setPantry] = useState([])
  const [pantryChecked, setPantryChecked] = useState(new Set())

  useEffect(() => { init() }, [])

  const init = async () => {
    try {
      const carryover = await api.getCarryover()
      if (carryover.has_carryover && carryover.items.length > 0) {
        setCarryoverItems(carryover.items)
        setCarryoverSelected(new Set(carryover.items.map(i => i.name)))
        setStep('carryover')
        return
      }
      await goToRegulars()
    } catch {
      await goToRegulars()
    }
  }

  const goToRegulars = async () => {
    const [regData, learningData] = await Promise.all([
      api.getRegulars(),
      api.getLearningSuggestions().catch(() => ({ add: [], remove: [] })),
    ])
    const active = regData.regulars.filter(r => r.active)
    setRegulars(active)
    setRegularsChecked(new Set(active.map(r => r.name)))
    // Learning: items bought frequently that aren't regulars yet
    if (learningData.add && learningData.add.length > 0) {
      setLearningSuggestions(learningData.add)
    }
    setStep('regulars')
  }

  const goToPantry = async () => {
    try {
      const data = await api.getPantry()
      setPantry(data.items)
    } catch {
      setPantry([])
    }
    setPantryChecked(new Set())
    setStep('pantry')
  }

  const buildAndFinish = async () => {
    try {
      await api.buildMyList(
        [...carryoverSelected],
        [...regularsChecked],
        [...pantryChecked],
      )
      onComplete()
    } catch {
      onClose()
    }
  }

  // Carryover: keep items or fresh start
  const handleKeepCarryover = () => goToRegulars()
  const handleFreshStart = () => {
    setCarryoverSelected(new Set())
    goToRegulars()
  }

  // Regulars
  const handleRegularsNext = async () => {
    // Add any accepted learning suggestions to regulars
    for (const name of learningAccepted) {
      await api.addRegular(name)
    }
    goToPantry()
  }
  const handleRegularsSkip = () => {
    setRegularsChecked(new Set())
    goToPantry()
  }

  // Pantry
  const handlePantryNext = () => buildAndFinish()
  const handlePantrySkip = () => {
    setPantryChecked(new Set())
    buildAndFinish()
  }

  const toggleCarryover = (name) => {
    setCarryoverSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleRegular = (name) => {
    setRegularsChecked(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleLearning = (name) => {
    setLearningAccepted(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
        // Also remove from regulars checked
        setRegularsChecked(rc => { const n = new Set(rc); n.delete(name); return n })
      } else {
        next.add(name)
        // Also add to regulars checked for this trip
        setRegularsChecked(rc => new Set([...rc, name]))
      }
      return next
    })
  }

  const togglePantry = (name) => {
    setPantryChecked(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  if (step === 'loading') {
    return (
      <Sheet onClose={onClose}>
        <div className="loading">Preparing your list...</div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} className="build-flow-sheet">
      {/* Carryover / Fresh Start */}
      {step === 'carryover' && (
        <>
          <div className="build-flow-step-title">Items from last trip</div>
          <div className="build-flow-step-desc">
            {carryoverItems.length} item{carryoverItems.length !== 1 ? 's' : ''} left unchecked. Keep them on the new list?
          </div>
          <div className="build-flow-checklist">
            {carryoverItems.map(item => (
              <div
                key={item.name}
                className="build-flow-check-item"
                onClick={() => toggleCarryover(item.name)}
              >
                <div className={`build-flow-check ${carryoverSelected.has(item.name) ? 'active' : ''}`}>
                  {carryoverSelected.has(item.name) && '\u2713'}
                </div>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
          <div className="sheet-btn-row">
            <button className="sheet-btn-secondary" onClick={handleFreshStart}>
              Fresh start
            </button>
            <button className="sheet-btn-primary" onClick={handleKeepCarryover}>
              Keep ({carryoverSelected.size})
            </button>
          </div>
        </>
      )}

      {/* Regulars */}
      {step === 'regulars' && (
        <>
          <div className="build-flow-step-title">Regulars</div>
          <div className="build-flow-step-desc">
            Uncheck anything you don't need this trip.
          </div>
          <div className="build-flow-checklist">
            {regulars.map(r => (
              <div
                key={r.id}
                className="build-flow-check-item"
                onClick={() => toggleRegular(r.name)}
              >
                <div className={`build-flow-check ${regularsChecked.has(r.name) ? 'active' : ''}`}>
                  {regularsChecked.has(r.name) && '\u2713'}
                </div>
                <span>{r.name}</span>
                {r.shopping_group && (
                  <span className="build-flow-group-label">{r.shopping_group}</span>
                )}
              </div>
            ))}

            {/* Learning suggestions */}
            {learningSuggestions.length > 0 && (
              <>
                <div className="build-flow-suggestion-divider">Add to regulars?</div>
                {learningSuggestions.map(s => (
                  <div
                    key={s.name}
                    className="build-flow-check-item build-flow-suggestion"
                    onClick={() => toggleLearning(s.name)}
                  >
                    <div className={`build-flow-check ${learningAccepted.has(s.name) ? 'active' : ''}`}>
                      {learningAccepted.has(s.name) && '\u2713'}
                    </div>
                    <span>{s.name}</span>
                    <span className="build-flow-suggestion-context">
                      on {s.trip_count} of last {s.total_trips} trips
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="sheet-btn-row">
            <button className="sheet-btn-secondary" onClick={handleRegularsSkip}>
              Skip
            </button>
            <button className="sheet-btn-primary" onClick={handleRegularsNext}>
              Next ({regularsChecked.size})
            </button>
          </div>
        </>
      )}

      {/* Pantry */}
      {step === 'pantry' && (
        <>
          <div className="build-flow-step-title">Running low?</div>
          <div className="build-flow-step-desc">
            Check any pantry staples you need to restock.
          </div>
          {pantry.length > 0 ? (
            <div className="build-flow-checklist">
              {pantry.map(p => (
                <div
                  key={p.id}
                  className="build-flow-check-item"
                  onClick={() => togglePantry(p.name)}
                >
                  <div className={`build-flow-check ${pantryChecked.has(p.name) ? 'active' : ''}`}>
                    {pantryChecked.has(p.name) && '\u2713'}
                  </div>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="build-flow-empty">
              No pantry items yet. You can add them in Preferences.
            </div>
          )}
          <div className="sheet-btn-row">
            <button className="sheet-btn-secondary" onClick={handlePantrySkip}>
              Skip
            </button>
            <button className="sheet-btn-primary" onClick={handlePantryNext}>
              Build list {pantryChecked.size > 0 ? `(+${pantryChecked.size})` : ''}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
