import { useState, useEffect, useCallback } from 'react'
import styles from './TourOverlay.module.css'

function getStops() {
  const isWide = window.innerWidth >= 1024
  return [
    {
      selectors: isWide
        ? ['[data-tour="plan"]', '[data-tour="plan-content"]']
        : ['[data-tour="plan-tab"]'],
      label: 'Plan',
      desc: 'Your dinners for the week. ' + (isWide ? 'Click' : 'Tap') + ' a day to pick a meal.',
    },
    {
      selectors: isWide
        ? ['[data-tour="grocery-sidebar"]']
        : ['[data-tour="grocery-tab"]'],
      label: 'Grocery',
      desc: 'Key ingredients from your meals are added automatically. You can also add regulars, staples, or anything else at any time.',
    },
    {
      selectors: isWide ? ['[data-tour="order"]'] : ['[data-tour="order-tab"]'],
      label: 'Order',
      desc: 'Pick products from your store and send your cart.',
    },
    {
      selectors: isWide ? ['[data-tour="receipt"]'] : ['[data-tour="receipt-tab"]'],
      label: 'Receipt',
      desc: 'Upload your receipt to track what you bought.',
    },
    {
      selectors: ['[data-tour="kitchen"]'],
      label: 'Kitchen',
      desc: 'Your meals, sides, staples, and product ratings.',
    },
    {
      selectors: ['[data-tour="account"]'],
      label: 'Account',
      desc: 'Store connections, household sharing, and settings.',
    },
    {
      selectors: ['[data-tour="feedback"]'],
      label: 'Talk to the Manager',
      desc: 'Send feedback, report bugs, or request features.',
    },
  ]
}

function getRect(el) {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function cutoutPolygon(rects, pad = 6) {
  // Build a clip-path that covers everything EXCEPT the highlighted rects
  let path = '0% 0%, 0% 100%, 100% 100%, 100% 0%'
  for (const r of rects) {
    const l = r.left - pad, t = r.top - pad
    const ri = r.left + r.width + pad, b = r.top + r.height + pad
    path += `, ${l}px 0%, ${l}px ${t}px, ${ri}px ${t}px, ${ri}px ${b}px, ${l}px ${b}px, ${l}px 0%`
  }
  return `polygon(${path})`
}

export default function TourOverlay({ onComplete }) {
  const [step, setStep] = useState(0)
  const [rects, setRects] = useState([])
  const [stops, setStops] = useState(getStops)

  const updateRects = useCallback(() => {
    const stop = stops[step]
    if (!stop) return
    const found = []
    for (const sel of stop.selectors) {
      const el = document.querySelector(sel)
      if (el) found.push(getRect(el))
    }
    setRects(found)
  }, [step, stops])

  useEffect(() => {
    const handleResize = () => {
      setStops(getStops())
      updateRects()
    }
    updateRects()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [updateRects])

  // Skip stops whose target elements don't exist
  const advance = useCallback(() => {
    let next = step + 1
    while (next < stops.length) {
      const hasEl = stops[next].selectors.some(sel => document.querySelector(sel))
      if (hasEl) break
      next++
    }
    if (next >= stops.length) {
      onComplete()
    } else {
      setStep(next)
    }
  }, [step, stops, onComplete])

  const stop = stops[step]
  const isLast = step >= stops.length - 1

  // Position callout relative to the first rect
  const calloutStyle = {}
  if (rects.length > 0) {
    const primary = rects[0]
    const pad = 12
    const below = primary.top + primary.height + pad
    const above = primary.top - pad
    if (below + 140 < window.innerHeight) {
      calloutStyle.top = below
    } else {
      calloutStyle.bottom = window.innerHeight - above
    }
    const centerX = primary.left + primary.width / 2
    calloutStyle.left = Math.max(16, Math.min(centerX - 140, window.innerWidth - 296))
  }

  return (
    <div className={styles.overlay}>
      {rects.length > 0 && (
        <div
          className={styles.backdrop}
          style={{ clipPath: cutoutPolygon(rects) }}
          onClick={advance}
        />
      )}

      {rects.map((r, i) => (
        <div key={i} className={styles.spotlight} style={{
          top: r.top - 6,
          left: r.left - 6,
          width: r.width + 12,
          height: r.height + 12,
        }} />
      ))}

      {stop && (
        <div className={styles.callout} style={calloutStyle}>
          <div className={styles.calloutLabel}>{stop.label}</div>
          <div className={styles.calloutDesc}>{stop.desc}</div>
          <div className={styles.calloutActions}>
            {!isLast && (
              <button className={styles.skipBtn} onClick={onComplete}>Skip tour</button>
            )}
            <button className={styles.nextBtn} onClick={isLast ? onComplete : advance}>
              {isLast ? "Let's cook!" : 'Next'}
            </button>
          </div>
          <div className={styles.calloutDots}>
            {stops.map((_, i) => (
              <span key={i} className={`${styles.dot}${i === step ? ` ${styles.dotActive}` : ''}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
