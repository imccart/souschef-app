import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import AutocompleteInput from './AutocompleteInput'

function AccordionSection({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="prefs-accordion">
      <button className="prefs-accordion-header" onClick={() => setOpen(!open)}>
        <span className="prefs-accordion-title">{title}</span>
        {count != null && <span className="prefs-accordion-count">{count}</span>}
        <span className="prefs-accordion-arrow">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && <div className="prefs-accordion-body">{children}</div>}
    </div>
  )
}

function RecipeItem({ recipe, onRemove, allIngredients, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [ingredients, setIngredients] = useState(null)

  useEffect(() => {
    if (defaultExpanded && ingredients === null) loadIngredients()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const [addText, setAddText] = useState('')

  const loadIngredients = async () => {
    try {
      const data = await api.getRecipeIngredients(recipe.id)
      setIngredients(data.ingredients)
    } catch { /* leave as null */ }
  }

  const handleToggle = () => {
    if (!expanded && ingredients === null) loadIngredients()
    setExpanded(!expanded)
  }

  const handleAdd = async (name) => {
    if (!name.trim()) return
    try {
      await api.addRecipeIngredient(recipe.id, name.trim())
      setAddText('')
      loadIngredients()
    } catch { /* ignore */ }
  }

  const handleRemoveIngredient = async (riId) => {
    try {
      await api.removeRecipeIngredient(recipe.id, riId)
      loadIngredients()
    } catch { /* ignore */ }
  }

  const existingNames = new Set((ingredients || []).map(i => i.name.toLowerCase()))

  return (
    <div className="prefs-recipe-item">
      <div className="prefs-list-item" onClick={handleToggle} style={{ cursor: 'pointer' }}>
        <span className="prefs-accordion-arrow" style={{ marginRight: 6, fontSize: 11 }}>
          {expanded ? '\u25B4' : '\u25BE'}
        </span>
        <span className="prefs-list-name">{recipe.name}</span>
        {ingredients && <span className="prefs-list-meta">{ingredients.length} items</span>}
        <button className="prefs-remove" onClick={(e) => { e.stopPropagation(); onRemove(recipe.id) }}>{'\u00D7'}</button>
      </div>
      {expanded && (
        <div className="prefs-recipe-ingredients">
          {ingredients && ingredients.length > 0 && (
            <div className="prefs-ingredient-list">
              {ingredients.map(ing => (
                <div key={ing.id} className="prefs-ingredient-item">
                  <span>{ing.name}</span>
                  <button className="prefs-remove" onClick={() => handleRemoveIngredient(ing.id)}>{'\u00D7'}</button>
                </div>
              ))}
            </div>
          )}
          {ingredients && ingredients.length === 0 && (
            <div className="prefs-section-hint" style={{ marginTop: 0 }}>No ingredients yet</div>
          )}
          <div className="prefs-add-row">
            <AutocompleteInput
              value={addText}
              onChange={setAddText}
              onSubmit={handleAdd}
              candidates={allIngredients || []}
              exclude={existingNames}
              placeholder="Add ingredient..."
              inputClassName="prefs-add-input"
            />
            <button className="btn primary" onClick={() => addText.trim() && handleAdd(addText)}>+</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PreferencesSheet({ onClose }) {
  const [regulars, setRegulars] = useState(null)
  const [pantry, setPantry] = useState(null)
  const [recipes, setRecipes] = useState(null)
  const [allIngredients, setAllIngredients] = useState(null)
  const [addRegularText, setAddRegularText] = useState('')
  const [addPantryText, setAddPantryText] = useState('')
  const [addRecipeText, setAddRecipeText] = useState('')
  const [addSideText, setAddSideText] = useState('')
  const [newRecipeId, setNewRecipeId] = useState(null)
  const [members, setMembers] = useState(null)
  const [householdEmail, setHouseholdEmail] = useState('')
  const [betaEmail, setBetaEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState(null)
  const [betaInviteStatus, setBetaInviteStatus] = useState(null)
  const [userEmail, setUserEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [krogerConnected, setKrogerConnected] = useState(null)
  const [krogerLocationId, setKrogerLocationId] = useState('')
  const [krogerLocationName, setKrogerLocationName] = useState('')
  const [storeZip, setStoreZip] = useState('')
  const [storeResults, setStoreResults] = useState(null)
  const [storeSearching, setStoreSearching] = useState(false)
  const [allowHousehold, setAllowHousehold] = useState(false)
  useEffect(() => {
    api.getMe().then(data => {
      setUserEmail(data.email || '')
      setDisplayName(data.display_name || '')
    }).catch(() => {})
    api.getRegulars().then(data => setRegulars(data.regulars)).catch(() => setRegulars([]))
    api.getPantry().then(data => setPantry(data.items)).catch(() => setPantry([]))
    api.getRecipes().then(data => setRecipes(data.recipes)).catch(() => setRecipes([]))
    api.getGrocerySuggestions().then(data => setAllIngredients(data.suggestions)).catch(() => {})
    api.getHouseholdMembers().then(data => setMembers(data.members)).catch(() => {})
    api.getKrogerStatus().then(data => setKrogerConnected(data.connected)).catch(() => setKrogerConnected(false))
    api.getKrogerLocation().then(data => {
      if (data.location_id) setKrogerLocationId(data.location_id)
    }).catch(() => {})
    api.getKrogerHouseholdAccounts().then(data => {
      const yours = (data.accounts || []).find(a => a.is_you)
      if (yours && yours.allow_household != null) setAllowHousehold(yours.allow_household)
    }).catch(() => {})
  }, [])

  const handleRemoveRegular = async (id) => {
    try {
      await api.removeRegular(id)
      const data = await api.getRegulars()
      setRegulars(data.regulars)
    } catch { /* reload on next open */ }
  }

  const handleRemovePantry = async (id) => {
    try {
      await api.removePantryItem(id)
      const data = await api.getPantry()
      setPantry(data.items)
    } catch { /* reload on next open */ }
  }

  const handleMoveToPantry = async (id, name) => {
    try {
      await api.removeRegular(id)
      await api.addPantryItem(name)
      const [rData, pData] = await Promise.all([api.getRegulars(), api.getPantry()])
      setRegulars(rData.regulars)
      setPantry(pData.items)
    } catch { /* reload on next open */ }
  }

  const handleMoveToRegulars = async (name, id) => {
    // Optimistic: remove from pantry UI immediately
    setPantry(prev => (prev || []).filter(p => p.id !== id))
    try {
      await api.removePantryItem(id)
      await api.addRegular(name)
      const rData = await api.getRegulars()
      setRegulars(rData.regulars)
    } catch {
      // Revert on failure
      const pData = await api.getPantry()
      setPantry(pData.items)
    }
  }

  const handleAddRecipe = async (e) => {
    e.preventDefault()
    if (!addRecipeText.trim()) return
    try {
      const result = await api.addRecipe(addRecipeText.trim())
      setAddRecipeText('')
      if (result.id) setNewRecipeId(result.id)
      const data = await api.getRecipes()
      setRecipes(data.recipes)
    } catch { /* reload on next open */ }
  }

  const handleRemoveRecipe = async (id) => {
    try {
      const result = await api.deleteRecipe(id)
      if (!result.ok) {
        alert(result.error || 'Cannot remove this recipe')
        return
      }
      const data = await api.getRecipes()
      setRecipes(data.recipes)
    } catch { /* reload on next open */ }
  }

  const handleHouseholdInvite = async (e) => {
    e.preventDefault()
    if (!householdEmail.trim()) return
    setInviteStatus(null)
    try {
      const result = await api.inviteToHousehold(householdEmail.trim())
      if (result.ok) {
        setHouseholdEmail('')
        setInviteStatus({ type: 'success', msg: 'Invite sent!' })
        const data = await api.getHouseholdMembers()
        setMembers(data.members)
      } else {
        setInviteStatus({ type: 'error', msg: result.error || 'Failed to send' })
      }
    } catch {
      setInviteStatus({ type: 'error', msg: 'Something went wrong' })
    }
  }

  const handleBetaInvite = async (e) => {
    e.preventDefault()
    if (!betaEmail.trim()) return
    setBetaInviteStatus(null)
    try {
      const result = await api.inviteToBeta(betaEmail.trim())
      if (result.ok) {
        setBetaEmail('')
        setBetaInviteStatus({ type: 'success', msg: 'Invite sent!' })
      } else {
        setBetaInviteStatus({ type: 'error', msg: result.error || 'Failed to send' })
      }
    } catch {
      setBetaInviteStatus({ type: 'error', msg: 'Something went wrong' })
    }
  }

  const handleConnectKroger = async () => {
    try {
      const result = await api.connectKroger()
      if (result.url) {
        window.location.href = result.url
      }
    } catch {
      // Kroger credentials not configured on server
    }
  }

  const handleDisconnectKroger = async () => {
    try {
      await api.disconnectKroger()
      setKrogerConnected(false)
    } catch { /* ignore */ }
  }

  const handleSearchStores = async (e) => {
    e.preventDefault()
    if (!storeZip.trim() || storeZip.trim().length < 5) return
    setStoreSearching(true)
    try {
      const data = await api.searchKrogerLocations(storeZip.trim())
      setStoreResults(data.locations || [])
    } catch {
      setStoreResults([])
    }
    setStoreSearching(false)
  }

  const handleSelectStore = async (loc) => {
    try {
      await api.setKrogerLocation(loc.location_id)
      setKrogerLocationId(loc.location_id)
      setKrogerLocationName(loc.name + ' — ' + loc.address)
      setStoreResults(null)
      setStoreZip('')
    } catch { /* ignore */ }
  }

  // Group regulars by shopping_group
  const regularGroups = {}
  if (regulars) {
    for (const r of regulars) {
      const g = r.shopping_group || 'Other'
      if (!regularGroups[g]) regularGroups[g] = []
      regularGroups[g].push(r)
    }
  }

  const handleSaveName = async () => {
    try {
      await api.updateAccount({ display_name: displayName })
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <Sheet onClose={onClose} className="prefs-sheet">
        <div className="sheet-title">Preferences</div>
        <div className="sheet-sub">Configurable any time</div>

        {/* About You */}
        <AccordionSection title="About You" defaultOpen>
          <div className="prefs-account-field">
            <label className="prefs-field-label">Name</label>
            <div className="prefs-add-row">
              <input
                className="prefs-add-input"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false) }}
                onBlur={() => displayName.trim() && handleSaveName()}
              />
              {nameSaved && <span className="prefs-saved">{'\u2713'}</span>}
            </div>
          </div>
          <div className="prefs-account-field">
            <label className="prefs-field-label">Email</label>
            <div className="prefs-field-value">{userEmail}</div>
          </div>
          <button className="prefs-logout" onClick={async () => {
            await api.logout()
            localStorage.removeItem('souschef_onboarded')
            localStorage.removeItem('souschef_welcomed')
            window.location.reload()
          }}>
            Sign out
          </button>
        </AccordionSection>

        {/* Online Ordering */}
        <AccordionSection title="Online Ordering">
          <div className="prefs-integration-block">
            {krogerConnected === null ? (
              <div className="prefs-list-meta">Checking connection...</div>
            ) : krogerConnected ? (
              <>
                <div className="prefs-integration-connected">
                  <span className="prefs-connected">Kroger: Connected {'\u2713'}</span>
                  <button className="prefs-disconnect" onClick={handleDisconnectKroger}>Disconnect</button>
                </div>
                {/* Store location picker */}
                <div className="prefs-kroger-store">
                  {krogerLocationId ? (
                    <div className="prefs-kroger-selected">
                      <span className="prefs-list-meta">
                        Store: {krogerLocationName || `#${krogerLocationId}`}
                      </span>
                      <button className="prefs-disconnect" onClick={() => { setKrogerLocationId(''); setKrogerLocationName(''); setStoreResults(null) }}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="prefs-section-hint" style={{ marginTop: 8 }}>Select your Kroger store</div>
                      <form onSubmit={handleSearchStores} className="prefs-add-row">
                        <input
                          className="prefs-add-input"
                          type="text"
                          placeholder="Zip code..."
                          value={storeZip}
                          onChange={(e) => setStoreZip(e.target.value)}
                          maxLength={5}
                          inputMode="numeric"
                        />
                        <button className="btn primary" type="submit" disabled={storeSearching}>
                          {storeSearching ? '...' : 'Search'}
                        </button>
                      </form>
                      {storeResults && storeResults.length === 0 && (
                        <div className="prefs-section-hint">No stores found near that zip.</div>
                      )}
                      {storeResults && storeResults.length > 0 && (
                        <div className="prefs-list prefs-store-results">
                          {storeResults.map(loc => (
                            <div key={loc.location_id} className="prefs-list-item prefs-store-result" onClick={() => handleSelectStore(loc)}>
                              <div>
                                <div className="prefs-list-name">{loc.name}</div>
                                <div className="prefs-list-meta">{loc.address}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {members && members.length > 1 && (
                  <label className="prefs-household-toggle">
                    <input
                      type="checkbox"
                      checked={allowHousehold}
                      onChange={async () => {
                        const next = !allowHousehold
                        setAllowHousehold(next)
                        try { await api.setStoreHouseholdAccess(next) } catch { setAllowHousehold(!next) }
                      }}
                    />
                    <span>Let household members order through this account</span>
                    <div className="prefs-toggle-hint">They can place orders using your account and loyalty points.</div>
                  </label>
                )}
              </>
            ) : (
              <button className="btn primary prefs-integration-btn" onClick={handleConnectKroger}>
                Connect Kroger Account
              </button>
            )}
          </div>
          <div className="prefs-section-hint">More integrations coming soon.</div>
        </AccordionSection>

        {/* Kitchen — Meals, Sides, Regulars, Pantry */}
        <AccordionSection title="Kitchen">
          <AccordionSection title="Meals" count={recipes ? recipes.filter(r => r.recipe_type !== 'side').length : 0}>
            <div className="prefs-section-hint">
              Your meal rotation. Add meals you make regularly.
            </div>
            {recipes && recipes.filter(r => r.recipe_type !== 'side').length > 0 && (
              <div className="prefs-list">
                {recipes.filter(r => r.recipe_type !== 'side').map(r => (
                  <RecipeItem key={r.id} recipe={r} onRemove={handleRemoveRecipe} allIngredients={allIngredients} defaultExpanded={r.id === newRecipeId} />
                ))}
              </div>
            )}
            <form onSubmit={handleAddRecipe} className="prefs-add-row">
              <input
                className="prefs-add-input"
                type="text"
                placeholder="Add a meal..."
                value={addRecipeText}
                onChange={(e) => setAddRecipeText(e.target.value)}
              />
              <button className="btn primary" type="submit">+</button>
            </form>
          </AccordionSection>

          <AccordionSection title="Sides" count={recipes ? recipes.filter(r => r.recipe_type === 'side').length : 0}>
            <div className="prefs-section-hint">
              Side dishes paired with your meals.
            </div>
            {recipes && recipes.filter(r => r.recipe_type === 'side').length > 0 && (
              <div className="prefs-list">
                {recipes.filter(r => r.recipe_type === 'side').map(r => (
                  <RecipeItem key={r.id} recipe={r} onRemove={handleRemoveRecipe} allIngredients={allIngredients} defaultExpanded={r.id === newRecipeId} />
                ))}
              </div>
            )}
            <form onSubmit={async (e) => {
              e.preventDefault()
              if (!addSideText.trim()) return
              try {
                const result = await api.addRecipe(addSideText.trim(), 'side')
                setAddSideText('')
                if (result.id) setNewRecipeId(result.id)
                const data = await api.getRecipes()
                setRecipes(data.recipes)
              } catch { /* reload on next open */ }
            }} className="prefs-add-row">
              <input
                className="prefs-add-input"
                type="text"
                placeholder="Add a side..."
                value={addSideText}
                onChange={(e) => setAddSideText(e.target.value)}
              />
              <button className="btn primary" type="submit">+</button>
            </form>
          </AccordionSection>

          <AccordionSection title="Regulars" count={regulars?.length || 0}>
            <div className="prefs-section-hint">
              Items you consider buying every trip
            </div>
            {regulars && regulars.length > 0 && (
              <div className="prefs-list">
                {Object.keys(regularGroups).sort().map(group => (
                  <div key={group}>
                    <div className="prefs-list-group">{group}</div>
                    {regularGroups[group].map(r => (
                      <div key={r.id} className="prefs-list-item">
                        <span className="prefs-list-name">{r.name}</span>
                        <button className="prefs-move" title="Move to Pantry" onClick={() => handleMoveToPantry(r.id, r.name)}>{'\u2192 pantry'}</button>
                        <button className="prefs-remove" onClick={() => handleRemoveRegular(r.id)}>{'\u00D7'}</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="prefs-add-row">
              <AutocompleteInput
                value={addRegularText}
                onChange={setAddRegularText}
                onSubmit={async (name) => {
                  if (!name.trim()) return
                  await api.addRegular(name.trim())
                  setAddRegularText('')
                  const data = await api.getRegulars()
                  setRegulars(data.regulars)
                }}
                candidates={allIngredients || []}
                exclude={new Set((regulars || []).map(r => r.name.toLowerCase()))}
                placeholder="Add a regular..."
                inputClassName="prefs-add-input"
              />
              <button className="btn primary" onClick={() => {
                if (addRegularText.trim()) {
                  const name = addRegularText.trim()
                  api.addRegular(name).then(() => {
                    setAddRegularText('')
                    api.getRegulars().then(data => setRegulars(data.regulars))
                  })
                }
              }}>+</button>
            </div>
          </AccordionSection>

          <AccordionSection title="Pantry" count={pantry?.length || 0}>
            <div className="prefs-section-hint">
              Stuff you usually have — only buy when you're running low
            </div>
            {pantry && pantry.length > 0 && (
              <div className="prefs-list">
                {pantry.map(p => (
                  <div key={p.id} className="prefs-list-item">
                    <span className="prefs-list-name">{p.name}</span>
                    <button className="prefs-move" title="Move to Regulars" onClick={() => handleMoveToRegulars(p.name, p.id)}>{'\u2192 regular'}</button>
                    <button className="prefs-remove" onClick={() => handleRemovePantry(p.id)}>{'\u00D7'}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="prefs-add-row">
              <AutocompleteInput
                value={addPantryText}
                onChange={setAddPantryText}
                onSubmit={async (name) => {
                  if (!name.trim()) return
                  await api.addPantryItem(name.trim())
                  setAddPantryText('')
                  const data = await api.getPantry()
                  setPantry(data.items)
                }}
                candidates={allIngredients || []}
                exclude={new Set((pantry || []).map(p => p.name.toLowerCase()))}
                placeholder="Add a pantry item..."
                inputClassName="prefs-add-input"
              />
              <button className="btn primary" onClick={() => {
                if (addPantryText.trim()) {
                  const name = addPantryText.trim()
                  api.addPantryItem(name).then(() => {
                    setAddPantryText('')
                    api.getPantry().then(data => setPantry(data.items))
                  })
                }
              }}>+</button>
            </div>
          </AccordionSection>
        </AccordionSection>

        {/* Behind the Label */}
        <AccordionSection title="Behind the Label">
          <div className="prefs-list">
            <div className="prefs-list-item">
              <span className="prefs-list-name">NOVA processing scores</span>
              <span className="prefs-list-meta">On</span>
            </div>
            <div className="prefs-list-item">
              <span className="prefs-list-name">Brand ownership</span>
              <span className="prefs-list-meta">On</span>
            </div>
          </div>
        </AccordionSection>

        {/* Household & Sharing */}
        <AccordionSection title="Household" count={members?.length || 0}>
          {members && members.length > 0 && (
            <div className="prefs-list">
              {members.map(m => (
                <div key={m.user_id} className="prefs-list-item">
                  <span className="prefs-list-name">
                    {m.display_name}{m.is_you ? ' (you)' : ''}
                  </span>
                  <span className="prefs-list-meta">{m.role}</span>
                </div>
              ))}
            </div>
          )}
          <div className="prefs-section-hint">
            Invite someone to share meals and grocery lists.
          </div>
          <form onSubmit={handleHouseholdInvite} className="prefs-add-row">
            <input
              className="prefs-add-input"
              type="email"
              placeholder="Their email..."
              value={householdEmail}
              onChange={(e) => setHouseholdEmail(e.target.value)}
            />
            <button className="btn primary" type="submit">Invite</button>
          </form>
          {inviteStatus && (
            <div className={`prefs-invite-status ${inviteStatus.type}`}>
              {inviteStatus.msg}
            </div>
          )}
        </AccordionSection>

        {/* Invite a Friend */}
        <AccordionSection title="Invite a Friend">
          <div className="prefs-section-hint">
            Know someone who'd like souschef? Give them their own account.
          </div>
          <form onSubmit={handleBetaInvite} className="prefs-add-row">
            <input
              className="prefs-add-input"
              type="email"
              placeholder="Their email..."
              value={betaEmail}
              onChange={(e) => setBetaEmail(e.target.value)}
            />
            <button className="btn primary" type="submit">Send</button>
          </form>
          {betaInviteStatus && (
            <div className={`prefs-invite-status ${betaInviteStatus.type}`}>
              {betaInviteStatus.msg}
            </div>
          )}
        </AccordionSection>

        {/* About */}
        <div className="prefs-about">
          <div className="brand-name">sous<em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>chef</em></div>
          <div style={{ marginTop: '4px' }}>by Aletheia</div>
          <div className="prefs-version">v0.1.0</div>
        </div>
    </Sheet>
  )
}
