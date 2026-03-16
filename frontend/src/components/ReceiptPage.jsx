import { useState, useEffect } from 'react'
import { api } from '../api/client'
import FeedbackFab from './FeedbackFab'

export default function ReceiptPage() {
  const [receipt, setReceipt] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [collapsedSections, setCollapsedSections] = useState({})

  const toggleSection = (key) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const [loadError, setLoadError] = useState(false)

  const loadReceipt = () => {
    api.getReceipt().then(setReceipt).catch(() => setLoadError(true))
  }

  useEffect(loadReceipt, [])

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadResult(null)

    const formData = new FormData()
    formData.append('file', file)

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
    e.target.value = '' // reset file input
  }

  const handleResolve = async (name, status) => {
    try {
      await api.resolveReceiptItem(name, status)
      loadReceipt()
    } catch { /* ignore — item stays in current state */ }
  }

  const handleRate = async (item, rating) => {
    const upc = item.receipt_upc || item.product_upc
    if (!upc) return
    const desc = item.receipt_item || item.product_name || item.name
    try {
      await api.rateProduct(upc, rating, desc)
      loadReceipt()
    } catch { /* ignore */ }
  }

  if (loadError) return <><div className="loading">Something went wrong loading receipts. Try refreshing.</div><FeedbackFab page="receipt" /></>
  if (!receipt) return <><div className="loading">Checking the tab...</div><FeedbackFab page="receipt" /></>

  if (!receipt.has_trip) {
    return (
      <>
        <div className="page-header">
          <h2 className="screen-heading">Receipt</h2>
          <div className="screen-sub">Reconcile what was purchased</div>
        </div>
        <div className="empty-state">
          <div className="icon">{'\u{1F9FE}'}</div>
          <p>No active trip to reconcile. Build a list and start shopping first.</p>
        </div>
      </>
    )
  }

  const hasAnyActivity = receipt.has_ordered || receipt.has_checked
  const hasReconciled = receipt.matched.length > 0 || receipt.substituted.length > 0 || receipt.not_fulfilled.length > 0
  const canUploadMore = receipt.unresolved.length > 0 || receipt.not_fulfilled.length > 0

  return (
    <>
      <div className="page-header">
        <h2 className="screen-heading">Receipt</h2>
        <div className="screen-sub">
          {hasReconciled
            ? `${receipt.matched.length} matched, ${receipt.substituted.length} substituted, ${receipt.not_fulfilled.length} not fulfilled`
            : 'Reconcile what was purchased'}
        </div>
      </div>

      {/* Upload section — show when items still need a receipt */}
      {hasAnyActivity && canUploadMore && (
        <div className="receipt-upload">
          <label className="receipt-upload-btn">
            {receipt.has_receipt ? 'Upload another receipt' : 'Upload receipt'}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>

          {uploading && (
            <div className="receipt-processing">Reading the receipt...</div>
          )}
          {!uploading && uploadResult && !uploadResult.ok && (
            <div className="submit-error">{uploadResult.error}</div>
          )}
          {!uploading && uploadResult && uploadResult.ok && (
            <div className="submit-success">
              Matched {uploadResult.matched} item{uploadResult.matched !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Unresolved items — still need receipt */}
      {receipt.unresolved.length > 0 && (
        <div className="receipt-section">
          <div className="receipt-section-label">
            Awaiting receipt ({receipt.unresolved.length} item{receipt.unresolved.length !== 1 ? 's' : ''})
          </div>
          {receipt.unresolved.map(item => (
            <div key={item.name} className="receipt-item unresolved">
              <div className="receipt-item-name">{item.name}</div>
              <div className="receipt-item-meta">
                {item.ordered ? 'Ordered' : 'Checked off'}
                {item.product_price && ` \u00B7 ${formatPrice(item.product_price)}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Matched items */}
      {receipt.matched.length > 0 && (
        <div className="receipt-section">
          <div
            className="receipt-section-label matched-label collapsible"
            onClick={() => toggleSection('matched')}
          >
            <span>{collapsedSections.matched ? '\u25B6' : '\u25BC'} Matched ({receipt.matched.length})</span>
          </div>
          {!collapsedSections.matched && receipt.matched.map(item => (
            <div key={item.name} className="receipt-item matched">
              {item.product_image && (
                <img className="receipt-product-img" src={item.product_image} alt="" />
              )}
              {!item.product_image && <div className="receipt-item-check">{'\u2713'}</div>}
              <div className="receipt-item-info">
                <div className="receipt-item-name">
                  {item.receipt_item || item.product_name || item.name}
                </div>
                {(item.receipt_item || item.product_name) && (
                  <div className="receipt-item-detail">{item.name}</div>
                )}
                <div className="receipt-item-meta">
                  {item.product_brand && <span>{item.product_brand}</span>}
                  {item.product_brand && item.product_size && <span> · </span>}
                  {item.product_size && <span>{item.product_size}</span>}
                  {item.receipt_price != null && <span> · {formatPrice(item.receipt_price)}</span>}
                </div>
              </div>
              {(item.receipt_upc || item.product_upc) && (
                <div className="receipt-rating">
                  <button
                    className={`receipt-rate-btn up${item.rating === 1 ? ' active' : ''}`}
                    onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    title="Thumbs up"
                  >{'\u{1F44D}'}</button>
                  <button
                    className={`receipt-rate-btn down${item.rating === -1 ? ' active' : ''}`}
                    onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                    title="Thumbs down"
                  >{'\u{1F44E}'}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Substituted items */}
      {receipt.substituted.length > 0 && (
        <div className="receipt-section">
          <div
            className="receipt-section-label substituted-label collapsible"
            onClick={() => toggleSection('substituted')}
          >
            <span>{collapsedSections.substituted ? '\u25B6' : '\u25BC'} Substituted ({receipt.substituted.length})</span>
          </div>
          {!collapsedSections.substituted && receipt.substituted.map(item => (
            <div key={item.name} className="receipt-item substituted">
              {item.product_image && (
                <img className="receipt-product-img" src={item.product_image} alt="" />
              )}
              <div className="receipt-item-info">
                <div className="receipt-item-name">{item.name}</div>
                {item.receipt_item && (
                  <div className="receipt-item-detail">
                    Received: {item.receipt_item}
                    {item.receipt_price != null && ` \u00B7 ${formatPrice(item.receipt_price)}`}
                  </div>
                )}
              </div>
              {(item.receipt_upc || item.product_upc) && (
                <div className="receipt-rating">
                  <button
                    className={`receipt-rate-btn up${item.rating === 1 ? ' active' : ''}`}
                    onClick={() => handleRate(item, item.rating === 1 ? 0 : 1)}
                    title="Thumbs up"
                  >{'\u{1F44D}'}</button>
                  <button
                    className={`receipt-rate-btn down${item.rating === -1 ? ' active' : ''}`}
                    onClick={() => handleRate(item, item.rating === -1 ? 0 : -1)}
                    title="Thumbs down"
                  >{'\u{1F44E}'}</button>
                </div>
              )}
              <div className="receipt-item-actions">
                <button
                  className="receipt-resolve-btn accept"
                  onClick={() => handleResolve(item.name, 'matched')}
                >
                  That's fine
                </button>
                <button
                  className="receipt-resolve-btn flag"
                  onClick={() => handleResolve(item.name, 'not_fulfilled')}
                >
                  Note for next time
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Not fulfilled items */}
      {receipt.not_fulfilled.length > 0 && (
        <div className="receipt-section">
          <div
            className="receipt-section-label not-fulfilled-label collapsible"
            onClick={() => toggleSection('not_fulfilled')}
          >
            <span>{collapsedSections.not_fulfilled ? '\u25B6' : '\u25BC'} Not fulfilled ({receipt.not_fulfilled.length})</span>
          </div>
          {!collapsedSections.not_fulfilled && receipt.not_fulfilled.map(item => (
            <div key={item.name} className="receipt-item not-fulfilled">
              <div className="receipt-item-info">
                <div className="receipt-item-name">{item.name}</div>
                <div className="receipt-item-meta">Ordered but not on receipt</div>
              </div>
              <div className="receipt-item-actions not-fulfilled-actions">
                <button
                  className="receipt-resolve-btn accept"
                  onClick={() => handleResolve(item.name, 'recover')}
                >
                  Add back to list
                </button>
                <button
                  className="receipt-resolve-btn"
                  onClick={() => handleResolve(item.name, 'matched')}
                >
                  Actually got it
                </button>
                <button
                  className="receipt-resolve-btn flag"
                  onClick={() => handleResolve(item.name, 'dismissed')}
                >
                  Don't need it
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FeedbackFab page="receipt" />
    </>
  )
}

function formatPrice(price) {
  if (price == null) return ''
  return `$${price.toFixed(2)}`
}
