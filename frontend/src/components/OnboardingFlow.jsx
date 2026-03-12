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
  const [storeName, setStoreName] = useState('')
  const [storeMode, setStoreMode] = useState('in-person')
  const [addedStores, setAddedStores] = useState([])
  const [mealInput, setMealInput] = useState('')
  const [addedMeals, setAddedMeals] = useState([])
  const [selectedRegulars, setSelectedRegulars] = useState(new Set())
  const [regularInput, setRegularInput] = useState('')
  const [selectedPantry, setSelectedPantry] = useState(new Set())
  const [pantryInput, setPantryInput] = useState('')

  const handleAddStore = async (e) => {
    e.preventDefault()
    if (!storeName.trim()) return
    const key = storeName.trim()[0].toLowerCase()
    const result = await api.addStore(storeName.trim(), key, storeMode)
    if (result.ok) {
      setAddedStores(prev => [...prev, result.store])
      setStoreName('')
    }
  }

  const handleAddMeal = async (e) => {
    e.preventDefault()
    if (!mealInput.trim()) return
    const result = await api.addToPool(mealInput.trim())
    if (result.ok) {
      setAddedMeals(prev => [...prev, result.name])
      setMealInput('')
    }
  }

  const handleRemoveMeal = (index) => {
    setAddedMeals(prev => prev.filter((_, i) => i !== index))
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
    if (step === 2) {
      // Save selected regulars
      for (const name of selectedRegulars) {
        try { await api.addRegular(name) } catch (e) { /* ignore duplicates */ }
      }
    }
    if (step === 3) {
      // Save selected pantry items
      for (const name of selectedPantry) {
        try { await api.addPantryItem(name) } catch (e) { /* ignore */ }
      }
      // Mark onboarding complete — DB + localStorage
      await api.completeOnboarding()
      localStorage.setItem('souschef_onboarded', 'true')
      onComplete()
      return
    }
    setStep(step + 1)
  }

  const canProceed = step === 0 ? addedStores.length > 0 : true

  const steps = [
    { title: 'Where do you shop?', desc: 'Add at least one store to get started.' },
    { title: 'What does your family eat?', desc: 'Type meals you make regularly. You can always add more later.' },
    { title: 'Weekly regulars', desc: 'Items you buy almost every trip. Check the ones that apply.' },
    { title: 'Pantry staples', desc: 'Things you always have on hand, so they stay off the grocery list.' },
  ]

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-logo">sous<em>chef</em></div>
        <div className="onboarding-subtitle">Your kitchen assistant</div>

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

        {/* Step 0: Store */}
        {step === 0 && (
          <>
            {addedStores.length > 0 && (
              <div className="onboarding-pills">
                {addedStores.map((s, i) => (
                  <div key={i} className="onboarding-pill active">
                    {s.name} ({s.mode})
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddStore} className="onboarding-input-row">
              <input
                className="onboarding-input"
                type="text"
                placeholder="Store name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                autoFocus
              />
              <button className="btn primary" type="submit">Add</button>
            </form>
            <div className="onboarding-mode-pills">
              {['in-person', 'pickup', 'delivery'].map(mode => (
                <button
                  key={mode}
                  className={`onboarding-mode-pill ${storeMode === mode ? 'active' : ''}`}
                  onClick={() => setStoreMode(mode)}
                  type="button"
                >
                  {mode === 'in-person' ? 'In-person' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 1: Meals */}
        {step === 1 && (
          <>
            {addedMeals.length > 0 && (
              <div className="onboarding-pills">
                {addedMeals.map((name, i) => (
                  <div key={i} className="onboarding-pill">
                    {name}
                    <span className="remove" onClick={() => handleRemoveMeal(i)}>{'\u00D7'}</span>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddMeal} className="onboarding-input-row">
              <input
                className="onboarding-input"
                type="text"
                placeholder="Tacos, pasta, burgers..."
                value={mealInput}
                onChange={(e) => setMealInput(e.target.value)}
                autoFocus
              />
              <button className="btn primary" type="submit">Add</button>
            </form>
          </>
        )}

        {/* Step 2: Regulars */}
        {step === 2 && (
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

        {/* Step 3: Pantry */}
        {step === 3 && (
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
            disabled={!canProceed}
          >
            {step === 3 ? 'Get cooking' : step === 0 ? 'Next' : 'Skip / Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
