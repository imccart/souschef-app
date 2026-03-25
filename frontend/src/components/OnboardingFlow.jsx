import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import ClippyGuide from './ClippyGuide'
import ladleImg from '../assets/ladle.png'
import styles from './OnboardingFlow.module.css'

// ── Pre-auth Welcome Screen (unchanged) ─────────────────

export function WelcomeScreen({ onStart }) {
  const [phase, setPhase] = useState(0)
  const ladleRef = useRef(null)
  const logoRef = useRef(null)
  const dripRef = useRef(null)
  const [liftDy, setLiftDy] = useState(0)
  const [splatPos, setSplatPos] = useState({ x: 0, y: 0 })

  const runAnimation = useCallback(() => {
    setPhase(0)
    const t0 = setTimeout(() => {
      if (ladleRef.current && logoRef.current) {
        const ladleRect = ladleRef.current.getBoundingClientRect()
        const logoRect = logoRef.current.getBoundingClientRect()
        const dy = (logoRect.top + logoRect.height / 2) - (ladleRect.top + ladleRect.height / 2)
        setLiftDy(dy)
        const impactX = ladleRect.left + ladleRect.width * 0.33
        const impactY = ladleRect.top + ladleRect.height * 0.82 + 160
        setSplatPos({ x: impactX, y: impactY })
      }
      setPhase(1)
    }, 100)
    const t1 = setTimeout(() => setPhase(2), 1100)
    const t2 = setTimeout(() => setPhase(3), 1490)
    const t3 = setTimeout(() => setPhase(4), 1960)
    const t4 = setTimeout(() => setPhase(5), 2260)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [])

  useEffect(() => {
    let cleanup
    const start = () => { cleanup = runAnimation() }
    if (document.fonts) { document.fonts.ready.then(start) } else { start() }
    return () => { if (cleanup) cleanup() }
  }, [runAnimation])

  const ladleClass = `${styles.ladle}${phase >= 4 ? ` ${styles.upright}` : phase >= 1 ? ` ${styles.tilt}` : ''}`
  const moverClass = `${styles.ladleMover}${phase >= 4 ? ` ${styles.lift}` : ''}`
  const moverStyle = phase >= 4 ? { '--lift-dy': `${liftDy}px` } : {}

  return (
    <div className={styles.welcome}>
      {phase >= 3 && (
        <>
          <div className={`${styles.welcomeSplat} ${styles.main}`} style={{ left: splatPos.x - 9, top: splatPos.y - 4 }} />
          <div className={`${styles.welcomeSplat} ${styles.a}`} style={{ left: splatPos.x - 18, top: splatPos.y - 3 }} />
          <div className={`${styles.welcomeSplat} ${styles.b}`} style={{ left: splatPos.x - 30, top: splatPos.y + 2 }} />
          <div className={`${styles.welcomeSplat} ${styles.c}`} style={{ left: splatPos.x - 14, top: splatPos.y + 6 }} />
        </>
      )}
      <div className={styles.welcomeContent}>
        <div className={styles.welcomeLogoSlot} ref={logoRef} />
        <div className={`${styles.welcomeWordmark}${phase >= 4 ? ` ${styles.reveal}` : ''}`}>sous<em>chef</em></div>
        <div className={styles.welcomeTaglineSlot}>
          <div className={`${styles.welcomeTagline}${phase >= 4 ? ` ${styles.reveal}` : ''}`}>
            because someone has to plan dinner<br />and get groceries
          </div>
          <div className={moverClass} ref={ladleRef} style={moverStyle}>
            <img className={ladleClass} src={ladleImg} alt="" />
            {phase >= 2 && phase < 4 && <div className={styles.welcomeDrip} ref={dripRef} />}
          </div>
        </div>
        <button className={`${styles.welcomeBtn}${phase >= 5 ? ` ${styles.reveal}` : ''}`} onClick={onStart}>
          Get started
        </button>
        <div className={`${styles.welcomeFooter}${phase >= 5 ? ` ${styles.show}` : ''}`}>
          an <a href="https://aletheia.fyi">aletheia</a> project
        </div>
      </div>
    </div>
  )
}

// ── Clippy quips per step ───────────────────────────────

const CLIPPY_QUIPS = [
  "Looks like you're trying to make dinner. \u{1F4CE}",
  "It looks like you're trying to cook from scratch! Would you like me to open the 'Recipe vs. Reality' template, or should I just pre-load a shortcut to UberEats for 7:00 PM Thursday?",
  "It looks like you're listing 'Flour.' I've noticed you haven't opened that bag since the Great Sourdough Craze of 2020. Should I change the quantity to 'One Small Bag for Dusting' or are we still pretending we're bakers?",
  "It looks like you're making a list of 'The Regulars.' Should I go ahead and hide the 'Vegetable' section since we both know how that ends?",
  "It looks like you're trying to Link an Account. Should I also link your credit card, your home address, and your deepest dietary secrets to the cloud? It makes the 'Buy Again' button so much shinier!",
  "You're all done! Would you like me to minimize into a tiny, judgmental dot, or shall I transform into a spinning hourglass until you come back with snacks?",
]

// ── Default meals to pre-select ─────────────────────────

const DEFAULT_MEALS = [
  'tacos', 'spaghetti and meatballs', 'burgers', 'chicken quesadillas',
  'mac and cheese', 'grilled cheese', 'chicken nuggets', 'pancakes',
]

// ── Regulars suggestions by category ────────────────────

const REGULAR_CATEGORIES = {
  'Dairy & Eggs': ['milk', 'eggs', 'yogurt', 'cheese', 'butter', 'sour cream'],
  'Bread & Bakery': ['bread', 'bagels', 'english muffins', 'tortillas'],
  'Breakfast': ['cereal', 'oatmeal', 'granola bars', 'pancake mix'],
  'Drinks': ['juice', 'coffee', 'sparkling water', 'milk'],
  'Snacks': ['chips', 'crackers', 'fruit snacks', 'goldfish crackers'],
  'Lunch': ['deli meat', 'sandwich bread', 'chips', 'applesauce'],
  'Household': ['paper towels', 'trash bags', 'dish soap', 'sponges'],
  'Pets': [],
}

// ── Time survey options ─────────────────────────────────

const TIME_OPTIONS = [
  { value: '<30', label: 'Less than 30 minutes' },
  { value: '30-60', label: '30\u201360 minutes' },
  { value: '1-2hr', label: '1\u20132 hours' },
  { value: '>2hr', label: 'More than 2 hours' },
]

// ── Tour stops ──────────────────────────────────────────

const TOUR_STOPS = [
  { icon: '\u{1F4CB}', label: 'Plan', desc: 'Your dinners for the week. Tap a day to pick a meal.' },
  { icon: '\u{1F6D2}', label: 'Grocery', desc: 'Everything you need to buy, organized by aisle.' },
  { icon: '\u{1F4E6}', label: 'Order', desc: 'Pick products from your store and send your cart.' },
  { icon: '\u{1F9FE}', label: 'Receipt', desc: 'Upload your receipt to track what you bought.' },
  { icon: '\u{1F944}', label: 'Kitchen', desc: 'Your meals, sides, staples, and product ratings.' },
  { icon: '\u{1F9D1}\u200D\u{1F373}', label: 'Account', desc: 'Store connections, household sharing, and settings.' },
]

// ── Main Onboarding Flow ────────────────────────────────

export default function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1: Meals + Sides
  const [library, setLibrary] = useState(null)
  const [selectedMealIds, setSelectedMealIds] = useState(new Set())
  const [selectedSideIds, setSelectedSideIds] = useState(new Set())
  const [customMealInput, setCustomMealInput] = useState('')
  const [customMeals, setCustomMeals] = useState([])
  const [customSideInput, setCustomSideInput] = useState('')
  const [customSides, setCustomSides] = useState([])
  const [expandedRecipe, setExpandedRecipe] = useState(null)
  const [showTimeSurvey, setShowTimeSurvey] = useState(false)
  const [timeBaseline, setTimeBaseline] = useState('')

  // Step 2: Staples
  const [staplesData, setStaplesData] = useState(null)
  const [selectedStaples, setSelectedStaples] = useState(new Set())

  // Step 3: Regulars
  const [selectedRegulars, setSelectedRegulars] = useState(new Set())
  const [regularInput, setRegularInput] = useState('')

  // Step 4: Store
  const [krogerConnected, setKrogerConnected] = useState(false)
  const [storeZip, setStoreZip] = useState('')
  const [storeResults, setStoreResults] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)

  // Step 5: Tour
  const [tourStep, setTourStep] = useState(0)

  // Load library on mount
  useEffect(() => {
    api.getOnboardingLibrary().then(data => {
      setLibrary(data)
      // Pre-select default meals
      const defaultIds = new Set()
      for (const m of data.meals) {
        if (DEFAULT_MEALS.includes(m.name.toLowerCase())) {
          defaultIds.add(m.id)
        }
      }
      setSelectedMealIds(defaultIds)
    })
  }, [])

  // Detect Kroger OAuth return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('kroger') === 'connected') {
      setKrogerConnected(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const totalSteps = 6

  const goNext = async () => {
    setSaving(true)
    try {
      if (step === 0) {
        // Welcome — just advance
      } else if (step === 1) {
        // Save meals + sides
        if (showTimeSurvey && !timeBaseline) {
          // Time survey showing but not answered — skip it
        }
        await api.selectOnboardingRecipes(
          [...selectedMealIds], [...selectedSideIds],
          customMeals, customSides,
        )
        if (timeBaseline) {
          await api.saveTimeBaseline(timeBaseline)
        }
      } else if (step === 2) {
        // Save staples
        await api.saveOnboardingStaples([...selectedStaples])
      } else if (step === 3) {
        // Save regulars
        await api.saveOnboardingRegulars([...selectedRegulars])
      } else if (step === 4) {
        // Store — nothing to save (OAuth handles it)
        if (selectedLocation) {
          await api.setKrogerLocation(selectedLocation)
        }
      } else if (step === 5) {
        // Tour complete — finish onboarding
        await api.completeOnboarding()
        localStorage.setItem('souschef_onboarded', 'true')
        onComplete()
        return
      }
    } catch { /* continue anyway */ }
    setSaving(false)

    // Load data for next step
    if (step === 0) {
      // About to enter meals step — library already loaded
    } else if (step === 1) {
      // About to enter staples — load staples data
      api.getOnboardingStaples().then(data => {
        setStaplesData(data.staples)
        setSelectedStaples(new Set(data.staples.map(s => s.name)))
      })
    }

    setStep(step + 1)
  }

  const goBack = () => {
    if (step > 0) setStep(step - 1)
  }

  const skipStep = () => {
    setSaving(false)
    if (step === 1) {
      // Load staples for next step
      api.getOnboardingStaples().then(data => {
        setStaplesData(data.staples)
        setSelectedStaples(new Set(data.staples.map(s => s.name)))
      })
    }
    setStep(step + 1)
  }

  // ── Meals + Sides helpers ──

  const toggleMealId = (id) => {
    setSelectedMealIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSideId = (id) => {
    setSelectedSideIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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

  // ── Store helpers ──

  const handleSearchStores = async (e) => {
    e.preventDefault()
    if (!storeZip.trim()) return
    try {
      const data = await api.searchKrogerLocations(storeZip.trim())
      setStoreResults(data.locations || [])
    } catch { setStoreResults([]) }
  }

  const handleConnectKroger = async () => {
    try {
      const data = await api.connectKroger()
      if (data.auth_url) window.location.href = data.auth_url
    } catch { /* ignore */ }
  }

  // ── Render ──

  return (
    <div className={styles.onboarding}>
      <div className={styles.card}>
        {/* Progress dots */}
        <div className={styles.dots}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={`${styles.dot}${i === step ? ` ${styles.active}` : i < step ? ` ${styles.done}` : ''}`} />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className={styles.step}>
            <div className={styles.logo}>sous<em>chef</em></div>
            <div className={styles.welcomeText}>
              Your kitchen and meal assistant. We help you plan dinners, build grocery lists, and order from your favorite store — so you spend less time thinking about what's for dinner.
            </div>
            <div className={styles.welcomeTime}>It takes about 5 minutes to set up.</div>
            <button className={`${styles.obBtn} ${styles.primary}`} onClick={goNext}>Let's get started</button>
          </div>
        )}

        {/* Step 1: Meals + Sides */}
        {step === 1 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>What does your family eat?</div>
            <div className={styles.stepDesc}>
              Pick the meals your family makes regularly. We'll use these to build your grocery list. Don't overthink it — you can always add more later.
            </div>
            <div className={styles.stepHint}>
              We keep it simple. "Tacos" means ground beef, tortillas, cheese, and salsa. We won't ask you to buy a tablespoon of cumin.
            </div>

            {!library ? (
              <div className="loading">Loading recipes...</div>
            ) : (
              <div className={styles.recipeColumns}>
                <div className={styles.recipeSection}>
                  <div className={styles.sectionLabel}>Meals</div>
                  <div className={styles.tileGrid}>
                    {library.meals.map(r => (
                      <div key={r.id} className={`${styles.tile}${selectedMealIds.has(r.id) ? ` ${styles.selected}` : ''}`}>
                        <button className={styles.tileBtn} onClick={() => toggleMealId(r.id)}>
                          {r.name}
                        </button>
                        {selectedMealIds.has(r.id) && r.ingredients && r.ingredients.length > 0 && (
                          <div className={styles.tilePreview}>
                            {r.ingredients.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {customMeals.map(name => (
                      <div key={`custom-${name}`} className={`${styles.tile} ${styles.selected} ${styles.custom}`}>
                        <button className={styles.tileBtn} onClick={() => setCustomMeals(prev => prev.filter(n => n !== name))}>
                          {name}
                        </button>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleAddCustomMeal} className={styles.inputRow}>
                    <input className={styles.input} type="text" placeholder="Add your own meal..."
                      value={customMealInput} onChange={(e) => setCustomMealInput(e.target.value)} />
                    <button className="btn primary" type="submit">+</button>
                  </form>
                </div>

                <div className={styles.recipeSection}>
                  <div className={styles.sectionLabel}>Sides</div>
                  <div className={styles.tileGrid}>
                    {library.sides.map(r => (
                      <div key={r.id} className={`${styles.tile}${selectedSideIds.has(r.id) ? ` ${styles.selected}` : ''}`}>
                        <button className={styles.tileBtn} onClick={() => toggleSideId(r.id)}>
                          {r.name}
                        </button>
                        {selectedSideIds.has(r.id) && r.ingredients && r.ingredients.length > 0 && (
                          <div className={styles.tilePreview}>
                            {r.ingredients.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {customSides.map(name => (
                      <div key={`custom-${name}`} className={`${styles.tile} ${styles.selected} ${styles.custom}`}>
                        <button className={styles.tileBtn} onClick={() => setCustomSides(prev => prev.filter(n => n !== name))}>
                          {name}
                        </button>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleAddCustomSide} className={styles.inputRow}>
                    <input className={styles.input} type="text" placeholder="Add your own side..."
                      value={customSideInput} onChange={(e) => setCustomSideInput(e.target.value)} />
                    <button className="btn primary" type="submit">+</button>
                  </form>
                </div>
              </div>
            )}

            {/* Time survey */}
            <div className={styles.timeSurvey}>
              <div className={styles.timeLabel}>Before Souschef, how long did meal planning and grocery shopping take each week?</div>
              <div className={styles.timeOptions}>
                {TIME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`${styles.timeBtn}${timeBaseline === opt.value ? ` ${styles.selected}` : ''}`}
                    onClick={() => setTimeBaseline(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Staples */}
        {step === 2 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>What's already in your kitchen?</div>
            <div className={styles.stepDesc}>
              Things you always have at home. We'll leave these off your grocery list.
            </div>

            {!staplesData ? (
              <div className="loading">Loading staples...</div>
            ) : (
              <div className={styles.checklist}>
                {Object.entries(
                  staplesData.reduce((acc, s) => {
                    const group = s.aisle || 'Other'
                    if (!acc[group]) acc[group] = []
                    acc[group].push(s)
                    return acc
                  }, {})
                ).map(([group, items]) => (
                  <div key={group} className={styles.category}>
                    <div className={styles.categoryLabel}>{group}</div>
                    {items.map(s => (
                      <div
                        key={s.id}
                        className={styles.checkItem}
                        onClick={() => {
                          setSelectedStaples(prev => {
                            const next = new Set(prev)
                            next.has(s.name) ? next.delete(s.name) : next.add(s.name)
                            return next
                          })
                        }}
                      >
                        <div className={`regular-check${selectedStaples.has(s.name) ? ' active' : ''}`}>
                          {selectedStaples.has(s.name) && '\u2713'}
                        </div>
                        <span>{s.name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className={styles.stepHint} style={{ marginTop: 12 }}>
              If you run out of something, you can always add it to your grocery list manually.
            </div>
          </div>
        )}

        {/* Step 3: Regulars */}
        {step === 3 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>What's always in your cart?</div>
            <div className={styles.stepDesc}>
              Things you buy almost every trip. These go on your list automatically.
            </div>

            <div className={styles.checklist}>
              {Object.entries(REGULAR_CATEGORIES).map(([cat, items]) => (
                <div key={cat} className={styles.category}>
                  <div className={styles.categoryLabel}>{cat}</div>
                  {items.map(name => (
                    <div
                      key={name}
                      className={styles.checkItem}
                      onClick={() => {
                        setSelectedRegulars(prev => {
                          const next = new Set(prev)
                          next.has(name) ? next.delete(name) : next.add(name)
                          return next
                        })
                      }}
                    >
                      <div className={`regular-check${selectedRegulars.has(name) ? ' active' : ''}`}>
                        {selectedRegulars.has(name) && '\u2713'}
                      </div>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              ))}
              {/* Custom additions */}
              {[...selectedRegulars].filter(n => !Object.values(REGULAR_CATEGORIES).flat().includes(n)).map(name => (
                <div key={name} className={styles.checkItem} onClick={() => {
                  setSelectedRegulars(prev => { const next = new Set(prev); next.delete(name); return next })
                }}>
                  <div className="regular-check active">{'\u2713'}</div>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <form onSubmit={(e) => {
              e.preventDefault()
              if (!regularInput.trim()) return
              setSelectedRegulars(prev => new Set(prev).add(regularInput.trim().toLowerCase()))
              setRegularInput('')
            }} className={styles.inputRow}>
              <input className={styles.input} type="text" placeholder="Add something else..."
                value={regularInput} onChange={(e) => setRegularInput(e.target.value)} />
              <button className="btn primary" type="submit">+</button>
            </form>
          </div>
        )}

        {/* Step 4: Store Setup */}
        {step === 4 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>Where do you order groceries?</div>
            <div className={styles.stepDesc}>
              Connect your store to send your grocery list straight to your cart. You can skip this and set it up later.
            </div>

            {krogerConnected ? (
              <div className={styles.storeConnected}>
                <div className={styles.storeCheck}>{'\u2713'}</div>
                <div>Kroger connected!</div>
                {!selectedLocation && (
                  <>
                    <form onSubmit={handleSearchStores} className={styles.inputRow} style={{ marginTop: 12 }}>
                      <input className={styles.input} type="text" placeholder="Zip code..."
                        value={storeZip} onChange={(e) => setStoreZip(e.target.value)} />
                      <button className="btn primary" type="submit">Find stores</button>
                    </form>
                    {storeResults && (
                      <div className={styles.storeList}>
                        {storeResults.length === 0 ? (
                          <div className={styles.stepHint}>No stores found. Try a different zip code.</div>
                        ) : storeResults.map(loc => (
                          <button
                            key={loc.locationId}
                            className={styles.storeItem}
                            onClick={() => setSelectedLocation(loc.locationId)}
                          >
                            <strong>{loc.name}</strong>
                            <span>{loc.address?.addressLine1}, {loc.address?.city}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {selectedLocation && (
                  <div className={styles.stepHint}>Store selected! {'\u2713'}</div>
                )}
              </div>
            ) : (
              <button className={`${styles.obBtn} ${styles.primary}`} onClick={handleConnectKroger} style={{ marginTop: 16 }}>
                Connect Kroger
              </button>
            )}
          </div>
        )}

        {/* Step 5: Tour */}
        {step === 5 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>Here's where everything lives</div>
            <div className={styles.tourCards}>
              {TOUR_STOPS.map((stop, i) => (
                <div key={i} className={`${styles.tourCard}${i <= tourStep ? ` ${styles.visible}` : ''}`}>
                  <div className={styles.tourIcon}>{stop.icon}</div>
                  <div className={styles.tourInfo}>
                    <div className={styles.tourLabel}>{stop.label}</div>
                    <div className={styles.tourDesc}>{stop.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            {tourStep < TOUR_STOPS.length - 1 ? (
              <button className={`${styles.obBtn} ${styles.primary}`} onClick={() => setTourStep(t => t + 1)}>
                Next
              </button>
            ) : null}
          </div>
        )}

        {/* Navigation buttons */}
        {step > 0 && (
          <div className={styles.btnRow}>
            {step > 0 && step < 5 && (
              <button className={styles.skip} onClick={skipStep}>Skip for now</button>
            )}
            {step === 5 && tourStep < TOUR_STOPS.length - 1 && (
              <button className={styles.skip} onClick={() => { setTourStep(TOUR_STOPS.length - 1) }}>Skip tour</button>
            )}
            <div className={styles.btnSpacer} />
            {step > 1 && (
              <button className={`${styles.obBtn} ${styles.secondary}`} onClick={goBack}>Back</button>
            )}
            {step >= 1 && step <= 4 && (
              <button className={`${styles.obBtn} ${styles.primary}`} onClick={goNext} disabled={saving}>
                {saving ? '...' : 'Next'}
              </button>
            )}
            {step === 5 && tourStep >= TOUR_STOPS.length - 1 && (
              <button className={`${styles.obBtn} ${styles.primary}`} onClick={goNext} disabled={saving}>
                {saving ? '...' : "Let's cook!"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Clippy */}
      <ClippyGuide
        quip={CLIPPY_QUIPS[step] || ''}
        showMouse={step === 5 && tourStep >= TOUR_STOPS.length - 1}
      />
    </div>
  )
}
