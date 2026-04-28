import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import FeedbackFab from './FeedbackFab'
import CameraCapture from './CameraCapture'
import ls from '../shared/lists.module.css'
import styles from './ReceiptPage.module.css'

const hasCamera = typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia

function formatPrice(price) {
  if (price == null) return ''
  return `$${price.toFixed(2)}`
}

// Enriched meta block for a reconciled row: brand/size, meal attribution,
// notes. Used by every row in matched/substituted/not-fulfilled/unresolved
// sections. Thumbnail is rendered alongside (not inside) so flex layout
// with the action button stays clean.
function ReceiptRowMeta({ item, receiptText }) {
  const brand = item.product_brand || ''
  const size = item.product_size || ''
  const forMeals = Array.isArray(item.for_meals) ? item.for_meals.filter(Boolean) : []
  const notes = item.notes || ''
  const price = item.receipt_price
  const hasBrandLine = brand || size
  return (
    <>
      {receiptText && (
        <div className={styles.receiptItemDetail}>
          from receipt: {receiptText}
        </div>
      )}
      {hasBrandLine && (
        <div className={styles.receiptItemBrand}>
          {brand}
          {brand && size ? ' ' : ''}
          {size}
        </div>
      )}
      {(price != null || forMeals.length > 0) && (
        <div className={styles.receiptItemMeta}>
          {price != null && <span>{formatPrice(price)}</span>}
          {price != null && forMeals.length > 0 && <span> · </span>}
          {forMeals.length > 0 && (
            <span className={styles.receiptItemMeals}>for {forMeals.join(', ')}</span>
          )}
        </div>
      )}
      {notes && (
        <div className={styles.receiptItemNotes}>{notes}</div>
      )}
    </>
  )
}

function PurchaseItem({ item, onRate }) {
  const desc = item.receipt_item || item.product_name || item.name
  const brand = item.product_brand || ''
  const price = item.receipt_price ?? item.product_price
  return (
    <div className={`${styles.receiptItem} ${styles.matched}`}>
      {item.product_image && (
        <img className={styles.receiptProductImg} src={item.product_image} alt="" />
      )}
      {!item.product_image && <div className={styles.receiptItemCheck}>{'\u2713'}</div>}
      <div className={styles.receiptItemInfo}>
        <div className={styles.receiptItemName}>{desc}</div>
        {desc !== item.name && (
          <div className={styles.receiptItemDetail}>{item.name}</div>
        )}
        <div className={styles.receiptItemMeta}>
          {brand && <span>{brand}</span>}
          {brand && item.product_size && <span> · </span>}
          {item.product_size && <span>{item.product_size}</span>}
          {price != null && <span> · {formatPrice(price)}</span>}
        </div>
      </div>
      <div className={styles.receiptRating}>
        <button
          className={`${styles.receiptRateBtn} ${styles.up}${item.rating === 1 ? ` ${styles.active}` : ''}`}
          onClick={() => onRate(item, item.rating === 1 ? 0 : 1)}
          title="Thumbs up"
        >{'\u{1F44D}'}</button>
        <button
          className={`${styles.receiptRateBtn} ${styles.down}${item.rating === -1 ? ` ${styles.active}` : ''}`}
          onClick={() => onRate(item, item.rating === -1 ? 0 : -1)}
          title="Thumbs down"
        >{'\u{1F44E}'}</button>
      </div>
    </div>
  )
}

export default function ReceiptPage() {
  const [receipt, setReceipt] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [showCamera, setShowCamera] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [purchases, setPurchases] = useState(null)
  // Track items the user has explicitly collapsed; default state is everything
  // expanded so users see what needs confirming without an extra tap.
  const [collapsedItems, setCollapsedItems] = useState(() => new Set())
  const [matchingExtra, setMatchingExtra] = useState(null) // extra item being matched to grocery
  const [expandedWeeks, setExpandedWeeks] = useState({})

  const loadReceipt = () => {
    api.getReceipt().then(setReceipt).catch(() => setLoadError(true))
  }

  useEffect(loadReceipt, [])

  const loadPurchases = () => {
    if (purchases !== null) return
    api.getPurchases().then(data => setPurchases(data.purchases || [])).catch(() => setPurchases([]))
  }

  const uploadFormData = async (formData) => {
    setUploading(true)
    setUploadResult(null)
    try {
      const res = await fetch('/api/receipt/upload-file', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const result = await res.json()
      setUploadResult(result)
      if (result.ok) { uploadJustFinished.current = true; loadReceipt() }
    } catch (err) {
      setUploadResult({ ok: false, error: err.message })
    }
    setUploading(false)
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    await uploadFormData(formData)
    e.target.value = ''
  }

  const handleCameraCapture = async (blob) => {
    setShowCamera(false)
    const formData = new FormData()
    formData.append('file', new File([blob], 'receipt.jpg', { type: 'image/jpeg' }))
    await uploadFormData(formData)
  }

  const handleConfirmMatch = async (id) => {
    try {
      await api.resolveReceiptItem(id, 'matched')
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleRejectMatch = async (id) => {
    try {
      await api.resolveReceiptItem(id, 'recover')
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleDismissExtra = async (name) => {
    try {
      await api.dismissExtra(name)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleMatchExtra = async (extraItem, groceryItem) => {
    try {
      await api.matchExtra(extraItem.item_name, groceryItem.id, extraItem.price, extraItem.upc)
      setMatchingExtra(null)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleRate = async (item, rating) => {
    const upc = item.receipt_upc || item.product_upc || item.upc || ''
    const desc = item.receipt_item || item.product_name || item.name || item.item_name
    const productKey = item.product_key || ''
    const brand = item.product_brand || item.brand || ''
    if (!upc && !productKey && !desc) return
    try {
      await api.rateProduct(upc, rating, desc, { brand, productKey })
      loadReceipt()
      if (purchases) {
        setPurchases(prev => prev.map(p =>
          (p.product_key === productKey || p.name === item.name)
            ? { ...p, rating }
            : p
        ))
      }
    } catch { /* ignore */ }
  }

  // After a fresh upload, clear any prior collapsed state so the new items
  // all show expanded by default (the user just uploaded — they should see
  // everything that needs confirming).
  const uploadJustFinished = useRef(false)
  useEffect(() => {
    if (uploadJustFinished.current && receipt) {
      setCollapsedItems(new Set())
      uploadJustFinished.current = false
    }
  }, [receipt])

  if (loadError) return <><div className="loading">Something went wrong loading receipts. Try refreshing.</div><FeedbackFab page="receipt" /></>
  if (!receipt) return <><div className="loading">Checking the tab...</div><FeedbackFab page="receipt" /></>

  // Items needing the user's attention on the receipt page: matched but
  // not yet acknowledged. The receipt page is the reconciliation step;
  // pre-checking via the grocery list (e.g. you grabbed it in-store) is
  // not the same as confirming the receipt's match — the user may want
  // to verify the parser got it right or rate the actual product. Once
  // they tap Confirm/Not-this/etc. the resolve endpoint sets
  // receipt_acknowledged=1 and the item leaves this queue.
  const unmatchedMatches = receipt.matched.filter(i => !i.receipt_acknowledged)
  const unackedSubstituted = receipt.substituted.filter(i => !i.receipt_acknowledged)
  const hasReconciled = receipt.matched.length > 0 || receipt.substituted.length > 0

  // Unreconciled grocery items (for "This is..." picker) — keep full
  // objects so we have the id available when matching an extra to one.
  const unreconciledGroceryItems = receipt.unresolved

  // Group purchases by week
  const purchasesByWeek = {}
  if (purchases) {
    for (const p of purchases) {
      const weekLabel = p.date ? getWeekLabel(p.date.slice(0, 10)) : 'Unknown'
      if (!purchasesByWeek[weekLabel]) purchasesByWeek[weekLabel] = []
      purchasesByWeek[weekLabel].push(p)
    }
  }

  const toggleExpand = (key) => {
    setCollapsedItems(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setMatchingExtra(null)
  }

  return (
    <>
      <div className="page-header">
        <h2 className="screen-heading">Receipt</h2>
        <div className="screen-sub">
          {unmatchedMatches.length > 0
            ? `${unmatchedMatches.length} to confirm`
            : (receipt.extras && receipt.extras.length > 0
                ? `${receipt.extras.length} extra to review`
                : 'Upload a receipt to reconcile')}
        </div>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className={styles.receiptUpload}>
        {!hasReconciled && (
          <>
            <h3 className={styles.receiptUploadHeading}>Got a receipt? Let's match it up.</h3>
            <p className={styles.receiptUploadSub}>We'll line up what you bought against your grocery list.</p>
          </>
        )}
        <div className={styles.receiptUploadButtons}>
          {hasCamera && (
            <button className={styles.receiptUploadBtn} onClick={() => setShowCamera(true)}>
              <span className={styles.receiptUploadIcon}>{'\u{1F4F7}'}</span>
              <span className={styles.receiptUploadLabel}>Take a photo</span>
              <span className={styles.receiptUploadHint}>Snap your receipt now</span>
            </button>
          )}
          <label className={styles.receiptUploadBtn}>
            <span className={styles.receiptUploadIcon}>{'\u{1F4C1}'}</span>
            <span className={styles.receiptUploadLabel}>Choose a file</span>
            <span className={styles.receiptUploadHint}>Photo or PDF from your device</span>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {uploading && (
          <div className={styles.receiptProcessing}>Reading the receipt...</div>
        )}
        {!uploading && uploadResult && !uploadResult.ok && (
          <div className="submit-error">{uploadResult.error}</div>
        )}
        {!uploading && uploadResult && uploadResult.ok && (
          <div className="submit-success">
            Found {uploadResult.matched + (uploadResult.extras || 0)} item{(uploadResult.matched + (uploadResult.extras || 0)) !== 1 ? 's' : ''} on the receipt
          </div>
        )}
      </div>

      <button
        className="past-toggle"
        onClick={() => { setShowPast(v => !v); if (!showPast) loadPurchases() }}
      >
        {showPast ? 'Hide' : 'View'} previous purchases
      </button>

      {showPast && (
        <div className={styles.pastPurchases}>
          {purchases === null ? (
            <div className="loading">Loading...</div>
          ) : purchases.length === 0 ? (
            <div className={ls.sectionHint}>No purchase history yet.</div>
          ) : (
            Object.entries(purchasesByWeek).map(([week, items]) => (
              <div key={week} className={styles.purchaseDateGroup}>
                <button
                  className={styles.purchaseDateLabel}
                  onClick={() => setExpandedWeeks(prev => ({ ...prev, [week]: !prev[week] }))}
                >
                  <span>{week} ({items.length})</span>
                  <span>{expandedWeeks[week] ? '\u25B4' : '\u25BE'}</span>
                </button>
                {expandedWeeks[week] && items.map((item, i) => (
                  <PurchaseItem key={`${item.name}-${i}`} item={item} onRate={handleRate} />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Matched items awaiting confirmation */}
      {unmatchedMatches.length > 0 && (
        <div className={styles.receiptSection}>
          <div className={styles.receiptSectionLabel}>Matched ({unmatchedMatches.length})</div>
          {unmatchedMatches.length > 0 && (
            <div className={styles.receiptHint}>Tap each item to confirm or reject the match.</div>
          )}
          {unmatchedMatches.map(item => {
            const key = `match-${item.id}`
            const isExpanded = !collapsedItems.has(key)
            const receiptText = item.receipt_item || item.product_name
            return (
              <div key={item.id} className={styles.receiptItemRow}>
                <div className={styles.receiptItemTop} onClick={() => toggleExpand(key)}>
                  {item.product_image && (
                    <img className={styles.receiptItemThumb} src={item.product_image} alt="" />
                  )}
                  <div className={styles.receiptItemInfo}>
                    <div className={styles.receiptItemName}>{item.name}</div>
                    <ReceiptRowMeta item={item} receiptText={receiptText} />
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && (
                  <div className={styles.receiptActionBar}>
                    <button className={`${styles.receiptActionBtn} ${styles.confirm}`} onClick={() => handleConfirmMatch(item.id)}>Confirm</button>
                    <button className={styles.receiptActionBtn} onClick={() => handleRejectMatch(item.id)}>Not this</button>
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}${item.rating === 1 ? ` ${styles.activeUp}` : ''}`}
                      onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}${item.rating === -1 ? ` ${styles.activeDown}` : ''}`}
                      onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                    >{'\u{1F44E}'}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Substituted items */}
      {unackedSubstituted.length > 0 && (
        <div className={styles.receiptSection}>
          <div className={styles.receiptSectionLabel}>Substituted ({unackedSubstituted.length})</div>
          {unackedSubstituted.map(item => {
            const key = `sub-${item.id}`
            const isExpanded = !collapsedItems.has(key)
            // For substituted rows the "primary label" is what arrived at
            // checkout (receipt_item) and the secondary is the original
            // grocery line. ReceiptRowMeta handles brand/size/meals/notes.
            const subSubText = `Ordered: ${item.name}`
            return (
              <div key={item.id} className={styles.receiptItemRow}>
                <div className={styles.receiptItemTop} onClick={() => toggleExpand(key)}>
                  {item.product_image && (
                    <img className={styles.receiptItemThumb} src={item.product_image} alt="" />
                  )}
                  <div className={styles.receiptItemInfo}>
                    <div className={styles.receiptItemName}>{item.receipt_item || item.name}</div>
                    <ReceiptRowMeta item={item} receiptText={subSubText} />
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && (
                  <div className={styles.receiptActionBar}>
                    <button className={`${styles.receiptActionBtn} ${styles.confirm}`} onClick={() => handleConfirmMatch(item.id)}>That's fine</button>
                    <button className={styles.receiptActionBtn} onClick={() => handleRejectMatch(item.id)}>Not this</button>
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}${item.rating === 1 ? ` ${styles.activeUp}` : ''}`}
                      onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}${item.rating === -1 ? ` ${styles.activeDown}` : ''}`}
                      onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                    >{'\u{1F44E}'}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Unmatched receipt items */}
      {receipt.extras && receipt.extras.length > 0 && (
        <div className={styles.receiptSection}>
          <div className={styles.receiptSectionLabel}>Unmatched ({receipt.extras.length})</div>
          {receipt.extras.map((item, i) => {
            const key = `extra-${item.item_name}-${i}`
            const isExpanded = !collapsedItems.has(key)
            const isMatching = matchingExtra === key
            return (
              <div key={key} className={styles.receiptItemRow}>
                <div className={styles.receiptItemTop} onClick={() => toggleExpand(key)}>
                  <div className={styles.receiptItemInfo}>
                    <div className={styles.receiptItemName}>{item.item_name}</div>
                    <div className={styles.receiptItemMeta}>
                      {item.brand && <span>{item.brand}</span>}
                      {item.brand && item.price != null && <span> · </span>}
                      {item.price != null && <span>{formatPrice(item.price)}</span>}
                    </div>
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && !isMatching && (
                  <div className={styles.receiptActionBar}>
                    {unreconciledGroceryItems.length > 0 && (
                      <button className={styles.receiptActionBtn} onClick={() => setMatchingExtra(key)}>This is...</button>
                    )}
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}`}
                      onClick={() => handleRate(item, 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className={`${styles.receiptActionBtn} ${styles.rate}`}
                      onClick={() => handleRate(item, -1)}
                    >{'\u{1F44E}'}</button>
                    <button className={`${styles.receiptActionBtn} ${styles.dismiss}`} onClick={() => handleDismissExtra(item.item_name)}>Dismiss</button>
                  </div>
                )}
                {isMatching && (
                  <div className={styles.receiptMatchPicker}>
                    <div className={styles.receiptMatchLabel}>Match to:</div>
                    {unreconciledGroceryItems.map(g => (
                      <button
                        key={g.id}
                        className={styles.receiptMatchOption}
                        onClick={() => handleMatchExtra(item, g)}
                      >
                        {g.name}
                      </button>
                    ))}
                    <button className={styles.receiptMatchCancel} onClick={() => setMatchingExtra(null)}>Cancel</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <FeedbackFab page="receipt" />
    </>
  )
}

function getWeekLabel(dateStr) {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d)
    monday.setDate(diff)
    return 'Week of ' + monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}
