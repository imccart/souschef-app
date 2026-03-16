import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'

function NovaBadge({ nova }) {
  if (!nova) return null
  const labels = { 1: 'Minimal processing', 2: 'Processed ingredient', 3: 'Processed', 4: 'Ultra-processed' }
  const cls = `nova-badge nova-${nova}`
  return <span className={cls}>NOVA {nova} {'\u00B7'} {labels[nova]}</span>
}

function NutriBadge({ grade }) {
  if (!grade) return null
  const cls = `nutri-badge nutri-${grade}`
  return <span className={cls}>Nutri-Score {grade.toUpperCase()}</span>
}

function ProductInsights({ nova, nutriscore }) {
  const [showInfo, setShowInfo] = useState(false)
  if (!nova && !nutriscore) return null
  return (
    <div className="product-insights">
      <NovaBadge nova={nova} />
      <NutriBadge grade={nutriscore} />
      <button className="info-dot" onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo) }} title="What is this?">{'\u24D8'}</button>
      {showInfo && (
        <div className="info-tooltip" onClick={(e) => e.stopPropagation()}>
          {nova && <>NOVA classifies foods by processing level. </>}
          {nutriscore && <>Nutri-Score rates nutritional quality (A=best). </>}
          Data from Open Food Facts.
        </div>
      )}
    </div>
  )
}

function ParentCoBadge({ brand, parentCompany, onTapUnknown }) {
  const [showInfo, setShowInfo] = useState(false)
  if (!parentCompany) return null
  const unknown = parentCompany === "We're not sure"
  return (
    <div
      className={`parent-co${unknown ? ' unknown' : ''}`}
      onClick={unknown ? (e) => { e.stopPropagation(); onTapUnknown(brand) } : undefined}
    >
      Parent Co.: {parentCompany}{unknown && ' \u00B7 ?'}
      {!unknown && <button className="info-dot" onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo) }} title="What is this?">{'\u24D8'}</button>}
      {showInfo && (
        <div className="info-tooltip" onClick={(e) => e.stopPropagation()}>
          Shows the parent company behind this brand, so you know who you're buying from.
        </div>
      )}
    </div>
  )
}

function formatPrice(price) {
  if (price == null) return ''
  return `$${price.toFixed(2)}`
}

export default function OrderPage() {
  const [order, setOrder] = useState(null)
  const [activeItem, setActiveItem] = useState(null)
  const [modifier, setModifier] = useState('')
  const [products, setProducts] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pendingProduct, setPendingProduct] = useState(null) // product awaiting quantity confirmation
  const [pendingQty, setPendingQty] = useState(1)
  const [showAnythingElse, setShowAnythingElse] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [krogerAccounts, setKrogerAccounts] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [fulfillment, setFulfillment] = useState(() => localStorage.getItem('souschef_fulfillment') || 'curbside')
  const [storeInfo, setStoreInfo] = useState(null)
  const [showQueue, setShowQueue] = useState(false)
  const [skippedItems, setSkippedItems] = useState(new Set())
  const [communityBrand, setCommunityBrand] = useState(null)
  const [communityValue, setCommunityValue] = useState('')
  const [communityConfirm, setCommunityConfirm] = useState(false)
  const [noStore, setNoStore] = useState(false)

  const [sharedAccountName, setSharedAccountName] = useState(null)

  useEffect(() => {
    api.getKrogerHouseholdAccounts().then(data => {
      const accounts = data.accounts || []
      setKrogerAccounts(accounts)
      const yours = accounts.find(a => a.is_you)
      if (yours) setSelectedAccount(yours.user_id)
      else if (accounts.length > 0) {
        setSelectedAccount(accounts[0].user_id)
        setSharedAccountName(accounts[0].display_name)
      }
    }).catch(() => setKrogerAccounts([]))
    api.getKrogerLocation().then(data => setStoreInfo(data)).catch(() => {})
  }, [])

  useEffect(() => {
    api.getOrder().then(data => {
      setOrder(data)
      if (data.pending.length > 0 && !activeItem) {
        setActiveItem(data.pending[0].name)
      }
    }).catch(() => setOrder({ pending: [], selected: [], total_price: 0, total_items: 0 }))
  }, [])

  const doSearch = (itemName, mod) => {
    if (!itemName) { setProducts(null); return }
    const term = mod ? `${mod} ${itemName}` : itemName
    setSearching(true)
    setProducts(null)
    setNoStore(false)
    api.searchProducts(term, fulfillment).then(data => {
      if (data.error === 'no_store') {
        setNoStore(true)
        setSearching(false)
        return
      }
      setProducts(data)
      setSearching(false)
    }).catch(err => {
      console.error('Search failed:', err)
      setSearching(false)
    })
  }

  const loadMore = () => {
    if (!products || !products.has_more || loadingMore) return
    const nextStart = (products.start || 1) + products.products.length
    const term = modifier ? `${modifier} ${activeItem}` : activeItem
    setLoadingMore(true)
    api.searchProducts(term, fulfillment, nextStart).then(data => {
      setProducts(prev => ({
        ...prev,
        products: [...prev.products, ...data.products],
        start: data.start,
        has_more: data.has_more,
      }))
      setLoadingMore(false)
    }).catch(() => setLoadingMore(false))
  }

  useEffect(() => {
    setModifier('')
    doSearch(activeItem, '')
  }, [activeItem, fulfillment])

  const storeName = storeInfo?.name || 'Kroger'

  // Find the next pending item after the current one, cycling back through skipped
  const advanceToNext = (updatedOrder) => {
    const pending = updatedOrder.pending
    if (pending.length === 0) {
      setActiveItem(null)
      return
    }
    // Find first pending item that hasn't been skipped
    const unskipped = pending.filter(p => !skippedItems.has(p.name))
    if (unskipped.length > 0) {
      setActiveItem(unskipped[0].name)
    } else {
      // All remaining were skipped — cycle back
      setSkippedItems(new Set())
      setActiveItem(pending[0].name)
    }
  }

  const handleSelect = (product) => {
    setPendingProduct(product)
    setPendingQty(1)
    setShowAnythingElse(false)
  }

  const handleConfirmQuantity = async () => {
    if (!pendingProduct) return
    try {
      const data = await api.selectProduct(activeItem, pendingProduct, pendingQty)
      setOrder(data)
      setSkippedItems(prev => {
        const next = new Set(prev)
        next.delete(activeItem)
        return next
      })
      setPendingProduct(null)
      setShowAnythingElse(true)
    } catch { /* silent */ }
  }

  const handleAnythingElseYes = () => {
    setShowAnythingElse(false)
    // Keep activeItem the same, search stays visible
  }

  const handleAnythingElseNo = () => {
    setShowAnythingElse(false)
    if (order) advanceToNext(order)
  }

  const handleSkip = () => {
    if (!activeItem || !order) return
    const pending = order.pending
    const newSkipped = new Set(skippedItems)
    newSkipped.add(activeItem)

    const unskippedAfter = pending.filter(p => p.name !== activeItem && !newSkipped.has(p.name))
    if (unskippedAfter.length > 0) {
      setSkippedItems(newSkipped)
      setActiveItem(unskippedAfter[0].name)
    } else {
      // All skipped — cycle back to the first pending item
      setSkippedItems(new Set())
      setActiveItem(pending[0].name)
    }
  }

  // Grocery-level actions — mark item on the trip and remove from order
  const handleGroceryAction = async (action) => {
    if (!activeItem) return
    try {
      if (action === 'bought') await api.toggleGroceryItem(activeItem)
      else if (action === 'have_it') await api.haveItGroceryItem(activeItem)
      else if (action === 'skip') await api.skipGroceryItem(activeItem)
      // Refresh order — item will be excluded since it's now checked/skipped/have_it
      const data = await api.getOrder()
      setOrder(data)
      advanceToNext(data)
    } catch { /* silent */ }
  }

  const handlePrev = () => {
    if (!activeItem || !order) return
    const allNames = [...order.pending.map(p => p.name), ...order.selected.map(s => s.name)]
    const idx = allNames.indexOf(activeItem)
    if (idx > 0) setActiveItem(allNames[idx - 1])
    else if (allNames.length > 0) setActiveItem(allNames[allNames.length - 1])
  }

  const handleDeselect = async (itemName) => {
    try {
      const data = await api.deselectProduct(itemName)
      setOrder(data)
      setActiveItem(itemName)
    } catch { /* silent */ }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const result = await api.submitOrder(selectedAccount || undefined)
      setSubmitResult(result)
    } catch {
      setSubmitResult({ ok: false, error: 'Failed to submit order' })
    }
    setSubmitting(false)
  }

  if (!order) return <><div className="loading">Prepping...</div><FeedbackFab page="order" /></>

  const allItems = [...order.pending, ...order.selected]
  const pickedCount = order.selected.length
  const totalCount = allItems.length

  if (totalCount === 0) {
    return (
      <>
        <div className="page-header">
          <h2 className="screen-heading">Order</h2>
          <div className="screen-sub">Select products for your list</div>
        </div>
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No unchecked items to order. Check off items you bought in-store on the Grocery tab first.</p>
        </div>
        <FeedbackFab page="order" />
      </>
    )
  }

  const storeDetails = (
    <div className="store-details">
      <div className="store-details-row">
        <div className="store-details-name">
          <select className="store-select" value="kroger" disabled>
            <option value="kroger">{storeName}</option>
          </select>
        </div>
        <div className="fulfillment-toggle">
          <button
            className={`fulfillment-btn${fulfillment === 'curbside' ? ' active' : ''}`}
            onClick={() => { setFulfillment('curbside'); localStorage.setItem('souschef_fulfillment', 'curbside') }}
          >Pickup</button>
          <button
            className={`fulfillment-btn${fulfillment === 'delivery' ? ' active' : ''}`}
            onClick={() => { setFulfillment('delivery'); localStorage.setItem('souschef_fulfillment', 'delivery') }}
          >Delivery</button>
        </div>
      </div>
      {storeInfo?.address && (
        <div className="store-details-address">{storeInfo.address}</div>
      )}
      {sharedAccountName && (
        <div className="store-details-shared">Ordering through {sharedAccountName}'s account</div>
      )}
    </div>
  )

  // Mobile collapsed queue row
  const mobileQueueRow = activeItem ? (
    <div className="picking-row">
      <button className="picking-row-nav" onClick={handlePrev}>{'\u2190'}</button>
      <div className="picking-row-main" onClick={() => setShowQueue(true)}>
        <span className="picking-row-label">Picking for</span>
        <span className="picking-row-item">{activeItem}</span>
        <span className="picking-row-progress">[{pickedCount}/{totalCount}]</span>
        <span className="picking-row-expand">{'\u25BE'}</span>
      </div>
      <button className="picking-row-nav" onClick={handleSkip}>{'\u2192'}</button>
    </div>
  ) : (
    <div className="picking-row done">
      <div className="picking-row-main">
        <span className="picking-row-summary">
          {pickedCount} of {totalCount} picked
          {order.total_price > 0 && ` \u00B7 ${formatPrice(order.total_price)}`}
        </span>
      </div>
      {pickedCount > 0 && !submitResult?.ok && (
        <button className="picking-row-send" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '...' : `Send to ${storeName} \u2192`}
        </button>
      )}
      {submitResult?.ok && (
        <span className="picking-row-sent">Sent {'\u2713'}</span>
      )}
    </div>
  )

  const queuePanel = (
    <div className="order-queue-panel">
      <div className="order-queue-header">
        <div className="order-queue-title">Unchecked items</div>
        <div className="order-queue-sub">
          {order.pending.length > 0
            ? `${order.pending.length} left to pick`
            : 'All items selected'}
        </div>
      </div>
      <div className="order-queue-list">
        {allItems.map(item => {
          const isSelected = !!item.product
          const isActive = item.name === activeItem
          return (
            <button
              key={item.name}
              className={`queue-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => isSelected ? handleDeselect(item.name) : setActiveItem(item.name)}
            >
              <span className="queue-item-name">{item.name}</span>
              {isSelected && <span className="queue-check">{'\u2713'}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )

  const centerPanel = (
    <div className="order-center-panel">
      <div className="order-desktop-store-details">
        {storeDetails}
      </div>
      {activeItem && (
        <div className="order-active-item">
          <div className="order-item-top-row">
            <div>
              <div className="order-item-label">Picking for</div>
              <div className="order-item-name">{activeItem}</div>
            </div>
            <div className="order-item-actions">
              <button className="order-grocery-btn" onClick={() => handleGroceryAction('bought')}>Bought</button>
              <button className="order-grocery-btn" onClick={() => handleGroceryAction('have_it')}>Have it</button>
              <button className="order-grocery-btn skip" onClick={() => handleGroceryAction('skip')}>Nevermind</button>
            </div>
          </div>
          <form className="modifier-form" onSubmit={e => {
            e.preventDefault()
            doSearch(activeItem, modifier)
          }}>
            <input
              className="modifier-input"
              type="text"
              placeholder="Refine... e.g. organic, low sodium"
              value={modifier}
              onChange={e => setModifier(e.target.value)}
            />
            {modifier && (
              <button type="button" className="modifier-clear" onClick={() => {
                setModifier('')
                doSearch(activeItem, '')
              }}>{'\u00D7'}</button>
            )}
          </form>
        </div>
      )}

      {noStore && !searching && (
        <div className="empty-state" style={{ padding: '20px 16px' }}>
          <p>Set your store in Preferences to search products.</p>
        </div>
      )}

      {searching && <div className="loading">{
        ['Dicing...', 'Simmering...', 'Slicing...', "Cookin'...", 'Chopping...', 'Seasoning...'][
          (activeItem || '').length % 6
        ]
      }</div>}

      {products && !searching && (
        <>
          {products.preferences.length > 0 && (
            <div className="order-section">
              <div className="order-section-label">Prior selections</div>
              {products.preferences.map(pref => (
                <button
                  key={pref.upc}
                  className="product-card preference"
                  onClick={() => handleSelect({
                    upc: pref.upc, name: pref.name,
                    brand: pref.brand, size: pref.size,
                    price: pref.promo_price || pref.price || null,
                    image: pref.image || '',
                  })}
                >
                  {pref.image && (
                    <div className="product-image">
                      <img src={pref.image} alt="" loading="lazy" />
                    </div>
                  )}
                  <div className="product-info">
                    <div className="product-name">{pref.name}</div>
                    <div className="product-meta">
                      {pref.brand && <span>{pref.brand}</span>}
                      {pref.size && <span> {'\u00B7'} {pref.size}</span>}
                    </div>
                    {(pref.price || pref.promo_price) && (
                      <div className="product-price-row">
                        {pref.promo_price ? (
                          <>
                            <span className="price-promo">{formatPrice(pref.promo_price)}</span>
                            <span className="price-original">{formatPrice(pref.price)}</span>
                          </>
                        ) : (
                          <span className="price">{formatPrice(pref.price)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <ProductInsights nova={pref.nova} nutriscore={pref.nutriscore} />
                  {pref.rating === 1 && <span className="pref-star">{'\u{1F44D}'}</span>}
                  {pref.rating === -1 && <span className="pref-down">{'\u{1F44E}'}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="order-section">
            <div className="order-section-label">
              {storeName} results
              {products.search_term !== activeItem && (
                <span className="search-term-note"> for "{products.search_term}"</span>
              )}
            </div>
            {products.products.length === 0 ? (
              <div className="empty-state">
                <p>No products found.</p>
              </div>
            ) : (
              <div className="product-grid">
                {products.products.map(p => (
                  <button
                    key={p.upc}
                    className={`product-card ${!p.in_stock ? 'out-of-stock' : ''}`}
                    onClick={() => p.in_stock && handleSelect({
                      upc: p.upc, name: p.name,
                      brand: p.brand, size: p.size,
                      price: p.promo_price || p.price,
                      image: p.image,
                    })}
                    disabled={!p.in_stock}
                  >
                    {p.image && (
                      <div className="product-image">
                        <img src={p.image} alt="" loading="lazy" />
                      </div>
                    )}
                    <div className="product-info">
                      <div className="product-name">{p.name}</div>
                      <div className="product-meta">
                        {p.brand && <span>{p.brand}</span>}
                        {p.size && <span> {'\u00B7'} {p.size}</span>}
                      </div>
                      <div className="product-price-row">
                        {p.promo_price ? (
                          <>
                            <span className="price-promo">{formatPrice(p.promo_price)}</span>
                            <span className="price-original">{formatPrice(p.price)}</span>
                          </>
                        ) : (
                          <span className="price">{formatPrice(p.price)}</span>
                        )}
                      </div>
                      {!p.in_stock && <div className="out-of-stock-label">Unavailable</div>}
                    </div>
                    <ProductInsights nova={p.nova} nutriscore={p.nutriscore} />
                    <ParentCoBadge brand={p.brand} parentCompany={p.parent_company} onTapUnknown={(b) => setCommunityBrand(b)} />
                    {p.rating === 1 && <span className="pref-star">{'\u{1F44D}'}</span>}
                    {p.rating === -1 && <span className="pref-down">{'\u{1F44E}'}</span>}
                  </button>
                ))}
              </div>
            )}
            {products.has_more && (
              <button className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'More results'}
              </button>
            )}
          </div>
        </>
      )}

      {pendingProduct && (
        <div className="order-qty-prompt">
          <div className="order-qty-label">How many?</div>
          <div className="order-qty-product">{pendingProduct.name}</div>
          <div className="order-qty-controls">
            <button className="order-qty-btn" onClick={() => setPendingQty(q => Math.max(1, q - 1))}>{'\u2212'}</button>
            <span className="order-qty-value">{pendingQty}</span>
            <button className="order-qty-btn" onClick={() => setPendingQty(q => q + 1)}>+</button>
          </div>
          <button className="order-qty-confirm" onClick={handleConfirmQuantity}>Confirm</button>
        </div>
      )}

      {showAnythingElse && (
        <div className="order-anything-else">
          <span>Anything else for <strong>{activeItem}</strong>?</span>
          <div className="order-anything-else-btns">
            <button className="order-grocery-btn" onClick={handleAnythingElseYes}>Yes</button>
            <button className="order-grocery-btn" onClick={handleAnythingElseNo}>No</button>
          </div>
        </div>
      )}
    </div>
  )

  const summaryPanel = (
    <div className="order-summary-panel">
      <div className="order-summary-header">
        <div className="order-summary-title">Order Summary</div>
        <div className="order-summary-sub">
          {pickedCount} of {totalCount} items selected
        </div>
      </div>
      <div className="order-summary-scroll">
        {pickedCount > 0 ? (
          <>
            <div className="order-summary-list-label">Selected so far</div>
            {order.selected.map(item => (
              <div key={item.name} className="order-summary-row">
                <span className="order-summary-item-name">{item.name}</span>
                <span className="order-summary-item-price">
                  {item.product?.price ? formatPrice(item.product.price) : ''}
                </span>
              </div>
            ))}
            {activeItem && order.pending.some(p => p.name === activeItem) && (
              <div className="order-summary-row selecting">
                <span className="order-summary-item-name">{activeItem}</span>
                <span className="order-summary-item-selecting">selecting...</span>
              </div>
            )}
            <div className="order-summary-total">
              <span>Est. subtotal</span>
              <strong>{formatPrice(order.total_price)}</strong>
            </div>
          </>
        ) : (
          <div className="order-summary-empty">
            No products selected yet. Pick items from the search results.
          </div>
        )}
      </div>
      <div className="order-summary-footer">
        {pickedCount > 0 && (
          <>
            {krogerAccounts && krogerAccounts.length === 0 ? (
              <div className="submit-hint">Connect your account in Preferences, or ask a household member to share access</div>
            ) : (
              <>
                {krogerAccounts && krogerAccounts.length > 1 && (
                  <div className="account-picker">
                    <label className="account-picker-label">Submit as</label>
                    <select
                      className="account-picker-select"
                      value={selectedAccount || ''}
                      onChange={e => setSelectedAccount(e.target.value)}
                    >
                      {krogerAccounts.map(a => (
                        <option key={a.user_id} value={a.user_id}>
                          {a.display_name}{a.is_you ? ' (you)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {submitResult?.ok ? (
                  <div className="submit-success">Sent to {storeName} {'\u2713'}</div>
                ) : (
                  <button
                    className="order-finalize-btn"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? 'Sending...' : `Send to ${storeName} ${'\u2192'}`}
                  </button>
                )}
                {submitResult && !submitResult.ok && (
                  <div className="submit-error">{submitResult.error}</div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile header */}
      <div className="page-header order-mobile-header">
        <h2 className="screen-heading">Order</h2>
      </div>

      {/* Mobile: store details */}
      <div className="order-mobile-store-details">
        {storeDetails}
      </div>

      {/* Mobile: collapsed queue row */}
      <div className="order-mobile-queue-row">
        {mobileQueueRow}
      </div>

      {/* Mobile: queue sheet */}
      {showQueue && (
        <Sheet onClose={() => setShowQueue(false)}>
          <div className="sheet-title">Items to pick</div>
          <div className="sheet-sub">{pickedCount} of {totalCount} selected</div>
          <div className="queue-sheet-list">
            {order.pending.length > 0 && (
              <>
                <div className="queue-sheet-section">Pending</div>
                {order.pending.map(item => (
                  <button
                    key={item.name}
                    className={`queue-sheet-item${item.name === activeItem ? ' active' : ''}`}
                    onClick={() => { setActiveItem(item.name); setShowQueue(false) }}
                  >
                    <span>{item.name}</span>
                    {skippedItems.has(item.name) && <span className="queue-sheet-skipped">skipped</span>}
                  </button>
                ))}
              </>
            )}
            {order.selected.length > 0 && (
              <>
                <div className="queue-sheet-section">Picked</div>
                {order.selected.map(item => (
                  <button
                    key={item.name}
                    className="queue-sheet-item picked"
                    onClick={() => { handleDeselect(item.name); setShowQueue(false) }}
                  >
                    <span>{item.name}</span>
                    <span className="queue-check">{'\u2713'}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </Sheet>
      )}

      {/* Desktop 3-column layout */}
      <div className="order-desktop-layout">
        {queuePanel}
        {centerPanel}
        {summaryPanel}
      </div>

      {/* Mobile: center content inline */}
      <div className="order-mobile-content">
        {centerPanel}
      </div>

      {/* Mobile: send footer — only when done picking */}
      {!activeItem && pickedCount > 0 && !submitResult?.ok && (
        <div className="order-footer order-mobile-footer">
          {krogerAccounts && krogerAccounts.length === 0 ? (
            <div className="submit-hint">Connect your account in Preferences, or ask a household member to share access</div>
          ) : (
            <>
              {krogerAccounts && krogerAccounts.length > 1 && (
                <div className="account-picker account-picker-mobile">
                  <select
                    className="account-picker-select"
                    value={selectedAccount || ''}
                    onChange={e => setSelectedAccount(e.target.value)}
                  >
                    {krogerAccounts.map(a => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.display_name}{a.is_you ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                className="build-list-btn"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Sending...' : `Send to ${storeName} ${'\u2192'}`}
              </button>
            </>
          )}
        </div>
      )}

      {communityBrand && !communityConfirm && (
        <Sheet onClose={() => { setCommunityBrand(null); setCommunityValue('') }}>
          <div className="sheet-title">Who makes this?</div>
          <div className="sheet-sub">Help us fill in the gaps.</div>
          <div className="community-form">
            <div className="community-brand">Brand: <strong>{communityBrand}</strong></div>
            <input
              className="community-input"
              type="text"
              placeholder="e.g. General Mills"
              value={communityValue}
              onChange={(e) => setCommunityValue(e.target.value)}
              autoFocus
            />
            <button
              className="btn primary"
              disabled={!communityValue.trim()}
              onClick={async () => {
                await api.submitCommunityData('brand_ownership', communityBrand, communityValue.trim())
                setCommunityBrand(null)
                setCommunityValue('')
                setCommunityConfirm(true)
                setTimeout(() => setCommunityConfirm(false), 2000)
              }}
            >Submit</button>
          </div>
        </Sheet>
      )}
      {communityConfirm && (
        <div className="community-toast">Yes, Chef!</div>
      )}
      <FeedbackFab page="order" />
    </>
  )
}
