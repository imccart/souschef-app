import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'

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
  if (!nova && !nutriscore) return null
  return (
    <div className="product-insights">
      <NovaBadge nova={nova} />
      <NutriBadge grade={nutriscore} />
    </div>
  )
}

function ParentCoBadge({ brand, parentCompany, onTapUnknown }) {
  if (!parentCompany) return null
  const unknown = parentCompany === "We're not sure"
  return (
    <div
      className={`parent-co${unknown ? ' unknown' : ''}`}
      onClick={unknown ? (e) => { e.stopPropagation(); onTapUnknown(brand) } : undefined}
    >
      Parent Co.: {parentCompany}{unknown && ' \u00B7 ?'}
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
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)
  const [krogerAccounts, setKrogerAccounts] = useState(null)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [communityBrand, setCommunityBrand] = useState(null)
  const [communityValue, setCommunityValue] = useState('')
  const [communityConfirm, setCommunityConfirm] = useState(false)

  useEffect(() => {
    api.getKrogerHouseholdAccounts().then(data => {
      setKrogerAccounts(data.accounts || [])
      // Auto-select: prefer "you", otherwise first available
      const yours = (data.accounts || []).find(a => a.is_you)
      if (yours) setSelectedAccount(yours.user_id)
      else if (data.accounts?.length > 0) setSelectedAccount(data.accounts[0].user_id)
    }).catch(() => setKrogerAccounts([]))
  }, [])

  useEffect(() => {
    api.getOrder().then(data => {
      setOrder(data)
      // Auto-select first pending item
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
    api.searchProducts(term).then(data => {
      setProducts(data)
      setSearching(false)
    }).catch(err => {
      console.error('Search failed:', err)
      setSearching(false)
    })
  }

  // Auto-search when active item changes (reset modifier)
  useEffect(() => {
    setModifier('')
    doSearch(activeItem, '')
  }, [activeItem])

  const handleSelect = async (product) => {
    try {
      const data = await api.selectProduct(activeItem, product)
      setOrder(data)
      if (data.pending.length > 0) {
        setActiveItem(data.pending[0].name)
      } else {
        setActiveItem(null)
      }
    } catch { /* silent — product stays unselected */ }
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

  if (!order) return <div className="loading">Prepping...</div>

  const allItems = [...order.pending, ...order.selected]

  if (allItems.length === 0) {
    return (
      <>
        <div className="page-header">
          <h2 className="screen-heading">Order</h2>
          <div className="screen-sub">Select Kroger products for your list</div>
        </div>
        <div className="empty-state">
          <div className="icon">{'\u{1F6D2}'}</div>
          <p>No unchecked items to order. Check off items you bought in-store on the Grocery tab first.</p>
        </div>
      </>
    )
  }

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
      {activeItem && (
        <div className="order-active-item">
          <div className="order-item-label">Picking for</div>
          <div className="order-item-name">{activeItem}</div>
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
                    price: null, image: pref.image || '',
                  })}
                >
                  {pref.image && (
                    <div className="product-image">
                      <img src={pref.image} alt="" loading="lazy" />
                    </div>
                  )}
                  <div className="product-info">
                    <div className="product-name">{pref.name}</div>
                    <div className="product-meta">{pref.size}</div>
                  </div>
                  {pref.rating === 1 && <span className="pref-star">{'\u2605'}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="order-section">
            <div className="order-section-label">
              Kroger results
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
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  const summaryPanel = (
    <div className="order-summary-panel">
      <div className="order-summary-header">
        <div className="order-summary-title">Order Summary</div>
        <div className="order-summary-sub">
          {order.selected.length} of {allItems.length} items selected
        </div>
      </div>
      <div className="order-summary-scroll">
        {order.selected.length > 0 ? (
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
            {order.pending.length > 0 && (
              <div className="order-summary-hint">
                {order.pending.length} item{order.pending.length !== 1 ? 's' : ''} still need selection.
                Keep going, or finalize now and the rest will carry over.
              </div>
            )}
          </>
        ) : (
          <div className="order-summary-empty">
            No products selected yet. Pick items from the search results.
          </div>
        )}
      </div>
      <div className="order-summary-footer">
        {order.selected.length > 0 && (
          <>
            {krogerAccounts && krogerAccounts.length === 0 ? (
              <div className="submit-hint">Link a store account in Preferences to submit orders</div>
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
                  <div className="submit-success">Added to Kroger cart {'\u2713'}</div>
                ) : (
                  <button
                    className="order-finalize-btn"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting...' : `Finalize on Kroger ${'\u2192'}`}
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
      {/* Mobile header — hidden on desktop 3-col */}
      <div className="page-header order-mobile-header">
        <h2 className="screen-heading">Order</h2>
        <div className="screen-sub">
          {order.pending.length > 0
            ? `${order.pending.length} item${order.pending.length !== 1 ? 's' : ''} to pick`
            : 'All items selected'}
        </div>
      </div>

      {/* Mobile: horizontal queue strip */}
      <div className="order-queue order-mobile-queue">
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

      {/* Mobile: order summary footer */}
      {order.selected.length > 0 && (
        <div className="order-footer order-mobile-footer">
          <div className="order-summary">
            <span>{order.total_items} item{order.total_items !== 1 ? 's' : ''}</span>
            {order.total_price > 0 && (
              <span> {'\u00B7'} {formatPrice(order.total_price)}</span>
            )}
          </div>
          {krogerAccounts && krogerAccounts.length === 0 ? (
            <div className="submit-hint">Link a store account in Preferences</div>
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
              {submitResult?.ok ? (
                <div className="submit-success">Added to Kroger cart {'\u2713'}</div>
              ) : (
                <button
                  className="build-list-btn"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : `Finalize on Kroger ${'\u2192'}`}
                </button>
              )}
              {submitResult && !submitResult.ok && (
                <div className="submit-error">{submitResult.error}</div>
              )}
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
    </>
  )
}
