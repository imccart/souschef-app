import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import styles from './MealPickerSheet.module.css'

const MAX_SIDES = 3

// Standalone side editor opened from the plan-row chips. Mirrors the side
// checklist in MealPickerSheet's picked state (tick rows + "Something else…"
// + single Done) so editing sides looks the same wherever you do it.
export default function SidePickerSheet({ date, mealName, onSelect, onClose }) {
  const [data, setData] = useState(null)
  const [selectedSides, setSelectedSides] = useState([])
  const [addingCustom, setAddingCustom] = useState(false)
  const [sideSearch, setSideSearch] = useState('')

  useEffect(() => {
    api.getSides(date).then(d => {
      if (d.fixed) { onClose(); return }
      setData(d)
      const current = (d.sides || []).filter(s => s.current).map(s => ({ id: s.id, name: s.name }))
      setSelectedSides(current)
    }).catch(() => setData({ sides: [] }))
  }, [date])

  if (!data) return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="loading">Checking the sides...</div>
    </Sheet>
  )

  const toggleSide = (side) => {
    setSelectedSides(prev => {
      const exists = prev.find(s => s.id === side.id)
      if (exists) return prev.filter(s => s.id !== side.id)
      if (prev.length >= MAX_SIDES) return prev
      return [...prev, { id: side.id, name: side.name, custom: side.custom }]
    })
  }

  const commitCustomSide = (raw) => {
    const n = (raw || '').trim()
    if (!n || selectedSides.length >= MAX_SIDES) { setSideSearch(''); setAddingCustom(false); return }
    const existing = (data.sides || []).find(s => s.name.toLowerCase() === n.toLowerCase())
    if (existing) {
      if (!selectedSides.find(s => s.id === existing.id))
        setSelectedSides(prev => [...prev, { id: existing.id, name: existing.name }])
    } else {
      setSelectedSides(prev => [...prev, { id: `custom-${n}`, name: n, custom: true }])
    }
    setSideSearch(''); setAddingCustom(false)
  }

  const confirm = () => {
    onSelect(selectedSides.map(s => ({ side_recipe_id: s.custom ? null : s.id, side_name: s.name })))
  }

  const customSelected = selectedSides.filter(s => s.custom)
  const sideOptions = [...(data.sides || []), ...customSelected]
  const selectedSideIds = new Set(selectedSides.map(s => s.id))
  const sideMatches = (addingCustom && sideSearch.trim())
    ? (data.sides || []).filter(s => s.name.toLowerCase().includes(sideSearch.trim().toLowerCase()) && !selectedSideIds.has(s.id))
    : []

  return (
    <Sheet onClose={onClose} className={styles.mealPickerSheet}>
      <div className="sheet-title">Sides</div>
      <div className="sheet-sub">{mealName}</div>

      <div className={styles.sideList}>
        {sideOptions.map(s => {
          const on = selectedSideIds.has(s.id)
          return (
            <button key={s.id} className={styles.sideRow} onClick={() => toggleSide(s)}>
              <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>{on ? '✓' : ''}</span>
              <span className={`${styles.sideName} ${on ? styles.sideNameOn : ''}`}>{s.name}</span>
            </button>
          )
        })}

        {addingCustom ? (
          <>
            <div className={`${styles.sideRow} ${styles.sideRowInput}`}>
              <span className={`${styles.tick} ${styles.tickDashed}`}>+</span>
              <input
                className={styles.customInline}
                type="text"
                placeholder="Side name…"
                value={sideSearch}
                autoFocus
                onChange={(e) => setSideSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (sideMatches.length === 1) toggleSide(sideMatches[0])
                    else commitCustomSide(sideSearch)
                    setSideSearch(''); setAddingCustom(false)
                  } else if (e.key === 'Escape') { setSideSearch(''); setAddingCustom(false) }
                }}
                onBlur={() => setTimeout(() => { setSideSearch(''); setAddingCustom(false) }, 150)}
              />
            </div>
            {sideMatches.map(s => (
              <button
                key={s.id}
                className={styles.sideRow}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { toggleSide(s); setSideSearch(''); setAddingCustom(false) }}
              >
                <span className={styles.suggestPrefix}>Already in your kitchen:</span>
                <span className={styles.sideName}>{s.name}</span>
              </button>
            ))}
            {sideSearch.trim() && (
              <button
                className={styles.sideRow}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitCustomSide(sideSearch)}
              >
                <span className={styles.somethingElseLabel}>Add "{sideSearch.trim()}" as a new side</span>
              </button>
            )}
          </>
        ) : selectedSides.length < MAX_SIDES ? (
          <button className={styles.sideRow} onClick={() => setAddingCustom(true)}>
            <span className={`${styles.tick} ${styles.tickDashed}`}>+</span>
            <span className={styles.somethingElseLabel}>Something else…</span>
          </button>
        ) : null}
      </div>

      <div className={styles.doneRow}>
        <button className="btn primary" onClick={confirm}>Done</button>
      </div>
    </Sheet>
  )
}
