import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import ClippyGuide from './ClippyGuide'
import runnerRImg from '../assets/runner-r.png'
import styles from './OnboardingFlow.module.css'

// ── Pre-auth Welcome Screen ─────────────────────────────

export function WelcomeScreen({ onStart }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    // Phase 1: runner-R slides in from left
    // Phase 2: R shrinks, "meal" + "unner" expand around it
    // Phase 3: tagline fades in + brand group slides up
    // Phase 4: button + footer
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeContent}>
        <div className={`${styles.brandGroup}${phase >= 3 ? ` ${styles.slideUp}` : ''}`}>
          <div className={styles.wordmarkRow}>
            <span className={`${styles.mealPart}${phase >= 2 ? ` ${styles.slideIn}` : ''}`}>meal</span>
            <img
              className={`${styles.runnerR}${phase >= 1 ? ` ${styles.runIn}` : ''}${phase >= 2 ? ` ${styles.shrink}` : ''}`}
              src={runnerRImg}
              alt=""
            />
            <span className={`${styles.unnerPart}${phase >= 2 ? ` ${styles.slideIn}` : ''}`}>unner</span>
          </div>
          <div className={`${styles.welcomeTagline}${phase >= 3 ? ` ${styles.reveal}` : ''}`}>
            From planning to pantry.
          </div>
        </div>
        <button className={`${styles.welcomeBtn}${phase >= 4 ? ` ${styles.reveal}` : ''}`} onClick={onStart}>
          Get started
        </button>
        <div className={`${styles.welcomeFooter}${phase >= 4 ? ` ${styles.show}` : ''}`}>
          an <a href="https://aletheia.fyi">aletheia</a> project
        </div>
      </div>
    </div>
  )
}

// ── Clippy quips per step ───────────────────────────────

const CLIPPY_QUIPS = [
  "Looks like you're trying to make dinner.",
  "It looks like you're trying to cook from scratch! Would you like me to open the 'Recipe vs. Reality' template, or should I just pre-load a shortcut to UberEats for 7:00 PM Thursday?",
  "It looks like you're listing 'Flour.' I've noticed you haven't opened that bag since the Great Sourdough Craze of 2020. Should I change the quantity to 'One Small Bag for Dusting' or are we still pretending we're bakers?",
  "It looks like you're making a list of 'The Regulars.' Should I go ahead and hide the 'Vegetable' section since we both know how that ends?",
  "It looks like you're trying to Link an Account. Should I also link your credit card, your home address, and your deepest dietary secrets to the cloud? It makes the 'Buy Again' button so much shinier!",
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
  'Pets': ['cat food', 'dog food', 'cat litter'],
}

// ── Time survey options ─────────────────────────────────

const TIME_OPTIONS = [
  { value: '<30', label: 'Less than 30 minutes' },
  { value: '30-60', label: '30\u201360 minutes' },
  { value: '1-2hr', label: '1\u20132 hours' },
  { value: '>2hr', label: 'More than 2 hours' },
]

// ── Main Onboarding Flow ────────────────────────────────

// Household members skip meals/sides/staples/regulars (steps 1-3)
// Flow: Welcome(0) → Store(4)
const HH_STEPS = [0, 4]

export default function OnboardingFlow({ onComplete, householdInfo }) {
  const isHousehold = !!householdInfo
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
  const [stapleInput, setStapleInput] = useState('')

  // Step 3: Regulars
  const [selectedRegulars, setSelectedRegulars] = useState(new Set())
  const [regularInput, setRegularInput] = useState('')

  // Step 0: Who Are You
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [homeZip, setHomeZip] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [sentInvites, setSentInvites] = useState([])

  // Step 4: Store
  const [krogerConnected, setKrogerConnected] = useState(false)
  const [storeZip, setStoreZip] = useState('')
  const [storeResults, setStoreResults] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [comparisonStores, setComparisonStores] = useState(new Set())
  const [compZip, setCompZip] = useState('')
  const [compResults, setCompResults] = useState(null)

  // Load library on mount (skip for household members)
  useEffect(() => {
    if (isHousehold) return
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
  }, [isHousehold])

  // Detect Kroger OAuth return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('kroger') === 'connected') {
      setKrogerConnected(true)
      setStep(4)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const activeSteps = isHousehold ? HH_STEPS : [0, 1, 2, 3, 4]
  const totalSteps = activeSteps.length

  const goNext = async () => {
    setSaving(true)
    try {
      if (step === 0) {
        // Who Are You — save name, zip, TOS
        if (firstName.trim() || lastName.trim()) {
          await api.updateAccount({ first_name: firstName.trim(), last_name: lastName.trim() })
        }
        if (homeZip.trim()) {
          await api.saveHomeZip(homeZip.trim())
        }
        if (tosAccepted) {
          await api.acceptTos('1.0')
        }
        // Send any pending invites
        for (const email of sentInvites) {
          try { await api.inviteToHousehold(email) } catch { /* ignore dupes */ }
        }
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
        // Store — save location + enable price tracking by default
        if (selectedLocation) {
          await api.setKrogerLocation(selectedLocation, storeZip.trim())
        }
        // Save comparison stores
        if (comparisonStores.size > 0) {
          const allResults = [...(storeResults || []), ...(compResults || [])]
          const nearby = allResults
            .filter(l => comparisonStores.has(l.location_id) && l.location_id !== selectedLocation)
            .map(l => ({ location_id: l.location_id, name: l.name, address: l.address }))
          if (nearby.length > 0) await api.saveNearbyStores(nearby)
        }
        await api.setPriceTracking({ price_polling: true, price_sharing: true })
        // Store step is the last — finish onboarding
        await api.completeOnboarding()
        localStorage.setItem('mealrunner_onboarded', 'true')
        onComplete()
        return
      }
    } catch {
      // If step 4 fails partially, still finish onboarding
      if (step === activeSteps[activeSteps.length - 1]) {
        try { await api.completeOnboarding() } catch {}
        localStorage.setItem('mealrunner_onboarded', 'true')
        onComplete()
        return
      }
    }
    setSaving(false)

    // Don't advance past the last step
    if (step === activeSteps[activeSteps.length - 1]) {
      return
    }

    const nextStep = getNextStep(step)

    // Load data for next step
    if (!isHousehold) {
      if (step === 0) {
        // About to enter meals step — library already loaded
      } else if (step === 1) {
        // About to enter staples — load staples data
        api.getOnboardingStaples().then(data => {
          setStaplesData(data.staples)
          setSelectedStaples(new Set(data.staples.map(s => s.name)))
        })
      }
    }

    // Auto-search stores when entering step 4 if zip is set
    if (nextStep === 4 && homeZip.trim() && !storeResults) {
      setStoreZip(homeZip.trim())
      api.searchKrogerLocations(homeZip.trim()).then(data => {
        setStoreResults(data.locations || [])
      }).catch(() => {})
    }

    setStep(nextStep)
  }

  const getNextStep = (current) => {
    if (!isHousehold) return current + 1
    const idx = HH_STEPS.indexOf(current)
    return idx >= 0 && idx < HH_STEPS.length - 1 ? HH_STEPS[idx + 1] : current + 1
  }

  const getPrevStep = (current) => {
    if (!isHousehold) return current - 1
    const idx = HH_STEPS.indexOf(current)
    return idx > 0 ? HH_STEPS[idx - 1] : current - 1
  }

  const goBack = () => {
    if (step > 0) setStep(getPrevStep(step))
  }

  const skipStep = async () => {
    setSaving(false)
    // If on last step, skip finishes onboarding
    if (step === activeSteps[activeSteps.length - 1]) {
      try { await api.completeOnboarding() } catch {}
      localStorage.setItem('mealrunner_onboarded', 'true')
      onComplete()
      return
    }
    const nextStep = getNextStep(step)
    if (!isHousehold && step === 1) {
      // Load staples for next step
      api.getOnboardingStaples().then(data => {
        setStaplesData(data.staples)
        setSelectedStaples(new Set(data.staples.map(s => s.name)))
      })
    }
    setStep(nextStep)
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
      if (data.url) window.location.href = data.url
    } catch { /* ignore */ }
  }

  // ── Render ──

  return (
    <div className={styles.onboarding}>
      <div className={styles.card}>
        {/* Progress dots */}
        <div className={styles.dots}>
          {activeSteps.map((s, i) => (
            <div key={i} className={`${styles.dot}${s === step ? ` ${styles.active}` : activeSteps.indexOf(step) > i ? ` ${styles.done}` : ''}`} />
          ))}
        </div>

        {/* Step 0: Who Are You */}
        {step === 0 && (
          <div className={styles.step}>
            <div className={styles.logo} style={{ textAlign: 'center', display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>meal<img src={runnerRImg} alt="" style={{ width: 28, height: 30, objectFit: 'contain', position: 'relative', top: 4, margin: '0 -1px' }} /><em>unner</em></div>
            {isHousehold ? (
              <div className={styles.welcomeText} style={{ textAlign: 'center' }}>
                {householdInfo.ownerName} invited you to share their kitchen. Tell us a little about yourself.
              </div>
            ) : (
              <div className={styles.welcomeText} style={{ textAlign: 'center' }}>
                Let's get you set up. It takes about 5 minutes.
              </div>
            )}

            <div className={styles.stepTitle} style={{ marginTop: 16 }}>About you</div>
            <div className={styles.nameRow}>
              <input
                className={styles.input}
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                className={styles.input}
                type="text"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className={styles.inputRow}>
              <input
                className={styles.input}
                type="text"
                inputMode="numeric"
                placeholder="Zip code"
                value={homeZip}
                onChange={(e) => setHomeZip(e.target.value)}
                maxLength={5}
                style={{ maxWidth: 120 }}
              />
            </div>

            {!isHousehold && (
              <>
                <div className={styles.stepTitle} style={{ marginTop: 20 }}>Invite other household members?</div>
                <div className={styles.stepDesc}>
                  Share your kitchen with a partner or family member. They'll see your meals and grocery list. You can always do this later from your account settings.
                </div>
                <form onSubmit={(e) => {
                  e.preventDefault()
                  const email = inviteEmail.trim()
                  if (!email || sentInvites.includes(email)) return
                  setSentInvites(prev => [...prev, email])
                  setInviteEmail('')
                }} className={styles.inputRow}>
                  <input className={styles.input} type="email" placeholder="Email address"
                    value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                  <button className="btn primary" type="submit">Invite</button>
                </form>
                {sentInvites.map(email => (
                  <div key={email} className={styles.inviteSent}>
                    {'\u2713'} {email}
                    <button className={styles.inviteRemove} onClick={() => setSentInvites(prev => prev.filter(e => e !== email))}>{'\u00d7'}</button>
                  </div>
                ))}
              </>
            )}

            <div className={styles.tosRow}>
              <label className={styles.tosLabel}>
                <input
                  type="checkbox"
                  checked={tosAccepted}
                  onChange={(e) => setTosAccepted(e.target.checked)}
                />
                I agree to the <a href="/app/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/app/privacy" target="_blank" rel="noopener">Privacy Policy</a>
              </label>
            </div>
          </div>
        )}

        {/* Step 1: Meals + Sides */}
        {step === 1 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>What does your family eat?</div>
            <div className={styles.stepDesc}>
              Add some meals your family makes regularly. We'll use these to build your grocery list. For a lot of meals, we have default ingredients. You can change these or add ingredients any time in the "My Kitchen" section later. We try to keep it simple here. "Tacos" means tortillas, cheese, maybe a meat, etc. We won't ask you to buy a tablespoon of cumin.
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
              <div className={styles.timeLabel}>Before MealRunner, how long did meal planning and grocery shopping take each week?</div>
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
              In the list below, check off items you'd like treated as "keep on hand" in your digital pantry. These are staples used for many different meals — things like flour, olive oil, salt, etc. We'll leave them off your grocery list by default, but you can always add them when you're running low.
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
            {/* Custom additions */}
            {[...selectedStaples].filter(n => !staplesData?.some(s => s.name === n)).map(name => (
              <div key={name} className={styles.checkItem} onClick={() => {
                setSelectedStaples(prev => { const next = new Set(prev); next.delete(name); return next })
              }}>
                <div className="regular-check active">{'\u2713'}</div>
                <span>{name}</span>
              </div>
            ))}
            <form onSubmit={(e) => {
              e.preventDefault()
              if (!stapleInput.trim()) return
              setSelectedStaples(prev => new Set(prev).add(stapleInput.trim().toLowerCase()))
              setStapleInput('')
            }} className={styles.inputRow}>
              <input className={styles.input} type="text" placeholder="Add something else..."
                value={stapleInput} onChange={(e) => setStapleInput(e.target.value)} />
              <button className="btn primary" type="submit">+</button>
            </form>
          </div>
        )}

        {/* Step 3: Regulars */}
        {step === 3 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>What's always in your cart?</div>
            <div className={styles.stepDesc}>
              Check off items you buy almost every trip. These will go on your grocery list automatically each week.
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

        {/* Step 4: Store Integration */}
        {step === 4 && (
          <div className={styles.step}>
            <div className={styles.stepTitle}>Connect your grocery store</div>
            <div className={styles.stepDesc}>
              Link your store account to send your grocery list straight to your online cart. We'll add items to your cart as you shop on the Order page. For some stores, you'll need to open their app to finalize your order and handle any out-of-stock items. All of this can be changed later in your account settings.
            </div>

            <div className={styles.storeAccordion}>
              <details className={styles.storeProvider} open>
                <summary className={styles.storeProviderHeader}>
                  <span>Kroger</span>
                  {krogerConnected && <span className={styles.storeProviderBadge}>{'\u2713'} Connected</span>}
                </summary>
                <div className={styles.storeProviderBody}>
                  {/* Phase 1: Connect account */}
                  {!krogerConnected && (
                    <div style={{ marginBottom: 12 }}>
                      <button className={`${styles.obBtn} ${styles.primary}`} onClick={handleConnectKroger}>
                        Connect your Kroger account
                      </button>
                    </div>
                  )}

                  {/* Phase 2: Select preferred store */}
                  {krogerConnected && !selectedLocation && (
                    <>
                      <div className={styles.stepHint} style={{ marginBottom: 8 }}>Select your preferred store:</div>
                      <form onSubmit={handleSearchStores} className={styles.inputRow} style={{ marginBottom: 8 }}>
                        <input className={styles.input} type="text" placeholder="Search by zip code..."
                          value={storeZip} onChange={(e) => setStoreZip(e.target.value)} />
                        <button className="btn primary" type="submit">Search</button>
                      </form>
                      {storeResults && storeResults.length > 0 && (
                        <div className={styles.storeList}>
                          {storeResults.map(loc => (
                            <button
                              key={loc.location_id}
                              className={styles.storeItem}
                              onClick={() => {
                                setSelectedLocation(loc.location_id)
                                // Auto-populate comparison stores (all others)
                                const others = storeResults.filter(l => l.location_id !== loc.location_id).map(l => l.location_id)
                                setComparisonStores(new Set(others))
                              }}
                            >
                              <strong>{loc.name.replace(/^Kroger\s*-?\s*/i, '')}</strong>
                              <span>{loc.address}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {storeResults && storeResults.length === 0 && (
                        <div className={styles.stepHint}>No stores found. Try a different zip code.</div>
                      )}
                    </>
                  )}

                  {/* Phase 3: Preferred store selected + comparison stores */}
                  {selectedLocation && (
                    <>
                      <div className={styles.storeConnected}>
                        <div className={styles.storeCheck}>{'\u2713'}</div>
                        <div>{storeResults?.find(l => l.location_id === selectedLocation)?.name.replace(/^Kroger\s*-?\s*/i, '') || 'Store selected'}</div>
                        <button className={styles.storeChange} onClick={() => setSelectedLocation(null)}>Change</button>
                      </div>

                      {/* Comparison stores */}
                      {storeResults && storeResults.filter(l => l.location_id !== selectedLocation).length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <div className={styles.stepHint} style={{ marginBottom: 8 }}>
                            We can also compare prices at nearby stores. Uncheck any you'd never shop at.
                          </div>
                          <div className={styles.storeList}>
                            {storeResults.filter(l => l.location_id !== selectedLocation).map(loc => (
                              <label key={loc.location_id} className={styles.storeCompItem}>
                                <input
                                  type="checkbox"
                                  checked={comparisonStores.has(loc.location_id)}
                                  onChange={() => setComparisonStores(prev => {
                                    const next = new Set(prev)
                                    next.has(loc.location_id) ? next.delete(loc.location_id) : next.add(loc.location_id)
                                    return next
                                  })}
                                />
                                <div>
                                  <strong>{loc.name.replace(/^Kroger\s*-?\s*/i, '')}</strong>
                                  <span>{loc.address}</span>
                                </div>
                              </label>
                            ))}
                          </div>

                          {/* Search another zip for comparison */}
                          <form onSubmit={async (e) => {
                            e.preventDefault()
                            if (!compZip.trim()) return
                            try {
                              const data = await api.searchKrogerLocations(compZip.trim())
                              setCompResults(data.locations || [])
                            } catch { setCompResults([]) }
                          }} className={styles.inputRow} style={{ marginTop: 8 }}>
                            <input className={styles.input} type="text" placeholder="Search another zip..."
                              value={compZip} onChange={(e) => setCompZip(e.target.value)} />
                            <button className="btn primary" type="submit">Search</button>
                          </form>
                          {compResults && compResults.length > 0 && (
                            <div className={styles.storeList}>
                              {compResults.filter(l => l.location_id !== selectedLocation && !storeResults.some(s => s.location_id === l.location_id)).map(loc => (
                                <label key={loc.location_id} className={styles.storeCompItem}>
                                  <input
                                    type="checkbox"
                                    checked={comparisonStores.has(loc.location_id)}
                                    onChange={() => setComparisonStores(prev => {
                                      const next = new Set(prev)
                                      next.has(loc.location_id) ? next.delete(loc.location_id) : next.add(loc.location_id)
                                      return next
                                    })}
                                  />
                                  <div>
                                    <strong>{loc.name.replace(/^Kroger\s*-?\s*/i, '')}</strong>
                                    <span>{loc.address}</span>
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </details>
            </div>

            <div className={styles.stepHint} style={{ marginTop: 12, fontStyle: 'italic' }}>
              More store integrations coming soon.
            </div>

            <div className={styles.featureHighlights}>
              <div className={styles.stepTitle} style={{ marginTop: 24 }}>While you shop</div>
              <div className={styles.stepDesc}>
                These features are on by default, but you can always opt out in your account settings.
              </div>

              <div className={styles.featureCard}>
                <strong>Behind the Label</strong>
                <div>On the Order page, we show you who really makes your food, including parent companies, food processing levels (NOVA scores), and FDA recall history.</div>
              </div>

              <div className={styles.featureCard}>
                <strong>Price Tracking</strong>
                <div>We check prices throughout the day so you can compare across nearby stores. We also anonymously share pricing data to help other families find better deals.</div>
              </div>
            </div>
          </div>
        )}


        {/* Navigation buttons */}
        <div className={styles.btnRow}>
          {step !== 0 && (
            <button className={styles.skip} onClick={skipStep}>Skip for now</button>
          )}
          <div className={styles.btnSpacer} />
          {activeSteps.indexOf(step) > 0 && (
            <button className={`${styles.obBtn} ${styles.secondary}`} onClick={goBack}>Back</button>
          )}
          {step === 0 ? (
            <button className={`${styles.obBtn} ${styles.primary}`} onClick={goNext} disabled={saving || !tosAccepted || !firstName.trim()}>
              {saving ? '...' : 'Next'}
            </button>
          ) : (
            <button className={`${styles.obBtn} ${styles.primary}`} onClick={goNext} disabled={saving}>
              {saving ? '...' : 'Next'}
            </button>
          )}
        </div>
      </div>

      {/* Clippy */}
      <ClippyGuide
        quip={CLIPPY_QUIPS[step] || ''}
        showMouse={false}
      />
    </div>
  )
}
