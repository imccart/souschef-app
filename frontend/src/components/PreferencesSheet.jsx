import { useState, useEffect } from 'react'
import { api } from '../api/client'
import Sheet from './Sheet'
import ls from '../shared/lists.module.css'
import styles from './PreferencesSheet.module.css'

function AccordionSection({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={styles.prefsAccordion}>
      <button className={styles.prefsAccordionHeader} onClick={() => setOpen(!open)}>
        <span className={styles.prefsAccordionTitle}>{title}</span>
        {count != null && <span className={styles.prefsAccordionCount}>{count}</span>}
        <span className={styles.prefsAccordionArrow}>{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && <div className={styles.prefsAccordionBody}>{children}</div>}
    </div>
  )
}

export default function PreferencesSheet({ onClose }) {
  const [members, setMembers] = useState(null)
  const [householdEmail, setHouseholdEmail] = useState('')
  const [betaEmail, setBetaEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState(null)
  const [betaInviteStatus, setBetaInviteStatus] = useState(null)
  const [userEmail, setUserEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [krogerConnected, setKrogerConnected] = useState(null)
  const [krogerLocationId, setKrogerLocationId] = useState('')
  const [krogerLocationName, setKrogerLocationName] = useState('')
  const [storeZip, setStoreZip] = useState('')
  const [storeResults, setStoreResults] = useState(null)
  const [storeSearching, setStoreSearching] = useState(false)
  const [allowHousehold, setAllowHousehold] = useState(false)
  const [sharedAccountName, setSharedAccountName] = useState(null)
  const [pricePolling, setPricePolling] = useState(false)
  const [priceSharing, setPriceSharing] = useState(false)
  const [showPriceInfo, setShowPriceInfo] = useState(false)

  useEffect(() => {
    api.getMe().then(data => {
      setUserEmail(data.email || '')
      setDisplayName(data.display_name || '')
    }).catch(() => {})
    api.getHouseholdMembers().then(data => setMembers(data.members)).catch(() => {})
    api.getKrogerStatus().then(data => setKrogerConnected(data.connected)).catch(() => setKrogerConnected(false))
    api.getKrogerLocation().then(data => {
      if (data.location_id) setKrogerLocationId(data.location_id)
    }).catch(() => {})
    api.getKrogerHouseholdAccounts().then(data => {
      const accounts = data.accounts || []
      const yours = accounts.find(a => a.is_you)
      if (yours && yours.allow_household != null) setAllowHousehold(yours.allow_household)
      const shared = accounts.find(a => !a.is_you)
      if (!yours && shared) setSharedAccountName(shared.display_name)
    }).catch(() => {})
    api.getPriceTracking().then(data => {
      setPricePolling(data.price_polling || false)
      setPriceSharing(data.price_sharing || false)
    }).catch(() => {})
  }, [])

  const handleHouseholdInvite = async (e) => {
    e.preventDefault()
    if (!householdEmail.trim()) return
    setInviteStatus(null)
    try {
      const result = await api.inviteToHousehold(householdEmail.trim())
      if (result.ok) {
        setHouseholdEmail('')
        setInviteStatus({ type: 'success', msg: 'Invite sent!' })
        const data = await api.getHouseholdMembers()
        setMembers(data.members)
      } else {
        setInviteStatus({ type: 'error', msg: result.error || 'Failed to send' })
      }
    } catch {
      setInviteStatus({ type: 'error', msg: 'Something went wrong' })
    }
  }

  const handleBetaInvite = async (e) => {
    e.preventDefault()
    if (!betaEmail.trim()) return
    setBetaInviteStatus(null)
    try {
      const result = await api.inviteToBeta(betaEmail.trim())
      if (result.ok) {
        setBetaEmail('')
        setBetaInviteStatus({ type: 'success', msg: 'Invite sent!' })
      } else {
        setBetaInviteStatus({ type: 'error', msg: result.error || 'Failed to send' })
      }
    } catch {
      setBetaInviteStatus({ type: 'error', msg: 'Something went wrong' })
    }
  }

  const handleConnectKroger = async () => {
    try {
      const result = await api.connectKroger()
      if (result.url) {
        window.location.href = result.url
      }
    } catch {
      // Kroger credentials not configured on server
    }
  }

  const handleDisconnectKroger = async () => {
    try {
      await api.disconnectKroger()
      setKrogerConnected(false)
    } catch { /* ignore */ }
  }

  const handleSearchStores = async (e) => {
    e.preventDefault()
    if (!storeZip.trim() || storeZip.trim().length < 5) return
    setStoreSearching(true)
    try {
      const data = await api.searchKrogerLocations(storeZip.trim())
      setStoreResults(data.locations || [])
    } catch {
      setStoreResults([])
    }
    setStoreSearching(false)
  }

  const handleSelectStore = async (loc) => {
    try {
      await api.setKrogerLocation(loc.location_id)
      setKrogerLocationId(loc.location_id)
      setKrogerLocationName(loc.name + ' — ' + loc.address)
      setStoreResults(null)
      setStoreZip('')
    } catch { /* ignore */ }
  }

  const handleSaveName = async () => {
    try {
      await api.updateAccount({ display_name: displayName })
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <Sheet onClose={onClose} className={styles.prefsSheet}>
        <div className="sheet-title">Account</div>

        {/* You and Your Household */}
        <AccordionSection title="You and Your Household" count={members?.length || 0}>
          <div className={styles.prefsAccountField}>
            <label className={styles.prefsFieldLabel}>Name</label>
            <div className={ls.addRow}>
              <input
                className={ls.addInput}
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setNameSaved(false) }}
                onBlur={() => displayName.trim() && handleSaveName()}
              />
              {nameSaved && <span className={styles.prefsSaved}>{'\u2713'}</span>}
            </div>
          </div>
          <div className={styles.prefsAccountField}>
            <label className={styles.prefsFieldLabel}>Email</label>
            <div className={styles.prefsFieldValue}>{userEmail}</div>
          </div>
          {members && members.length > 0 && (
            <div className={ls.list} style={{ marginTop: 12 }}>
              {members.map(m => (
                <div key={m.user_id} className={ls.listItem}>
                  <span className={ls.listName}>
                    {m.display_name}{m.is_you ? ' (you)' : ''}
                  </span>
                  <span className={ls.listMeta}>{m.role}</span>
                </div>
              ))}
            </div>
          )}
          <div className={ls.sectionHint}>
            Invite someone to share meals and grocery lists.
          </div>
          <form onSubmit={handleHouseholdInvite} className={ls.addRow}>
            <input
              className={ls.addInput}
              type="email"
              placeholder="Their email..."
              value={householdEmail}
              onChange={(e) => setHouseholdEmail(e.target.value)}
            />
            <button className="btn primary" type="submit">Invite</button>
          </form>
          {inviteStatus && (
            <div className={`${styles.prefsInviteStatus} ${inviteStatus.type === 'success' ? styles.success : styles.error}`}>
              {inviteStatus.msg}
            </div>
          )}
        </AccordionSection>

        {/* Online Store Integrations */}
        <AccordionSection title="Online Store Integrations">
          <div className={styles.prefsIntegrationBlock}>
            {krogerConnected === null ? (
              <div className={ls.listMeta}>Checking connection...</div>
            ) : krogerConnected ? (
              <>
                <div className={styles.prefsIntegrationConnected}>
                  <span className={styles.prefsConnected}>Kroger: Connected {'\u2713'}</span>
                  <button className={styles.prefsDisconnect} onClick={handleDisconnectKroger}>Disconnect</button>
                </div>
                {/* Store location picker */}
                <div className={styles.prefsKrogerStore}>
                  {krogerLocationId ? (
                    <div className={styles.prefsKrogerSelected}>
                      <span className={ls.listMeta}>
                        Store: {krogerLocationName || `#${krogerLocationId}`}
                      </span>
                      <button className={styles.prefsDisconnect} onClick={() => { setKrogerLocationId(''); setKrogerLocationName(''); setStoreResults(null) }}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className={ls.sectionHint} style={{ marginTop: 8 }}>Select your Kroger store</div>
                      <form onSubmit={handleSearchStores} className={ls.addRow}>
                        <input
                          className={ls.addInput}
                          type="text"
                          placeholder="Zip code..."
                          value={storeZip}
                          onChange={(e) => setStoreZip(e.target.value)}
                          maxLength={5}
                          inputMode="numeric"
                        />
                        <button className="btn primary" type="submit" disabled={storeSearching}>
                          {storeSearching ? '...' : 'Search'}
                        </button>
                      </form>
                      {storeResults && storeResults.length === 0 && (
                        <div className={ls.sectionHint}>No stores found near that zip.</div>
                      )}
                      {storeResults && storeResults.length > 0 && (
                        <div className={`${ls.list} ${styles.prefsStoreResults}`}>
                          {storeResults.map(loc => (
                            <div key={loc.location_id} className={`${ls.listItem} ${styles.prefsStoreResult}`} onClick={() => handleSelectStore(loc)}>
                              <div>
                                <div className={ls.listName}>{loc.name}</div>
                                <div className={ls.listMeta}>{loc.address}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {members && members.length > 1 && (
                  <label className={styles.prefsHouseholdToggle}>
                    <input
                      type="checkbox"
                      checked={allowHousehold}
                      onChange={async () => {
                        const next = !allowHousehold
                        setAllowHousehold(next)
                        try { await api.setStoreHouseholdAccess(next) } catch { setAllowHousehold(!next) }
                      }}
                    />
                    <span>Let household members order through this account</span>
                    <div className={styles.prefsToggleHint}>They can place orders using your account and loyalty points.</div>
                  </label>
                )}
              </>
            ) : (
              <>
                {sharedAccountName && (
                  <div className={styles.prefsSharedAccount}>
                    Ordering through {sharedAccountName}'s Kroger account
                  </div>
                )}
                <button className={`btn primary ${styles.prefsIntegrationBtn}`} onClick={handleConnectKroger}>
                  {sharedAccountName ? 'Connect your own account' : 'Connect Kroger Account'}
                </button>
              </>
            )}
          </div>
          <div className={ls.sectionHint}>More integrations coming soon.</div>
        </AccordionSection>

        {/* Price Tracking */}
        <AccordionSection title="Price Tracking">
          <div className={styles.prefsPriceInfo}>
            We check prices on products you've ordered to help you find the best time and place to shop. Your identity is never shared — only anonymized product prices.
          </div>
          <label className={styles.prefsHouseholdToggle}>
            <input
              type="checkbox"
              checked={pricePolling}
              onChange={async () => {
                const next = !pricePolling
                setPricePolling(next)
                try { await api.setPriceTracking({ price_polling: next }) } catch { setPricePolling(!next) }
              }}
            />
            <span>Track prices for me</span>
            <div className={styles.prefsToggleHint}>We'll check prices on your regular items throughout the day using your store account.</div>
          </label>
          <label className={styles.prefsHouseholdToggle}>
            <input
              type="checkbox"
              checked={priceSharing}
              onChange={async () => {
                const next = !priceSharing
                setPriceSharing(next)
                try { await api.setPriceTracking({ price_sharing: next }) } catch { setPriceSharing(!next) }
              }}
            />
            <span>Share anonymous pricing data</span>
            <div className={styles.prefsToggleHint}>Help other souschef users find better prices. We share product prices (not your identity or purchase history) with the community.</div>
          </label>
        </AccordionSection>

        {/* Behind the Label */}
        <AccordionSection title="Behind the Label">
          <div className={ls.list}>
            <div className={ls.listItem}>
              <span className={ls.listName}>NOVA processing scores</span>
              <span className={ls.listMeta}>On</span>
            </div>
            <div className={styles.prefsBtlInfo}>
              Classifies foods by processing level (1 = unprocessed, 4 = ultra-processed). Data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a>.
            </div>
            <div className={ls.listItem}>
              <span className={ls.listName}>Nutri-Score</span>
              <span className={ls.listMeta}>On</span>
            </div>
            <div className={styles.prefsBtlInfo}>
              Rates overall nutritional quality from A (best) to E. Data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">Open Food Facts</a>.
            </div>
            <div className={ls.listItem}>
              <span className={ls.listName}>Brand ownership</span>
              <span className={ls.listMeta}>On</span>
            </div>
            <div className={styles.prefsBtlInfo}>
              Shows the parent company behind each brand, so you know who you're buying from.
            </div>
          </div>
        </AccordionSection>

        {/* Invite a Friend */}
        <AccordionSection title="Invite a Friend">
          <div className={ls.sectionHint}>
            Know someone who'd like souschef? Give them their own account.
          </div>
          <form onSubmit={handleBetaInvite} className={ls.addRow}>
            <input
              className={ls.addInput}
              type="email"
              placeholder="Their email..."
              value={betaEmail}
              onChange={(e) => setBetaEmail(e.target.value)}
            />
            <button className="btn primary" type="submit">Send</button>
          </form>
          {betaInviteStatus && (
            <div className={`${styles.prefsInviteStatus} ${betaInviteStatus.type === 'success' ? styles.success : styles.error}`}>
              {betaInviteStatus.msg}
            </div>
          )}
        </AccordionSection>

        {/* Sign Out */}
        <button className={styles.prefsSignOut} onClick={async () => {
          await api.logout()
          localStorage.removeItem('souschef_onboarded')
          localStorage.removeItem('souschef_welcomed')
          window.location.reload()
        }}>
          Sign out
        </button>

        {/* Terms */}
        <div className={styles.prefsTermsLinks}>
          <a href="/app/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          <span className={styles.prefsDot}>{'\u00B7'}</span>
          <a href="/app/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </div>

        {/* About */}
        <div className={styles.prefsAbout}>
          <div className={styles.brandName}>sous<em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>chef</em></div>
          <div style={{ marginTop: '4px' }}>by Aletheia</div>
          <div className={styles.prefsVersion}>v0.1.0</div>
        </div>
    </Sheet>
  )
}
