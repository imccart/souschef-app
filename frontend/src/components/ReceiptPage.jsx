import { useState, useEffect } from 'react'
import { api } from '../api/client'
import FeedbackFab from './FeedbackFab'
import CameraCapture from './CameraCapture'

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

  const loadReceipt = () => {
    api.getReceipt().then(setReceipt).catch(() => setLoadError(true))
  }

  useEffect(loadReceipt, [])

  const loadPurchases = () => {
    if (purchases !== null) return // already loaded
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
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleRejectMatch = async (name) => {
    try {
      // Put back as unresolved by clearing receipt status
      await api.resolveReceiptItem(name, 'recover')
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleResolve = async (name, status) => {
    try {
      await api.resolveReceiptItem(name, status)
      loadReceipt()
    } catch { /* ignore */ }
  }

  const handleRate = async (item, rating) => {
    const upc = item.receipt_upc || item.product_upc || item.upc || ''
    const desc = item.receipt_item || item.product_name || item.name
    const productKey = item.product_key || ''
    const brand = item.product_brand || item.brand || ''
    if (!upc && !productKey && !desc) return
    try {
      await api.rateProduct(upc, rating, desc, { brand, productKey })
      loadReceipt()
      // Also update purchases cache if loaded
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

  const hasReconciled = receipt.matched.length > 0 || receipt.substituted.length > 0
  const hasUnresolved = receipt.unresolved.length > 0

  // Group purchases by date for the past purchases view
  const purchasesByDate = {}
  if (purchases) {
    for (const p of purchases) {
      const d = p.date ? p.date.slice(0, 10) : 'Unknown'
      if (!purchasesByDate[d]) purchasesByDate[d] = []
      purchasesByDate[d].push(p)
    }
  }

  return (
    <>
      <div className="page-header">
        <h2 className="screen-heading">Receipt</h2>
        <div className="screen-sub">
          {hasReconciled
            ? `${receipt.matched.length + receipt.substituted.length} confirmed`
            : 'Upload a receipt to reconcile'}
        </div>
      </div>

      {/* Camera overlay */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Upload section */}
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
            <div className="prefs-section-hint">No purchase history yet.</div>
          ) : (
            Object.entries(purchasesByDate).map(([date, items]) => (
              <div key={date} className="purchase-date-group">
                <div className="purchase-date-label">{formatDate(date)}</div>
                {items.map((item, i) => (
                  <PurchaseItem key={`${item.name}-${i}`} item={item} onRate={handleRate} />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Matches awaiting confirmation */}
      {receipt.matched.length > 0 && receipt.matched.some(i => !i.checked) && (
        <div className="receipt-section">
          <div className="receipt-section-label">Confirm these matches</div>
          {receipt.matched.filter(i => !i.checked).map(item => (
            <div key={item.name} className="receipt-item match-confirm">
              {item.product_image && (
                <img className="receipt-product-img" src={item.product_image} alt="" />
              )}
              <div className="receipt-item-info">
                <div className="receipt-item-name">
                  {item.receipt_item || item.product_name || item.name}
                </div>
                {(item.receipt_item || item.product_name) && item.receipt_item !== item.name && (
                  <div className="receipt-item-detail">{item.name}</div>
                )}
                <div className="receipt-item-meta">
                  {item.product_brand && <span>{item.product_brand}</span>}
                  {item.product_brand && item.product_size && <span> · </span>}
                  {item.product_size && <span>{item.product_size}</span>}
                  {item.receipt_price != null && <span> · {formatPrice(item.receipt_price)}</span>}
                </div>
              </div>
              <div className="receipt-confirm-actions">
                <button className="receipt-confirm-btn" onClick={() => handleConfirmMatch(item.name)}>
                  {'\u2713'} Confirm
                </button>
                <button className="receipt-reject-btn" onClick={() => handleRejectMatch(item.name)}>
                  Not this
                </button>
              </div>
              <div className="receipt-rating">
                <button
                  className={`receipt-rate-btn up${item.rating === 1 ? ' active' : ''}`}
                  onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                >{'\u{1F44D}'}</button>
                <button
                  className={`receipt-rate-btn down${item.rating === -1 ? ' active' : ''}`}
                  onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                >{'\u{1F44E}'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Already confirmed matches */}
      {receipt.matched.some(i => i.checked) && (
        <div className="receipt-section">
          <div className="receipt-section-label">Confirmed ({receipt.matched.filter(i => i.checked).length})</div>
          {receipt.matched.filter(i => i.checked).map(item => (
            <PurchaseItem key={item.name} item={item} onRate={handleRate} />
          ))}
        </div>
      )}

      {/* Substituted items */}
      {receipt.substituted.length > 0 && (
        <div className="receipt-section">
          <div className="receipt-section-label">Substituted ({receipt.substituted.length})</div>
          {receipt.substituted.map(item => (
            <div key={item.name} className="receipt-item substituted">
              {item.product_image && (
                <img className="receipt-product-img" src={item.product_image} alt="" />
              )}
              <div className="receipt-item-info">
                <div className="receipt-item-name">{item.name}</div>
                {item.receipt_item && (
                  <div className="receipt-item-detail">
                    Received: {item.receipt_item}
                    {item.receipt_price != null && ` · ${formatPrice(item.receipt_price)}`}
                  </div>
                )}
              </div>
              <div className="receipt-confirm-actions">
                <button className="receipt-confirm-btn" onClick={() => handleConfirmMatch(item.name)}>
                  That's fine
                </button>
                <button className="receipt-reject-btn" onClick={() => handleResolve(item.name, 'not_fulfilled')}>
                  Note it
                </button>
              </div>
              <div className="receipt-rating">
                <button
                  className={`receipt-rate-btn up${item.rating === 1 ? ' active' : ''}`}
                  onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                >{'\u{1F44D}'}</button>
                <button
                  className={`receipt-rate-btn down${item.rating === -1 ? ' active' : ''}`}
                  onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                >{'\u{1F44E}'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Not on receipt — items still on your list */}
      {receipt.not_fulfilled.length > 0 && (
        <div className="receipt-section">
          <div className="receipt-section-label">Not on receipt ({receipt.not_fulfilled.length})</div>
          <div className="receipt-section-hint">These stay on your grocery list.</div>
          {receipt.not_fulfilled.map(item => (
            <div key={item.name} className="receipt-item not-fulfilled">
              <div className="receipt-item-info">
                <div className="receipt-item-name">{item.name}</div>
              </div>
              <div className="receipt-confirm-actions">
                <button className="receipt-confirm-btn" onClick={() => handleConfirmMatch(item.name)}>
                  Actually got it
                </button>
                <button className="receipt-reject-btn" onClick={() => handleResolve(item.name, 'dismissed')}>
                  Don't need it
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Extra items — on receipt but not on list */}
      {receipt.extras && receipt.extras.length > 0 && (
        <div className="receipt-section">
          <div className="receipt-section-label">Also on receipt ({receipt.extras.length})</div>
          <div className="receipt-section-hint">Items not on your list.</div>
          {receipt.extras.map((item, i) => (
            <div key={i} className="receipt-item extra">
              <div className="receipt-item-info">
                <div className="receipt-item-name">{item.item_name}</div>
                <div className="receipt-item-meta">
                  {item.brand && <span>{item.brand}</span>}
                  {item.brand && item.price != null && <span> · </span>}
                  {item.price != null && <span>{formatPrice(item.price)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Awaiting receipt — unchecked items with no receipt match yet */}
      {hasUnresolved && !hasReconciled && (
        <div className="receipt-section">
          <div className="receipt-section-label">
            On your list ({receipt.unresolved.length})
          </div>
          <div className="receipt-section-hint">Upload a receipt to match these.</div>
          {receipt.unresolved.map(item => (
            <div key={item.name} className="receipt-item unresolved">
              <div className="receipt-item-name">{item.name}</div>
            </div>
          ))}
        </div>
      )}

      <FeedbackFab page="receipt" />
    </>
  )
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown date'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}
