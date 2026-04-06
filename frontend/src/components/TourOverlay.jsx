import { useState, useEffect, useCallback } from 'react'
import styles from './TourOverlay.module.css'

function getStops() {
  const isWide = window.innerWidth >= 1024
  return [
    {
      selector: isWide ? '[data-tour="plan"]' : '[data-tour="plan-tab"]',
      label: 'Plan',
      desc: 'Your dinners for the week. ' + (isWide ? 'Click' : 'Tap') + ' a day to pick a meal.',
    },
    {
      selector: isWide ? '[data-tour="grocery-sidebar"]' : '[data-tour="grocery-tab"]',
      label: 'Grocery',
      desc: isWide
        ? 'Always visible alongside your plan, organized by aisle.'
        : 'Everything you need to buy, organized by aisle.',
    },
    {
      selector: isWide ? '[data-tour="order"]' : '[data-tour="order-tab"]',
      label: 'Order',
      desc: 'Pick products from your store and send your cart.',
    },
    {
      selector: isWide ? '[data-tour="receipt"]' : '[data-tour="receipt-tab"]',
      label: 'Receipt',
      desc: 'Upload your receipt to track what you bought.',
    },
    {
      selector: '[data-tour="kitchen"]',
      label: 'Kitchen',
      desc: 'Your meals, sides, staples, and product ratings.',
    },
    {
      selector: '[data-tour="account"]',
      label: 'Account',
      desc: 'Store connections, household sharing, and settings.',
    },
    {
      selector: '[data-tour="feedback"]',
      label: 'Talk to the Manager',
      desc: 'Send feedback, report bugs, or request features.',
    },
  ]
}

export default function TourOverlay({ onComplete }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const [stops, setStops] = useState(getStops)

  const updateRect = useCallback(() => {
    const stop = stops[step]
    if (!stop) return
    const el = document.querySelector(stop.selector)
    if (el) {
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    } else {
      setRect(null)
    }
  }, [step, stops])

  useEffect(() => {
    // Recalculate stops on resize (desktop/mobile may change)
    const handleResize = () => {
      setStops(getStops())
      updateRect()
    }
    updateRect()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [updateRect])

  // Skip stops whose target element doesn't exist
  const advance = useCallback(() => {
    let next = step + 1
    while (next < stops.length) {
      const el = document.querySelector(stops[next].selector)
      if (el) break
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

  // Position callout below or above the target
  const calloutStyle = {}
  if (rect) {
    const pad = 12
    const below = rect.top + rect.height + pad
    const above = rect.top - pad
    if (below + 140 < window.innerHeight) {
      calloutStyle.top = below
    } else {
      calloutStyle.bottom = window.innerHeight - above
    }
    const centerX = rect.left + rect.width / 2
    calloutStyle.left = Math.max(16, Math.min(centerX - 140, window.innerWidth - 296))
  }

  return (
    <div className={styles.overlay}>
      {rect && (
        <div
          className={styles.backdrop}
          style={{
            clipPath: `polygon(
              0% 0%, 0% 100%, 100% 100%, 100% 0%,
              ${rect.left - 6}px 0%,
              ${rect.left - 6}px ${rect.top - 6}px,
              ${rect.left + rect.width + 6}px ${rect.top - 6}px,
              ${rect.left + rect.width + 6}px ${rect.top + rect.height + 6}px,
              ${rect.left - 6}px ${rect.top + rect.height + 6}px,
              ${rect.left - 6}px 0%
            )`,
          }}
          onClick={advance}
        />
      )}

      {rect && (
        <div className={styles.spotlight} style={{
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }} />
      )}

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
