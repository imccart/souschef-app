import { useRef, useState, useCallback } from 'react'

/**
 * Horizontal swipe navigation between pages with drag-to-slide.
 * Returns touch handlers + a style object to attach to the main content area.
 */
export default function useSwipeNav(pages, currentPage, setPage) {
  const startX = useRef(null)
  const startY = useRef(null)
  const locked = useRef(null) // 'horizontal' | 'vertical' | null
  const [offsetX, setOffsetX] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  const idx = pages.indexOf(currentPage)

  const onTouchStart = useCallback((e) => {
    // Don't compete with swipeable elements (Walk the Aisles, grocery items)
    if (e.target.closest('[data-swipeable]')) {
      startX.current = null
      return
    }
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    locked.current = null
    setTransitioning(false)
  }, [])

  const onTouchMove = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    // Lock direction after 10px of movement
    if (locked.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
    }

    if (locked.current !== 'horizontal') return

    // Resist at edges (no page to go to)
    const i = pages.indexOf(currentPage)
    if ((dx > 0 && i === 0) || (dx < 0 && i === pages.length - 1)) {
      setOffsetX(dx * 0.2) // rubber band
    } else {
      setOffsetX(dx)
    }
  }, [pages, currentPage])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    startX.current = null
    startY.current = null

    if (locked.current !== 'horizontal') {
      setOffsetX(0)
      locked.current = null
      return
    }
    locked.current = null

    const i = pages.indexOf(currentPage)
    const threshold = 60
    const width = window.innerWidth

    if (dx < -threshold && i < pages.length - 1) {
      // Slide left to next page
      setTransitioning(true)
      setOffsetX(-width)
      setTimeout(() => {
        setPage(pages[i + 1])
        setOffsetX(0)
        setTransitioning(false)
      }, 200)
    } else if (dx > threshold && i > 0) {
      // Slide right to previous page
      setTransitioning(true)
      setOffsetX(width)
      setTimeout(() => {
        setPage(pages[i - 1])
        setOffsetX(0)
        setTransitioning(false)
      }, 200)
    } else {
      // Snap back
      setTransitioning(true)
      setOffsetX(0)
      setTimeout(() => setTransitioning(false), 200)
    }
  }, [pages, currentPage, setPage])

  const style = offsetX !== 0 || transitioning
    ? {
        transform: `translateX(${offsetX}px)`,
        transition: transitioning ? 'transform 0.2s ease-out' : 'none',
      }
    : undefined

  return { onTouchStart, onTouchMove, onTouchEnd, style }
}
