import { useState, useRef, useEffect } from 'react'
import { fuzzyFilter } from '../utils/fuzzyMatch'

/**
 * Text input with fuzzy autocomplete dropdown.
 * Props:
 *   value        — controlled input value
 *   onChange      — called with new text value
 *   onSubmit      — called with final value (user presses Enter or picks suggestion)
 *   candidates    — array of all possible item names
 *   exclude       — Set of names to exclude from suggestions (already added items)
 *   placeholder   — input placeholder text
 *   className     — optional class on the wrapper
 *   inputClassName — optional class on the input element
 */
export default function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  candidates = [],
  exclude = new Set(),
  placeholder = '',
  className = '',
  inputClassName = '',
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [dropUp, setDropUp] = useState(false)
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)

  const matches = fuzzyFilter(value, candidates, { exclude })

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleChange = (e) => {
    onChange(e.target.value)
    setSelectedIndex(-1)
    setShowSuggestions(e.target.value.trim().length > 0)
  }

  const handleSelect = (name) => {
    onSubmit(name)
    setShowSuggestions(false)
    setSelectedIndex(-1)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < matches.length) {
        handleSelect(matches[selectedIndex])
      } else if (value.trim()) {
        onSubmit(value.trim())
        setShowSuggestions(false)
      }
      return
    }
    if (!showSuggestions || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  return (
    <div className={`autocomplete-wrap ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => {
          if (value.trim()) setShowSuggestions(true)
          // On mobile, scroll input into view above keyboard
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
              // Check if dropdown would be clipped below viewport
              const rect = inputRef.current.getBoundingClientRect()
              const spaceBelow = window.innerHeight - rect.bottom
              setDropUp(spaceBelow < 220)
            }
          }, 300)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />
      {showSuggestions && matches.length > 0 && (
        <div className={`autocomplete-dropdown${dropUp ? ' drop-up' : ''}`} ref={dropdownRef}>
          {matches.map((name, i) => (
            <div
              key={name}
              className={`autocomplete-item ${i === selectedIndex ? 'selected' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); handleSelect(name) }}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
