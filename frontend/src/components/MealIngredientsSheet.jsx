import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import AutocompleteInput from './AutocompleteInput'
import ls from '../shared/lists.module.css'

function IngredientSection({ title, recipeId, allIngredients }) {
  const [ingredients, setIngredients] = useState(null)
  const [addText, setAddText] = useState('')
  const [renamed, setRenamed] = useState(null)

  useEffect(() => {
    if (recipeId) {
      api.getRecipeIngredients(recipeId)
        .then(data => setIngredients(data.ingredients))
        .catch(() => setIngredients([]))
    }
  }, [recipeId])

  if (!recipeId) return null

  const handleAdd = async (name) => {
    if (!name.trim()) return
    try {
      const result = await api.addRecipeIngredient(recipeId, name.trim())
      setAddText('')
      if (result.renamed_from) {
        setRenamed({ from: result.renamed_from, to: result.name })
        setTimeout(() => setRenamed(null), 4000)
      }
      const data = await api.getRecipeIngredients(recipeId)
      setIngredients(data.ingredients)
    } catch { /* ignore */ }
  }

  const handleRemove = async (riId) => {
    try {
      await api.removeRecipeIngredient(recipeId, riId)
      const data = await api.getRecipeIngredients(recipeId)
      setIngredients(data.ingredients)
    } catch { /* ignore */ }
  }

  const existingNames = new Set((ingredients || []).map(i => i.name.toLowerCase()))

  return (
    <div className="meal-ing-section">
      <div className="meal-ing-title">{title}</div>
      {ingredients === null ? (
        <div className="meal-ing-loading">Loading...</div>
      ) : (
        <>
          {ingredients.length > 0 ? (
            <div className="meal-ing-list">
              {ingredients.map(ing => (
                <div key={ing.id} className="meal-ing-item">
                  <span>{ing.name}</span>
                  <button className={ls.remove} onClick={() => handleRemove(ing.id)}>{'\u00D7'}</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="meal-ing-empty">No ingredients yet</div>
          )}
          <div className={ls.addRow}>
            <AutocompleteInput
              value={addText}
              onChange={setAddText}
              onSubmit={handleAdd}
              candidates={allIngredients || []}
              exclude={existingNames}
              placeholder="Add ingredient..."
              inputClassName={ls.addInput}
            />
            <button className="btn primary" onClick={() => addText.trim() && handleAdd(addText)}>+</button>
          </div>
          {renamed && <div className={ls.renamedHint}>"{renamed.from}" added as "{renamed.to}"</div>}
        </>
      )}
    </div>
  )
}

export default function MealIngredientsSheet({ meal, onClose }) {
  const [allIngredients, setAllIngredients] = useState(null)

  useEffect(() => {
    api.getGrocerySuggestions()
      .then(data => setAllIngredients(data.suggestions))
      .catch(() => {})
  }, [])

  return (
    <Sheet onClose={onClose} className="meal-ingredients-sheet">
      <div className="sheet-title">Ingredients</div>
      <div className="sheet-sub">{meal.recipe_name}{meal.sides?.length > 0 ? ` + ${meal.sides.map(s => s.name).join(', ')}` : ''}</div>

      <IngredientSection
        title={meal.recipe_name}
        recipeId={meal.recipe_id}
        allIngredients={allIngredients}
      />

      {meal.sides?.map((side, idx) => (
        side.side_recipe_id && (
          <IngredientSection
            key={`${side.side_recipe_id}-${idx}`}
            title={side.name}
            recipeId={side.side_recipe_id}
            allIngredients={allIngredients}
          />
        )
      ))}
    </Sheet>
  )
}
