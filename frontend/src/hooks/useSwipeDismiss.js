import { useRef, useCallback } from 'react'

/**
 * Returns touch event handlers for a bottom sheet element.
 * Swipe down past threshold dismisses the sheet via onClose.
 * Also applies a visual translateY while dragging.
 *
 * Won't initiate dismiss if touch starts inside a scrollable element
 * that isn't scrolled to top — prevents accidental dismiss during scroll.
 */
export default function useSwipeDismiss(onClose, threshold = 80) {
  const startY = useRef(null)
  const sheetEl = useRef(null)

  const onTouchStart = useCallback((e) => {
    // Walk up from the touch target to see if we're inside a scrollable container
    let el = e.target
    const sheet = e.currentTarget
    while (el && el !== sheet) {
      if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
        // Inside a scrollable area that isn't at top — don't track swipe
        startY.current = null
        return
      }
      el = el.parentElement
    }
    startY.current = e.touches[0].clientY
    sheetEl.current = sheet
  }, [])

  const onTouchMove = useCallback((e) => {
    if (startY.current === null) return
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0 && sheetEl.current) {
      sheetEl.current.style.transform = `translateY(${dy}px)`
      sheetEl.current.style.transition = 'none'
    }
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startY.current === null) return
    const dy = e.changedTouches[0].clientY - startY.current
    if (sheetEl.current) {
      sheetEl.current.style.transition = 'transform 0.2s ease-out'
      sheetEl.current.style.transform = ''
    }
    if (dy > threshold) {
      onClose()
    }
    startY.current = null
    sheetEl.current = null
  }, [onClose, threshold])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
