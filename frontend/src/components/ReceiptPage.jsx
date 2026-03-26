import { useState, useEffect } from 'react'
import { api } from '../api/client'
import FeedbackFab from './FeedbackFab'
import CameraCapture from './CameraCapture'
import ls from '../shared/lists.module.css'

const hasCamera = typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia

function formatPrice(price) {
  if (price == null) return ''
  return `$${price.toFixed(2)}`
}

function PurchaseItem({ item, onRate }) {
  const desc = item.receipt_item || item.product_name || item.name
  const brand = item.product_brand || ''
  const price = item.receipt_price ?? item.product_price
  return (
    <div className="receipt-item matched">
      {item.product_image && (
        <img className="receipt-product-img" src={item.product_image} alt="" />
      )}
      {!item.product_image && <div className="receipt-item-check">{'\u2713'}</div>}
      <div className="receipt-item-info">
        <div className="receipt-item-name">{desc}</div>
        {desc !== item.name && (
          <div className="receipt-item-detail">{item.name}</div>
        )}
        <div className="receipt-item-meta">
          {brand && <span>{brand}</span>}
          {brand && item.product_size && <span> · </span>}
          {item.product_size && <span>{item.product_size}</span>}
          {price != null && <span> · {formatPrice(price)}</span>}
        </div>
      </div>
      <div className="receipt-rating">
        <button
          className={`receipt-rate-btn up${item.rating === 1 ? ' active' : ''}`}
          onClick={() => onRate(item, item.rating === 1 ? 0 : 1)}
          title="Thumbs up"
        >{'\u{1F44D}'}</button>
        <button
          className={`receipt-rate-btn down${item.rating === -1 ? ' active' : ''}`}
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
  const [expandedItem, setExpandedItem] = useState(null)
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
      if (result.ok) loadReceipt()
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

  const handleConfirmMatch = async (name) => {
    try {
      await api.resolveReceiptItem(name, 'matched')
      setExpandedItem(null)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleRejectMatch = async (name) => {
    try {
      await api.resolveReceiptItem(name, 'recover')
      setExpandedItem(null)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleDismissExtra = async (name) => {
    try {
      await api.dismissExtra(name)
      setExpandedItem(null)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleMatchExtra = async (extraItem, groceryName) => {
    try {
      await api.matchExtra(extraItem.item_name, groceryName, extraItem.price, extraItem.upc)
      setMatchingExtra(null)
      setExpandedItem(null)
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

  if (loadError) return <><div className="loading">Something went wrong loading receipts. Try refreshing.</div><FeedbackFab page="receipt" /></>
  if (!receipt) return <><div className="loading">Checking the tab...</div><FeedbackFab page="receipt" /></>

  const unmatchedMatches = receipt.matched.filter(i => !i.checked)
  const hasReconciled = receipt.matched.length > 0 || receipt.substituted.length > 0

  // Unreconciled grocery items (for "This is..." picker)
  const unreconciledGroceryNames = receipt.unresolved.map(i => i.name)

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
    setExpandedItem(expandedItem === key ? null : key)
    setMatchingExtra(null)
  }

  return (
    <>
      <div className="page-header">
        <h2 className="screen-heading">Receipt</h2>
        <div className="screen-sub">
          {hasReconciled
            ? `${receipt.matched.filter(i => i.checked).length} confirmed`
            : 'Upload a receipt to reconcile'}
        </div>
      </div>

      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="receipt-upload">
        <div className="receipt-upload-buttons">
          {hasCamera && (
            <button className="receipt-upload-btn" onClick={() => setShowCamera(true)}>
              Take photo
            </button>
          )}
          <label className="receipt-upload-btn secondary">
            Choose from library
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {uploading && (
          <div className="receipt-processing">Reading the receipt...</div>
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
        <div className="past-purchases">
          {purchases === null ? (
            <div className="loading">Loading...</div>
          ) : purchases.length === 0 ? (
            <div className={ls.sectionHint}>No purchase history yet.</div>
          ) : (
            Object.entries(purchasesByWeek).map(([week, items]) => (
              <div key={week} className="purchase-date-group">
                <button
                  className="purchase-date-label"
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
        <div className="receipt-section">
          <div className="receipt-section-label">Matched ({unmatchedMatches.length})</div>
          {unmatchedMatches.map(item => {
            const key = `match-${item.name}`
            const isExpanded = expandedItem === key
            return (
              <div key={item.name} className="receipt-item-row">
                <div className="receipt-item-top" onClick={() => toggleExpand(key)}>
                  <div className="receipt-item-info">
                    <div className="receipt-item-name">
                      {item.receipt_item || item.product_name || item.name}
                    </div>
                    {(item.receipt_item || item.product_name) && item.receipt_item !== item.name && (
                      <div className="receipt-item-detail">{'\u2192'} {item.name}</div>
                    )}
                    <div className="receipt-item-meta">
                      {item.product_brand && <span>{item.product_brand}</span>}
                      {item.receipt_price != null && <span> · {formatPrice(item.receipt_price)}</span>}
                    </div>
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && (
                  <div className="receipt-action-bar">
                    <button className="receipt-action-btn confirm" onClick={() => handleConfirmMatch(item.name)}>Confirm</button>
                    <button className="receipt-action-btn" onClick={() => handleRejectMatch(item.name)}>Not this</button>
                    <button
                      className={`receipt-action-btn rate${item.rating === 1 ? ' active-up' : ''}`}
                      onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className={`receipt-action-btn rate${item.rating === -1 ? ' active-down' : ''}`}
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
      {receipt.substituted.length > 0 && (
        <div className="receipt-section">
          <div className="receipt-section-label">Substituted ({receipt.substituted.length})</div>
          {receipt.substituted.map(item => {
            const key = `sub-${item.name}`
            const isExpanded = expandedItem === key
            return (
              <div key={item.name} className="receipt-item-row">
                <div className="receipt-item-top" onClick={() => toggleExpand(key)}>
                  <div className="receipt-item-info">
                    <div className="receipt-item-name">{item.receipt_item || item.name}</div>
                    <div className="receipt-item-detail">Ordered: {item.name}</div>
                    {item.receipt_price != null && (
                      <div className="receipt-item-meta">{formatPrice(item.receipt_price)}</div>
                    )}
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && (
                  <div className="receipt-action-bar">
                    <button className="receipt-action-btn confirm" onClick={() => handleConfirmMatch(item.name)}>That's fine</button>
                    <button className="receipt-action-btn" onClick={() => handleRejectMatch(item.name)}>Not this</button>
                    <button
                      className={`receipt-action-btn rate${item.rating === 1 ? ' active-up' : ''}`}
                      onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className={`receipt-action-btn rate${item.rating === -1 ? ' active-down' : ''}`}
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
        <div className="receipt-section">
          <div className="receipt-section-label">Unmatched ({receipt.extras.length})</div>
          {receipt.extras.map((item, i) => {
            const key = `extra-${item.item_name}-${i}`
            const isExpanded = expandedItem === key
            const isMatching = matchingExtra === key
            return (
              <div key={key} className="receipt-item-row">
                <div className="receipt-item-top" onClick={() => toggleExpand(key)}>
                  <div className="receipt-item-info">
                    <div className="receipt-item-name">{item.item_name}</div>
                    <div className="receipt-item-meta">
                      {item.brand && <span>{item.brand}</span>}
                      {item.brand && item.price != null && <span> · </span>}
                      {item.price != null && <span>{formatPrice(item.price)}</span>}
                    </div>
                  </div>
                  <button className="grocery-expand-btn">{'\u2630'}</button>
                </div>
                {isExpanded && !isMatching && (
                  <div className="receipt-action-bar">
                    {unreconciledGroceryNames.length > 0 && (
                      <button className="receipt-action-btn" onClick={() => setMatchingExtra(key)}>This is...</button>
                    )}
                    <button
                      className="receipt-action-btn rate"
                      onClick={() => handleRate(item, 1)}
                    >{'\u{1F44D}'}</button>
                    <button
                      className="receipt-action-btn rate"
                      onClick={() => handleRate(item, -1)}
                    >{'\u{1F44E}'}</button>
                    <button className="receipt-action-btn dismiss" onClick={() => handleDismissExtra(item.item_name)}>Dismiss</button>
                  </div>
                )}
                {isMatching && (
                  <div className="receipt-match-picker">
                    <div className="receipt-match-label">Match to:</div>
                    {unreconciledGroceryNames.map(name => (
                      <button
                        key={name}
                        className="receipt-match-option"
                        onClick={() => handleMatchExtra(item, name)}
                      >
                        {name}
                      </button>
                    ))}
                    <button className="receipt-match-cancel" onClick={() => setMatchingExtra(null)}>Cancel</button>
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
