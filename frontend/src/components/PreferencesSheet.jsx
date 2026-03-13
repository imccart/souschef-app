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

function RecipeItem({ recipe, onRemove, allIngredients }) {
  const [expanded, setExpanded] = useState(false)
  const [ingredients, setIngredients] = useState(null)
  const [addText, setAddText] = useState('')

  const loadIngredients = async () => {
    const data = await api.getRecipeIngredients(recipe.id)
    setIngredients(data.ingredients)
  }

  const handleToggle = () => {
    if (!expanded && ingredients === null) loadIngredients()
    setExpanded(!expanded)
  }

  const handleAdd = async (name) => {
    if (!name.trim()) return
    await api.addRecipeIngredient(recipe.id, name.trim())
    setAddText('')
    loadIngredients()
  }

  const handleRemoveIngredient = async (riId) => {
    await api.removeRecipeIngredient(recipe.id, riId)
    loadIngredients()
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
  const [stores, setStores] = useState(null)
  const [recipes, setRecipes] = useState(null)
  const [allIngredients, setAllIngredients] = useState(null)
  const [addRegularText, setAddRegularText] = useState('')
  const [addPantryText, setAddPantryText] = useState('')
  const [addStoreName, setAddStoreName] = useState('')
  const [addStoreMode, setAddStoreMode] = useState('in-person')
  const [addRecipeText, setAddRecipeText] = useState('')
  const [members, setMembers] = useState(null)
  const [householdEmail, setHouseholdEmail] = useState('')
  const [betaEmail, setBetaEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState(null)
  useEffect(() => {
    api.getRegulars().then(data => setRegulars(data.regulars))
    api.getPantry().then(data => setPantry(data.items))
    api.getStores().then(data => setStores(data.stores))
    api.getRecipes().then(data => setRecipes(data.recipes))
    api.getGrocerySuggestions().then(data => setAllIngredients(data.suggestions)).catch(() => {})
    api.getHouseholdMembers().then(data => setMembers(data.members)).catch(() => {})
  }, [])

  const handleRemoveRegular = async (name) => {
    await api.removeRegular(name)
    const data = await api.getRegulars()
    setRegulars(data.regulars)
  }

  const handleRemovePantry = async (id) => {
    await api.removePantryItem(id)
    const data = await api.getPantry()
    setPantry(data.items)
  }

  const handleMoveToPantry = async (name) => {
    await api.removeRegular(name)
    await api.addPantryItem(name)
    const [rData, pData] = await Promise.all([api.getRegulars(), api.getPantry()])
    setRegulars(rData.regulars)
    setPantry(pData.items)
  }

  const handleMoveToRegulars = async (name, id) => {
    await api.removePantryItem(id)
    await api.addRegular(name)
    const [rData, pData] = await Promise.all([api.getRegulars(), api.getPantry()])
    setRegulars(rData.regulars)
    setPantry(pData.items)
  }

  const handleAddStore = async (e) => {
    e.preventDefault()
    if (!addStoreName.trim()) return
    const name = addStoreName.trim()
    // Generate unique key
    let key = name[0].toLowerCase()
    if (stores && stores.some(s => s.key === key)) {
      key = name.slice(0, 2).toLowerCase()
    }
    const result = await api.addStore(name, key, addStoreMode)
    if (result.ok) {
      setAddStoreName('')
      const data = await api.getStores()
      setStores(data.stores)
    }
  }

  const handleRemoveStore = async (key) => {
    await api.removeStore(key)
    const data = await api.getStores()
    setStores(data.stores)
  }

  const handleAddRecipe = async (e) => {
    e.preventDefault()
    if (!addRecipeText.trim()) return
    await api.addRecipe(addRecipeText.trim())
    setAddRecipeText('')
    const data = await api.getRecipes()
    setRecipes(data.recipes)
  }

  const handleRemoveRecipe = async (id) => {
    const result = await api.deleteRecipe(id)
    if (!result.ok) {
      alert(result.error || 'Cannot remove this recipe')
      return
    }
    const data = await api.getRecipes()
    setRecipes(data.recipes)
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
    setInviteStatus(null)
    try {
      const result = await api.inviteToBeta(betaEmail.trim())
      if (result.ok) {
        setBetaEmail('')
        setInviteStatus({ type: 'success', msg: 'Invite sent!' })
      } else {
        setInviteStatus({ type: 'error', msg: result.error || 'Failed to send' })
      }
    } catch {
      setInviteStatus({ type: 'error', msg: 'Something went wrong' })
    }
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

  return (
    <Sheet onClose={onClose} className="prefs-sheet">
        <div className="sheet-title">Preferences</div>
        <div className="sheet-sub">Configurable any time</div>

        {/* Stores */}
        <AccordionSection title="Stores" count={stores?.length || 0} defaultOpen>
          {stores && stores.length > 0 && (
            <div className="prefs-list">
              {stores.map(s => (
                <div key={s.key} className="prefs-list-item">
                  <span className="prefs-list-name">{s.name}</span>
                  <span className="prefs-list-meta">{s.mode}</span>
                  <button className="prefs-remove" onClick={() => handleRemoveStore(s.key)}>{'\u00D7'}</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddStore} className="prefs-add-row">
            <input
              className="prefs-add-input"
              type="text"
              placeholder="Store name..."
              value={addStoreName}
              onChange={(e) => setAddStoreName(e.target.value)}
            />
            <select
              className="prefs-add-select"
              value={addStoreMode}
              onChange={(e) => setAddStoreMode(e.target.value)}
            >
              <option value="in-person">In-person</option>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
            </select>
            <button className="btn primary" type="submit">+</button>
          </form>
        </AccordionSection>

        {/* Recipes */}
        <AccordionSection title="Meals" count={recipes?.length || 0}>
          <div className="prefs-section-hint">
            Your meal rotation. Add meals you make regularly.
          </div>
          {recipes && recipes.length > 0 && (
            <div className="prefs-list">
              {recipes.map(r => (
                <RecipeItem key={r.id} recipe={r} onRemove={handleRemoveRecipe} allIngredients={allIngredients} />
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

        {/* Regulars */}
        <AccordionSection
          title="Regulars"
          count={regulars?.length || 0}
        >
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
                      <button className="prefs-move" title="Move to Pantry" onClick={() => handleMoveToPantry(r.name)}>{'\u2192 pantry'}</button>
                      <button className="prefs-remove" onClick={() => handleRemoveRegular(r.name)}>{'\u00D7'}</button>
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

        {/* Pantry */}
        <AccordionSection
          title="Pantry"
          count={pantry?.length || 0}
        >
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

        {/* Transparency */}
        <AccordionSection title="Transparency">
          <div className="prefs-list">
            <div className="prefs-list-item">
              <span className="prefs-list-name">NOVA processing scores</span>
              <span className="prefs-list-meta">On</span>
            </div>
            <div className="prefs-list-item">
              <span className="prefs-list-name">Brand ownership</span>
              <span className="prefs-list-meta">Coming soon</span>
            </div>
          </div>
        </AccordionSection>

        {/* Integrations */}
        <AccordionSection title="Integrations">
          <div className="prefs-list">
            <div className="prefs-list-item">
              <span className="prefs-list-name">Kroger</span>
              <span className="prefs-list-meta">Configure via CLI</span>
            </div>
            <div className="prefs-list-item">
              <span className="prefs-list-name">Google Sheets</span>
              <span className="prefs-list-meta">Configure via CLI</span>
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
            Invite someone to share your meal plan, grocery list, and pantry.
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

          <div className="prefs-section-hint" style={{ marginTop: 16 }}>
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

          {inviteStatus && (
            <div className={`prefs-invite-status ${inviteStatus.type}`}>
              {inviteStatus.msg}
            </div>
          )}
        </AccordionSection>

        {/* Account */}
        <AccordionSection title="Account">
          <button className="prefs-logout" onClick={async () => {
            await api.logout()
            localStorage.removeItem('souschef_onboarded')
            localStorage.removeItem('souschef_welcomed')
            window.location.reload()
          }}>
            Sign out
          </button>
        </AccordionSection>

        {/* About */}
        <div className="prefs-about">
          <div className="brand-name">sous<em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>chef</em></div>
          <div style={{ marginTop: '4px' }}>by Aletheia</div>
        </div>
    </Sheet>
  )
}
