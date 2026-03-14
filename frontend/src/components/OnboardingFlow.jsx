import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import ladleImg from '../assets/ladle.png'

const COMMON_REGULARS = [
  'milk', 'eggs', 'butter', 'bread', 'cheese', 'yogurt',
  'bananas', 'apples', 'orange juice', 'coffee', 'cereal',
  'chicken breast', 'ground beef', 'rice', 'pasta', 'olive oil',
  'onions', 'garlic', 'potatoes', 'tomato sauce', 'sour cream',
]

const COMMON_PANTRY = [
  'salt', 'pepper', 'garlic powder', 'onion powder', 'cumin',
  'chili powder', 'paprika', 'oregano', 'italian seasoning',
  'flour', 'sugar', 'baking powder', 'vanilla extract',
  'soy sauce', 'vinegar', 'cooking spray',
]

export function WelcomeScreen({ onStart }) {
  const [phase, setPhase] = useState(0) // 0=idle, 1=tilt, 2=drip, 3=lift, 4=text, 5=btn
  const ladleRef = useRef(null)
  const logoRef = useRef(null)
  const dripRef = useRef(null)
  const [liftDy, setLiftDy] = useState(0)
  const [splatPos, setSplatPos] = useState({ x: 0, y: 0 })

  const runAnimation = useCallback(() => {
    setPhase(0)
    // Small delay to let layout settle
    const t0 = setTimeout(() => {
      // Compute lift distance and drip impact from current layout
      if (ladleRef.current && logoRef.current) {
        const ladleRect = ladleRef.current.getBoundingClientRect()
        const logoRect = logoRef.current.getBoundingClientRect()
        const dy = (logoRect.top + logoRect.height / 2) - (ladleRect.top + ladleRect.height / 2)
        setLiftDy(dy)
        // Impact point: drip starts near bottom-left of ladle, falls ~160px
        const impactX = ladleRect.left + ladleRect.width * 0.33
        const impactY = ladleRect.top + ladleRect.height * 0.82 + 160
        setSplatPos({ x: impactX, y: impactY })
      }
      setPhase(1) // tilt
    }, 100)
    const t1 = setTimeout(() => setPhase(2), 1100) // drip starts
    const t2 = setTimeout(() => setPhase(3), 1490) // splatter on impact
    const t3 = setTimeout(() => setPhase(4), 1960) // lift + text
    const t4 = setTimeout(() => setPhase(5), 2260) // button
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [])

  useEffect(() => {
    let cleanup
    const start = () => { cleanup = runAnimation() }
    if (document.fonts) {
      document.fonts.ready.then(start)
    } else {
      start()
    }
    return () => { if (cleanup) cleanup() }
  }, [runAnimation])

  const ladleClass = phase >= 4 ? 'welcome-ladle upright' : phase >= 1 ? 'welcome-ladle tilt' : 'welcome-ladle'
  const moverClass = phase >= 4 ? 'welcome-ladle-mover lift' : 'welcome-ladle-mover'
  const moverStyle = phase >= 4 ? { '--lift-dy': `${liftDy}px` } : {}

  return (
    <div className="welcome">
      {/* Splatter dots — appear on impact */}
      {phase >= 3 && (
        <>
          <div className="welcome-splat main" style={{ left: splatPos.x - 9, top: splatPos.y - 4 }} />
          <div className="welcome-splat a" style={{ left: splatPos.x - 18, top: splatPos.y - 3 }} />
          <div className="welcome-splat b" style={{ left: splatPos.x - 30, top: splatPos.y + 2 }} />
          <div className="welcome-splat c" style={{ left: splatPos.x - 14, top: splatPos.y + 6 }} />
        </>
      )}
      <div className="welcome-content">
        <div className="welcome-logo-slot" ref={logoRef} />
        <div className={`welcome-wordmark ${phase >= 4 ? 'reveal' : ''}`}>sous<em>chef</em></div>
        <div className="welcome-tagline-slot">
          <div className={`welcome-tagline ${phase >= 4 ? 'reveal' : ''}`}>
            because someone has to plan dinner<br />and get groceries
          </div>
          <div className={moverClass} ref={ladleRef} style={moverStyle}>
            <img className={ladleClass} src={ladleImg} alt="" />
            {phase >= 2 && phase < 4 && <div className="welcome-drip" ref={dripRef} />}
          </div>
        </div>
        <button className={`welcome-btn ${phase >= 5 ? 'reveal' : ''}`} onClick={onStart}>
          Get started
        </button>
        <div className={`welcome-footer ${phase >= 5 ? 'show' : ''}`}>
          an <a href="https://aletheia.fyi">aletheia</a> project
        </div>
      </div>
    </div>
  )
}

export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(0)
  // Step 0: recipe library picker
  const [library, setLibrary] = useState(null)
  const [selectedMealIds, setSelectedMealIds] = useState(new Set())
  const [selectedSideIds, setSelectedSideIds] = useState(new Set())
  const [customMealInput, setCustomMealInput] = useState('')
  const [customMeals, setCustomMeals] = useState([])
  const [customSideInput, setCustomSideInput] = useState('')
  const [customSides, setCustomSides] = useState([])
  // Step 1: regulars
  const [selectedRegulars, setSelectedRegulars] = useState(new Set())
  const [regularInput, setRegularInput] = useState('')
  // Step 2: pantry
  const [selectedPantry, setSelectedPantry] = useState(new Set())
  const [pantryInput, setPantryInput] = useState('')

  useEffect(() => {
    api.getOnboardingLibrary().then(setLibrary)
  }, [])

  const toggleMealId = (id) => {
    setSelectedMealIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSideId = (id) => {
    setSelectedSideIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddCustomMeal = (e) => {
    e.preventDefault()
    const name = customMealInput.trim()
    if (!name || customMeals.includes(name)) return
    setCustomMeals(prev => [...prev, name])
    setCustomMealInput('')
  }

  const handleAddCustomSide = (e) => {
    e.preventDefault()
    const name = customSideInput.trim()
    if (!name || customSides.includes(name)) return
    setCustomSides(prev => [...prev, name])
    setCustomSideInput('')
  }

  const toggleRegular = (name) => {
    setSelectedRegulars(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAddCustomRegular = (e) => {
    e.preventDefault()
    if (!regularInput.trim()) return
    setSelectedRegulars(prev => new Set(prev).add(regularInput.trim().toLowerCase()))
    setRegularInput('')
  }

  const togglePantry = (name) => {
    setSelectedPantry(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAddCustomPantry = (e) => {
    e.preventDefault()
    if (!pantryInput.trim()) return
    setSelectedPantry(prev => new Set(prev).add(pantryInput.trim().toLowerCase()))
    setPantryInput('')
  }

  const handleNext = async () => {
    if (step === 0) {
      // Save selected recipes
      await api.selectOnboardingRecipes(
        [...selectedMealIds],
        [...selectedSideIds],
        customMeals,
        customSides,
      )
    }
    if (step === 1) {
      for (const name of selectedRegulars) {
        try { await api.addRegular(name) } catch (e) { /* ignore duplicates */ }
      }
    }
    if (step === 2) {
      for (const name of selectedPantry) {
        try { await api.addPantryItem(name) } catch (e) { /* ignore */ }
      }
      await api.completeOnboarding()
      localStorage.setItem('souschef_onboarded', 'true')
      onComplete()
      return
    }
    setStep(step + 1)
  }

  const steps = [
    { title: 'What does your family eat?', desc: 'What your family eats. We\'ll use these to build your grocery list.' },
    { title: 'Weekly regulars', desc: 'Things you buy almost every trip. These go on your list automatically.' },
    { title: 'Pantry staples', desc: 'Things you always have at home. We\'ll leave these off your list.' },
  ]

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-logo">sous<em>chef</em></div>
        <div className="onboarding-subtitle">Tell us how your household eats and we'll handle the rest.</div>

        <div className="onboarding-dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
            />
          ))}
        </div>

        <div className="onboarding-step-title">{steps[step].title}</div>
        <div className="onboarding-step-desc">{steps[step].desc}</div>

        {/* Step 0: Recipe library picker */}
        {step === 0 && (
          <>
            {!library ? (
              <div className="loading">Loading recipes...</div>
            ) : (
              <div className="onboarding-recipe-columns">
                <div className="onboarding-recipe-section">
                  <div className="onboarding-section-label">Meals</div>
                  <div className="onboarding-grid">
                    {library.meals.map(r => (
                      <button
                        key={r.id}
                        className={`onboarding-grid-item ${selectedMealIds.has(r.id) ? 'selected' : ''}`}
                        onClick={() => toggleMealId(r.id)}
                      >
                        {r.name}
                      </button>
                    ))}
                    {customMeals.map(name => (
                      <button
                        key={`custom-${name}`}
                        className="onboarding-grid-item selected custom"
                        onClick={() => setCustomMeals(prev => prev.filter(n => n !== name))}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={handleAddCustomMeal} className="onboarding-input-row">
                    <input
                      className="onboarding-input"
                      type="text"
                      placeholder="Add your own..."
                      value={customMealInput}
                      onChange={(e) => setCustomMealInput(e.target.value)}
                    />
                    <button className="btn primary" type="submit">+</button>
                  </form>
                </div>

                <div className="onboarding-recipe-section">
                  <div className="onboarding-section-label">Sides</div>
                  <div className="onboarding-grid">
                    {library.sides.map(r => (
                      <button
                        key={r.id}
                        className={`onboarding-grid-item ${selectedSideIds.has(r.id) ? 'selected' : ''}`}
                        onClick={() => toggleSideId(r.id)}
                      >
                        {r.name}
                      </button>
                    ))}
                    {customSides.map(name => (
                      <button
                        key={`custom-${name}`}
                        className="onboarding-grid-item selected custom"
                        onClick={() => setCustomSides(prev => prev.filter(n => n !== name))}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={handleAddCustomSide} className="onboarding-input-row">
                    <input
                      className="onboarding-input"
                      type="text"
                      placeholder="Add your own..."
                      value={customSideInput}
                      onChange={(e) => setCustomSideInput(e.target.value)}
                    />
                    <button className="btn primary" type="submit">+</button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}

        {/* Step 1: Regulars */}
        {step === 1 && (
          <>
            <div className="onboarding-checklist">
              {COMMON_REGULARS.map(name => (
                <div
                  key={name}
                  className="onboarding-check-item"
                  onClick={() => toggleRegular(name)}
                >
                  <div className={`regular-check ${selectedRegulars.has(name) ? 'active' : ''}`}>
                    {selectedRegulars.has(name) && '\u2713'}
                  </div>
                  <span>{name}</span>
                </div>
              ))}
              {[...selectedRegulars].filter(n => !COMMON_REGULARS.includes(n)).map(name => (
                <div
                  key={name}
                  className="onboarding-check-item"
                  onClick={() => toggleRegular(name)}
                >
                  <div className="regular-check active">{'\u2713'}</div>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddCustomRegular} className="onboarding-input-row">
              <input
                className="onboarding-input"
                type="text"
                placeholder="Add something else..."
                value={regularInput}
                onChange={(e) => setRegularInput(e.target.value)}
              />
              <button className="btn primary" type="submit">+</button>
            </form>
          </>
        )}

        {/* Step 2: Pantry */}
        {step === 2 && (
          <>
            <div className="onboarding-checklist">
              {COMMON_PANTRY.map(name => (
                <div
                  key={name}
                  className="onboarding-check-item"
                  onClick={() => togglePantry(name)}
                >
                  <div className={`regular-check ${selectedPantry.has(name) ? 'active' : ''}`}>
                    {selectedPantry.has(name) && '\u2713'}
                  </div>
                  <span>{name}</span>
                </div>
              ))}
              {[...selectedPantry].filter(n => !COMMON_PANTRY.includes(n)).map(name => (
                <div
                  key={name}
                  className="onboarding-check-item"
                  onClick={() => togglePantry(name)}
                >
                  <div className="regular-check active">{'\u2713'}</div>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddCustomPantry} className="onboarding-input-row">
              <input
                className="onboarding-input"
                type="text"
                placeholder="Add something else..."
                value={pantryInput}
                onChange={(e) => setPantryInput(e.target.value)}
              />
              <button className="btn primary" type="submit">+</button>
            </form>
          </>
        )}

        <div className="onboarding-btn-row">
          {step > 0 && (
            <button className="onboarding-btn secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button
            className="onboarding-btn primary"
            onClick={handleNext}
          >
            {step === 2 ? 'Get cooking' : 'Skip / Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
