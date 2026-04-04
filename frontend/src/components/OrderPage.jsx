import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import FeedbackFab from './FeedbackFab'
import styles from './OrderPage.module.css'

function NovaBadge({ nova }) {
  if (!nova) return null
  const labels = { 1: 'Minimal processing', 2: 'Processed ingredient', 3: 'Processed', 4: 'Ultra-processed' }
  const cls = `${styles.novaBadge} ${styles[`nova${nova}`]}`
  return <span className={cls}>NOVA {nova} {'\u00B7'} {labels[nova]}</span>
}

function NutriBadge({ grade }) {
  if (!grade) return null
  const cls = `${styles.nutriBadge} ${styles[`nutri${grade.toUpperCase()}`]}`
  return <span className={cls}>Nutri-Score {grade.toUpperCase()}</span>
}

function ProductInsights({ nova, nutriscore }) {
  const [showInfo, setShowInfo] = useState(false)
  if (!nova && !nutriscore) return null
  return (
    <div className={styles.productInsights}>
      <NovaBadge nova={nova} />
      <NutriBadge grade={nutriscore} />
      <button className={styles.infoDot} onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo) }} title="What is this?">{'\u24D8'}</button>
      {showInfo && (
        <div className={styles.infoTooltip} onClick={(e) => e.stopPropagation()}>
          {nova && <>NOVA classifies foods by processing level. </>}
          {nutriscore && <>Nutri-Score rates nutritional quality (A=best). </>}
          Data from Open Food Facts.
        </div>
      )}
    </div>
  )
}

function ParentCoBadge({ brand, parentCompany, violations, onTapUnknown }) {
  const [showInfo, setShowInfo] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (!parentCompany) return null
  const unknown = parentCompany === "We're not sure"
  const v = violations || {}
  const hasViolations = v.fda_total_recalls > 0
  const hasDetails = !unknown && hasViolations
  return (
    <div className={styles.parentCoWrap}>
      <div
        className={`${styles.parentCo}${unknown ? ` ${styles.unknown}` : ''}${hasDetails ? ` ${styles.expandable}` : ''}`}
        onClick={unknown ? (e) => { e.stopPropagation(); e.preventDefault(); onTapUnknown(brand) } : hasDetails ? (e) => { e.stopPropagation(); e.preventDefault(); setExpanded(!expanded) } : undefined}
      >
        Parent Co.: {parentCompany}{unknown && ' \u00B7 ?'}
        {hasDetails && <span className={styles.parentCoChevron}>{expanded ? '\u25B4' : '\u25BE'}</span>}
        {!unknown && !hasDetails && <button className={styles.infoDot} onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo) }} title="What is this?">{'\u24D8'}</button>}
      </div>
      {showInfo && (
        <div className={styles.infoTooltip} onClick={(e) => e.stopPropagation()}>
          Shows the parent company behind this brand, so you know who you're buying from.
        </div>
      )}
      {expanded && hasDetails && (
        <div className={styles.companyDetails} onClick={(e) => e.stopPropagation()}>
          <div className={styles.companyDetailsRow}>
            <span className={styles.companyDetailsLabel}>FDA food recalls</span>
            <span className={styles.companyDetailsValue}>{v.fda_total_recalls}</span>
          </div>
          {v.fda_class_i > 0 && (
            <div className={styles.companyDetailsRow}>
              <span className={styles.companyDetailsLabel}>Class I (serious)</span>
              <span className={styles.companyDetailsValue}>{v.fda_class_i}</span>
            </div>
          )}
          {v.fda_most_recent && (
            <div className={styles.companyDetailsRow}>
              <span className={styles.companyDetailsLabel}>Most recent</span>
              <span className={styles.companyDetailsValue}>{v.fda_most_recent.slice(0, 4)}-{v.fda_most_recent.slice(4, 6)}-{v.fda_most_recent.slice(6, 8)}</span>
            </div>
          )}
          <div className={styles.companyDetailsSource}>Source: FDA openFDA</div>
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
  const [searchTerm, setSearchTerm] = useState('')
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
  const [mobileSection, setMobileSection] = useState(null) // 'ordered' | 'elsewhere' | null
  const [communityBrand, setCommunityBrand] = useState(null)
  const [communityValue, setCommunityValue] = useState('')
  const [communityConfirm, setCommunityConfirm] = useState(false)
  const [noStore, setNoStore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [comparisons, setComparisons] = useState(null)
  const [showComparison, setShowComparison] = useState(false)

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
      setLoadError(false)
      if (data.pending.length > 0 && !activeItem) {
        setActiveItem(data.pending[0].name)
      }
    }).catch(() => setLoadError(true))
  }, [])

  const doSearch = (term) => {
    if (!term) { setProducts(null); return }
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
    setLoadingMore(true)
    api.searchProducts(searchTerm, fulfillment, nextStart).then(data => {
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
    if (activeItem) {
      setSearchTerm(activeItem)
      doSearch(activeItem)
    }
  }, [activeItem, fulfillment])

  // Fetch price comparisons when selected items change
  const selectedCount = order?.selected?.length || 0
  useEffect(() => {
    if (selectedCount === 0) { setComparisons(null); return }
    const timer = setTimeout(() => {
      api.getPriceComparison().then(data => setComparisons(data.comparisons)).catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [selectedCount])

  const storeName = storeInfo?.name || 'Kroger'
  const activeItemData = order ? [...order.pending, ...order.selected, ...order.buy_elsewhere].find(i => i.name === activeItem) : null

  const advanceToNext = (updatedOrder) => {
    const pending = updatedOrder.pending
    if (pending.length === 0) {
      setActiveItem(null)
      return
    }
    // Pick the first pending item, or stay on current if still pending
    const currentStillPending = pending.find(p => p.name === activeItem)
    if (currentStillPending) {
      // Current item is still pending (e.g., after "anything else? yes") — keep it
      return
    }
    setActiveItem(pending[0].name)
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

  const handleBuyElsewhere = async () => {
    if (!activeItem) return
    try {
      const data = await api.buyElsewhere(activeItem)
      setOrder(data)
      advanceToNext(data)
    } catch { /* silent */ }
  }

  const handleUndoBuyElsewhere = async (itemName) => {
    try {
      const data = await api.buyElsewhere(itemName) // toggles off
      setOrder(data)
      setActiveItem(itemName)
      setMobileSection(null)
    } catch { /* silent */ }
  }

  // Grocery-level actions — mark item on the trip and remove from order
  const handleGroceryAction = async (action) => {
    if (!activeItem) return
    try {
      if (action === 'bought') await api.toggleGroceryItem(activeItem)
      else if (action === 'have_it') await api.haveItGroceryItem(activeItem)
      else if (action === 'remove') await api.removeGroceryItem(activeItem)
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
      if (result.ok) {
        // Refresh order — submitted items will be filtered out
        const data = await api.getOrder()
        setOrder(data)
        setActiveItem(null)
      }
    } catch {
      setSubmitResult({ ok: false, error: 'Failed to submit order' })
    }
    setSubmitting(false)
  }

  if (loadError) return (
    <>
      <div className="page-header">
        <h2 className="screen-heading">Order</h2>
      </div>
      <div className="empty-state">
        <div className="icon">{'\u{1F6D2}'}</div>
        <p>Couldn't reach the kitchen. Check your connection and try again.</p>
      </div>
      <FeedbackFab page="order" />
    </>
  )

  if (!order) return <><div className="loading">Prepping...</div><FeedbackFab page="order" /></>

  const allItems = [...order.pending, ...order.selected]
  const elsewhereItems = order.buy_elsewhere || []
  const pickedCount = order.selected.length
  const pendingCount = order.pending.length
  const elsewhereCount = elsewhereItems.length
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
          <p>No unchecked items to order.</p>
        </div>
        <FeedbackFab page="order" />
      </>
    )
  }

  const storeDetails = (
    <div className={styles.storeDetails}>
      <div className={styles.storeDetailsRow}>
        <div className={styles.storeDetailsName}>
          <select className={styles.storeSelect} value="kroger" disabled>
            <option value="kroger">{storeName}</option>
          </select>
        </div>
        <div className={styles.fulfillmentToggle}>
          <button
            className={`${styles.fulfillmentBtn}${fulfillment === 'curbside' ? ` ${styles.active}` : ''}`}
            onClick={() => { setFulfillment('curbside'); localStorage.setItem('souschef_fulfillment', 'curbside') }}
          >Pickup</button>
          <button
            className={`${styles.fulfillmentBtn}${fulfillment === 'delivery' ? ` ${styles.active}` : ''}`}
            onClick={() => { setFulfillment('delivery'); localStorage.setItem('souschef_fulfillment', 'delivery') }}
          >Delivery</button>
        </div>
      </div>
      {storeInfo?.address && (
        <div className={styles.storeDetailsAddress}>{storeInfo.address}</div>
      )}
      {sharedAccountName && (
        <div className={styles.storeDetailsShared}>Ordering through {sharedAccountName}'s account</div>
      )}
    </div>
  )

  // Mobile header counts
  const mobileHeaderCounts = (
    <div className={styles.orderMobileCounts}>
      <button
        className={`${styles.orderCountBtn}${!mobileSection ? ` ${styles.active}` : ''}`}
        onClick={() => setMobileSection(null)}
      >
        {pendingCount} left
      </button>
      <span className={styles.orderCountDot}>{'\u00B7'}</span>
      <button
        className={`${styles.orderCountBtn}${mobileSection === 'ordered' ? ` ${styles.active}` : ''}`}
        onClick={() => setMobileSection(mobileSection === 'ordered' ? null : 'ordered')}
      >
        {pickedCount} ordered
      </button>
      {elsewhereCount > 0 && (
        <>
          <span className={styles.orderCountDot}>{'\u00B7'}</span>
          <button
            className={`${styles.orderCountBtn}${mobileSection === 'elsewhere' ? ` ${styles.active}` : ''}`}
            onClick={() => setMobileSection(mobileSection === 'elsewhere' ? null : 'elsewhere')}
          >
            {elsewhereCount} elsewhere
          </button>
        </>
      )}
    </div>
  )

  // Mobile collapsed queue row
  const mobileQueueRow = activeItem ? (
    <div className={styles.pickingRow}>
      <button className={styles.pickingRowNav} onClick={handlePrev}>{'\u2190'}</button>
      <div className={styles.pickingRowMain} onClick={() => setShowQueue(true)}>
        <span className={styles.pickingRowLabel}>Picking for</span>
        <span className={styles.pickingRowItem}>{activeItem}</span>
        <span className={styles.pickingRowProgress}>[{pickedCount}/{totalCount}]</span>
        <span className={styles.pickingRowExpand}>{'\u25BE'}</span>
      </div>
      <button className={styles.pickingRowNav} onClick={handleBuyElsewhere} title="Buy elsewhere">{'\u2192'}</button>
    </div>
  ) : (
    <div className={`${styles.pickingRow} ${styles.done}`}>
      <div className={styles.pickingRowMain}>
        <span className={styles.pickingRowSummary}>
          {pickedCount} of {totalCount} picked
          {order.total_price > 0 && ` \u00B7 ${formatPrice(order.total_price)}`}
        </span>
      </div>
      {pickedCount > 0 && !submitResult?.ok && (
        <button className={styles.pickingRowSend} onClick={handleSubmit} disabled={submitting}>
          {submitting ? '...' : `Send to ${storeName} \u2192`}
        </button>
      )}
      {submitResult?.ok && (
        <span className={styles.pickingRowSent}>Sent {'\u2713'}</span>
      )}
    </div>
  )

  const queuePanel = (
    <div className={styles.orderQueuePanel}>
      <div className={styles.orderQueueHeader}>
        <div className={styles.orderQueueTitle}>Items</div>
        <div className={styles.orderQueueSub}>
          {pendingCount > 0
            ? `${pendingCount} left to pick`
            : 'All items selected'}
        </div>
      </div>
      <div className={styles.orderQueueList}>
        {order.pending.length > 0 && (
          <>
            <div className={styles.queueSectionLabel}>Active</div>
            {order.pending.map(item => {
              const isActive = item.name === activeItem
              return (
                <button
                  key={item.name}
                  className={`${styles.queueItem}${isActive ? ` ${styles.active}` : ''}`}
                  onClick={() => setActiveItem(item.name)}
                >
                  <span className={styles.queueItemName}>{item.name}</span>
                  {item.for_meals?.length > 0 && (
                    <span className={styles.queueItemMeals}>{item.for_meals.join(', ')}</span>
                  )}
                </button>
              )
            })}
          </>
        )}
        {order.selected.length > 0 && (
          <>
            <div className={styles.queueSectionLabel}>Ordered</div>
            {order.selected.map(item => (
              <button
                key={item.name}
                className={`${styles.queueItem} ${styles.selected}`}
                onClick={() => handleDeselect(item.name)}
              >
                <span className={styles.queueItemName}>{item.name}</span>
                <span className={styles.queueCheck}>{'\u2713'}</span>
              </button>
            ))}
          </>
        )}
        {elsewhereItems.length > 0 && (
          <>
            <div className={styles.queueSectionLabel}>Buying elsewhere</div>
            {elsewhereItems.map(item => (
              <button
                key={item.name}
                className={`${styles.queueItem} ${styles.elsewhere}`}
                onClick={() => handleUndoBuyElsewhere(item.name)}
                title="Bring back to ordering"
              >
                <span className={styles.queueItemName}>{item.name}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )

  const centerPanel = (
    <div className={styles.orderCenterPanel}>
      <div className={styles.orderDesktopStoreDetails}>
        {storeDetails}
      </div>
      {activeItem && (
        <div className={styles.orderActiveItem}>
          <div className={styles.orderItemTopRow}>
            <div>
              <div className={styles.orderItemLabel}>Picking for</div>
              <div className={styles.orderItemName}>{activeItem}</div>
              {activeItemData?.for_meals?.length > 0 && (
                <div className={styles.orderItemMeals}>{activeItemData.for_meals.join(', ')}</div>
              )}
              {activeItemData?.notes && (
                <div className={styles.orderItemNote}>{activeItemData.notes}</div>
              )}
            </div>
            <div className={styles.orderItemActions}>
              <button className={styles.orderGroceryBtn} onClick={() => handleGroceryAction('bought')}>Bought</button>
              <button className={styles.orderGroceryBtn} onClick={() => handleGroceryAction('have_it')}>Have it</button>
              <button className={`${styles.orderGroceryBtn} ${styles.elsewhere}`} onClick={handleBuyElsewhere}>Elsewhere</button>
              <button className={styles.orderRemoveX} onClick={() => handleGroceryAction('remove')} title="Remove from list">{'\u00D7'}</button>
            </div>
          </div>
          <form className={styles.orderSearchForm} onSubmit={e => {
            e.preventDefault()
            doSearch(searchTerm)
            e.target.querySelector('input')?.blur()
          }}>
            <input
              className={styles.orderSearchInput}
              type="search"
              enterKeyHint="search"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search products..."
            />
            {searchTerm !== activeItem && (
              <button type="button" className={styles.orderSearchReset} onClick={() => {
                setSearchTerm(activeItem)
                doSearch(activeItem)
              }} title="Reset search">{'\u21BA'}</button>
            )}
          </form>
        </div>
      )}

      {pendingProduct && (
        <div className={styles.orderModalOverlay} onClick={() => setPendingProduct(null)}>
          <div className={styles.orderModal} onClick={e => e.stopPropagation()}>
            <div className={styles.orderQtyLabel}>How many?</div>
            <div className={styles.orderQtyProduct}>{pendingProduct.name}</div>
            <div className={styles.orderQtyControls}>
              <button className={styles.orderQtyBtn} onClick={() => setPendingQty(q => Math.max(1, q - 1))}>{'\u2212'}</button>
              <span className="order-qty-value">{pendingQty}</span>
              <button className={styles.orderQtyBtn} onClick={() => setPendingQty(q => q + 1)}>+</button>
            </div>
            <button className={styles.orderQtyConfirm} onClick={handleConfirmQuantity}>Confirm</button>
          </div>
        </div>
      )}

      {showAnythingElse && (
        <div className={styles.orderModalOverlay}>
          <div className={styles.orderModal}>
            <span>Anything else for <strong>{activeItem}</strong>?</span>
            <div className={styles.orderAnythingElseBtns}>
              <button className={styles.orderGroceryBtn} onClick={handleAnythingElseYes}>Yes</button>
              <button className={styles.orderGroceryBtn} onClick={handleAnythingElseNo}>No</button>
            </div>
          </div>
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
            <div className={styles.orderSection}>
              <div className={styles.orderSectionLabel}>Prior selections</div>
              {products.preferences.map(pref => (
                <div key={pref.upc} className={`${styles.productCard} ${styles.preference}`} style={{ position: 'relative' }}>
                  <button
                    className={styles.prefDismiss}
                    onClick={(e) => { e.stopPropagation(); api.deletePreference(pref.upc).then(() => doSearch(searchTerm)).catch(() => {}) }}
                    title="Remove prior selection"
                  >{'\u00D7'}</button>
                  <button
                    className={styles.prefSelectBtn}
                    onClick={() => handleSelect({
                      upc: pref.upc, name: pref.name,
                      brand: pref.brand, size: pref.size,
                      price: pref.promo_price || pref.price || null,
                      image: pref.image || '',
                    })}
                  >
                    {pref.image && (
                      <div className={styles.productImage}>
                        <img src={pref.image} alt="" loading="lazy" />
                      </div>
                    )}
                    <div className={styles.productInfo}>
                      <div className={styles.productName}>
                        {pref.name}
                        {pref.rating === 1 && <span className={styles.prefStar}> {'\u{1F44D}'}</span>}
                        {pref.rating === -1 && <span className={styles.prefDown}> {'\u{1F44E}'}</span>}
                      </div>
                      <div className={styles.productMeta}>
                        {pref.brand && <span>{pref.brand}</span>}
                        {pref.size && <span> {'\u00B7'} {pref.size}</span>}
                        {(pref.price || pref.promo_price) && (
                          <>
                            <span> {'\u00B7'} </span>
                            {pref.promo_price ? (
                              <>
                                <span className={styles.pricePromo}>{formatPrice(pref.promo_price)}</span>
                                <span className={styles.priceOriginal}> {formatPrice(pref.price)}</span>
                              </>
                            ) : (
                              <span className={styles.price}>{formatPrice(pref.price)}</span>
                            )}
                          </>
                        )}
                      </div>
                      <ProductInsights nova={pref.nova} nutriscore={pref.nutriscore} />
                      <ParentCoBadge brand={pref.brand} parentCompany={pref.parent_company} violations={pref.violations} onTapUnknown={(b) => setCommunityBrand(b || 'Unknown')} />
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.orderSection}>
            <div className={styles.orderSectionLabel}>
              {storeName} results
              {products.search_term !== activeItem && (
                <span className={styles.searchTermNote}> for "{products.search_term}"</span>
              )}
            </div>
            {products.products.length === 0 ? (
              <div className="empty-state">
                <p>No products found.</p>
              </div>
            ) : (
              <div className={styles.productGrid}>
                {products.products.map(p => (
                  <button
                    key={p.upc}
                    className={`${styles.productCard}${!p.in_stock ? ` ${styles.outOfStock}` : ''}`}
                    onClick={() => p.in_stock && handleSelect({
                      upc: p.upc, name: p.name,
                      brand: p.brand, size: p.size,
                      price: p.promo_price || p.price,
                      image: p.image,
                    })}
                    disabled={!p.in_stock}
                  >
                    {p.image && (
                      <div className={styles.productImage}>
                        <img src={p.image} alt="" loading="lazy" />
                      </div>
                    )}
                    <div className={styles.productInfo}>
                      <div className={styles.productName}>{p.name}</div>
                      <div className={styles.productMeta}>
                        {p.brand && <span>{p.brand}</span>}
                        {p.size && <span> {'\u00B7'} {p.size}</span>}
                      </div>
                      <div className={styles.productPriceRow}>
                        {p.promo_price ? (
                          <>
                            <span className={styles.pricePromo}>{formatPrice(p.promo_price)}</span>
                            <span className={styles.priceOriginal}>{formatPrice(p.price)}</span>
                          </>
                        ) : (
                          <span className={styles.price}>{formatPrice(p.price)}</span>
                        )}
                      </div>
                      {!p.in_stock && <div className={styles.outOfStockLabel}>Unavailable</div>}
                    </div>
                    <ProductInsights nova={p.nova} nutriscore={p.nutriscore} />
                    <ParentCoBadge brand={p.brand} parentCompany={p.parent_company} violations={p.violations} onTapUnknown={(b) => setCommunityBrand(b || 'Unknown')} />
                    {p.rating === 1 && <span className={styles.prefStar}>{'\u{1F44D}'}</span>}
                    {p.rating === -1 && <span className={styles.prefDown}>{'\u{1F44E}'}</span>}
                  </button>
                ))}
              </div>
            )}
            {products.has_more && (
              <button className={styles.loadMoreBtn} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'More results'}
              </button>
            )}
          </div>
        </>
      )}

    </div>
  )

  const summaryPanel = (
    <div className={styles.orderSummaryPanel}>
      <div className={styles.orderSummaryHeader}>
        <div className={styles.orderSummaryTitle}>Order Summary</div>
        <div className={styles.orderSummarySub}>
          {pickedCount} of {totalCount} items selected
        </div>
      </div>
      <div className={styles.orderSummaryScroll}>
        {pickedCount > 0 ? (
          <>
            <div className={styles.orderSummaryListLabel}>Selected so far</div>
            {order.selected.map(item => (
              <div key={item.name} className={styles.orderSummaryRow}>
                <span className={styles.orderSummaryItemName}>{item.name}</span>
                <span className={styles.orderSummaryItemPrice}>
                  {item.product?.price ? (
                    (item.product.quantity || 1) > 1
                      ? `${formatPrice(item.product.price)} \u00D7 ${item.product.quantity}`
                      : formatPrice(item.product.price)
                  ) : ''}
                </span>
              </div>
            ))}
            {activeItem && order.pending.some(p => p.name === activeItem) && (
              <div className={`${styles.orderSummaryRow} ${styles.selecting}`}>
                <span className={styles.orderSummaryItemName}>{activeItem}</span>
                <span className={styles.orderSummaryItemSelecting}>selecting...</span>
              </div>
            )}
            <div className={styles.orderSummaryTotal}>
              <span>Est. subtotal</span>
              <strong>{formatPrice(order.total_price)}</strong>
            </div>
            {comparisons && comparisons.length > 0 && (
              <div className={styles.priceComparisonPanel}>
                <button className={styles.comparisonToggle} onClick={() => setShowComparison(!showComparison)}>
                  Compare nearby stores {showComparison ? '\u25B4' : '\u25BE'}
                </button>
                {showComparison && (
                  <>
                    {comparisons.map(c => (
                      <div key={c.location_id} className={styles.comparisonRow}>
                        <div className={styles.comparisonStore}>{c.name}</div>
                        <div className={c.savings > 0 ? styles.comparisonSavings : styles.comparisonMore}>
                          {c.savings > 0
                            ? `Save $${c.savings.toFixed(2)}`
                            : c.savings === 0
                            ? 'Same price'
                            : `$${Math.abs(c.savings).toFixed(2)} more`}
                          <span className={styles.comparisonDetail}>
                            {' '}(comparing {c.items_compared} of {c.items_total} items)
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className={styles.comparisonDisclaimer}>
                      Prices are estimates and may change. Not all items could be compared.
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className={styles.orderSummaryEmpty}>
            No products selected yet. Pick items from the search results.
          </div>
        )}
      </div>
      <div className={styles.orderSummaryFooter}>
        {pickedCount > 0 && (
          <>
            {krogerAccounts && krogerAccounts.length === 0 ? (
              <div className={styles.submitHint}>Connect your account in Preferences, or ask a household member to share access</div>
            ) : (
              <>
                {krogerAccounts && krogerAccounts.length > 1 && (
                  <div className={styles.accountPicker}>
                    <label className={styles.accountPickerLabel}>Submit as</label>
                    <select
                      className={styles.accountPickerSelect}
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
                    className={styles.orderFinalizeBtn}
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
      <div className={`page-header ${styles.orderMobileHeader}`}>
        <h2 className="screen-heading">Order</h2>
      </div>

      {/* Mobile: store details */}
      <div className={styles.orderMobileStoreDetails}>
        {storeDetails}
      </div>

      {/* Mobile: header counts */}
      <div className={styles.orderMobileQueueRow}>
        {mobileHeaderCounts}
      </div>

      {/* Mobile: collapsed queue row */}
      <div className={styles.orderMobileQueueRow}>
        {mobileQueueRow}
      </div>

      {/* Mobile: queue sheet */}
      {showQueue && (
        <Sheet onClose={() => setShowQueue(false)}>
          <div className="sheet-title">Items to pick</div>
          <div className="sheet-sub">{pickedCount} of {totalCount} selected</div>
          <div className={styles.queueSheetList}>
            {order.pending.length > 0 && (
              <>
                <div className={styles.queueSheetSection}>Active</div>
                {order.pending.map(item => (
                  <button
                    key={item.name}
                    className={`${styles.queueSheetItem}${item.name === activeItem ? ` ${styles.active}` : ''}`}
                    onClick={() => { setActiveItem(item.name); setShowQueue(false); setMobileSection(null) }}
                  >
                    <span>{item.name}</span>
                  </button>
                ))}
              </>
            )}
            {order.selected.length > 0 && (
              <>
                <div className={styles.queueSheetSection}>Ordered</div>
                {order.selected.map(item => (
                  <button
                    key={item.name}
                    className={`${styles.queueSheetItem} ${styles.selected}`}
                    onClick={() => { handleDeselect(item.name); setShowQueue(false); setMobileSection(null) }}
                  >
                    <span>{item.name}</span>
                    <span className={styles.queueCheck}>{'\u2713'}</span>
                  </button>
                ))}
              </>
            )}
            {elsewhereItems.length > 0 && (
              <>
                <div className={styles.queueSheetSection}>Buying elsewhere</div>
                {elsewhereItems.map(item => (
                  <button
                    key={item.name}
                    className={`${styles.queueSheetItem} ${styles.elsewhere}`}
                    onClick={() => { handleUndoBuyElsewhere(item.name); setShowQueue(false) }}
                  >
                    <span>{item.name}</span>
                    <span className={styles.queueSheetElsewhere}>elsewhere</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </Sheet>
      )}

      {/* Desktop 3-column layout */}
      <div className={styles.orderDesktopLayout}>
        {queuePanel}
        {centerPanel}
        {summaryPanel}
      </div>

      {/* Mobile: section views (when tapping ordered/elsewhere counts) */}
      {mobileSection === 'ordered' && (
        <div className={styles.orderMobileContent}>
          <div className={styles.orderMobileSection}>
            <div className={styles.orderMobileSectionTitle}>Ordered ({pickedCount})</div>
            {order.selected.map(item => (
              <button
                key={item.name}
                className={`${styles.queueSheetItem} ${styles.selected}`}
                onClick={() => { handleDeselect(item.name); setMobileSection(null) }}
              >
                <span>{item.name}</span>
                <span className={styles.queueCheck}>{'\u2713'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {mobileSection === 'elsewhere' && (
        <div className={styles.orderMobileContent}>
          <div className={styles.orderMobileSection}>
            <div className={styles.orderMobileSectionTitle}>Buying elsewhere ({elsewhereCount})</div>
            {elsewhereItems.map(item => (
              <button
                key={item.name}
                className={`${styles.queueSheetItem} ${styles.elsewhere}`}
                onClick={() => handleUndoBuyElsewhere(item.name)}
              >
                <span>{item.name}</span>
                <span className={styles.queueSheetElsewhere}>tap to bring back</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile: center content inline */}
      {!mobileSection && (
        <div className={styles.orderMobileContent}>
          {centerPanel}
        </div>
      )}

      {/* Mobile: price comparison */}
      {!activeItem && comparisons && comparisons.length > 0 && (
        <div className={styles.priceComparisonMobile}>
          <button className={styles.comparisonToggle} onClick={() => setShowComparison(!showComparison)}>
            Compare nearby stores {showComparison ? '\u25B4' : '\u25BE'}
          </button>
          {showComparison && (
            <>
              {comparisons.map(c => (
                <div key={c.location_id} className={styles.comparisonRow}>
                  <div className={styles.comparisonStore}>{c.name}</div>
                  <div className={c.savings > 0 ? styles.comparisonSavings : styles.comparisonMore}>
                    {c.savings > 0
                      ? `Save $${c.savings.toFixed(2)}`
                      : `$${Math.abs(c.savings).toFixed(2)} more`}
                    <span className={styles.comparisonDetail}>
                      {' '}(comparing {c.items_compared} of {c.items_total} items)
                    </span>
                  </div>
                </div>
              ))}
              <div className={styles.comparisonDisclaimer}>
                Prices are estimates and may change. Not all items could be compared.
              </div>
            </>
          )}
        </div>
      )}

      {/* Mobile: send footer — only when done picking */}
      {!activeItem && pickedCount > 0 && !submitResult?.ok && (
        <div className={`${styles.orderFooter} ${styles.orderMobileFooter}`}>
          {krogerAccounts && krogerAccounts.length === 0 ? (
            <div className={styles.submitHint}>Connect your account in Preferences, or ask a household member to share access</div>
          ) : (
            <>
              {krogerAccounts && krogerAccounts.length > 1 && (
                <div className={`${styles.accountPicker} ${styles.accountPickerMobile}`}>
                  <select
                    className={styles.accountPickerSelect}
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
                className={styles.buildListBtn}
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
          <div className={styles.communityForm}>
            <div className={styles.communityBrand}>Brand: <strong>{communityBrand}</strong></div>
            <input
              className={styles.communityInput}
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
        <div className={styles.communityToast}>Yes, Chef!</div>
      )}
      <FeedbackFab page="order" />
    </>
  )
}
