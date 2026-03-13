import { useState, useEffect, useCallback } from 'react'
import { api } from './api/client'
import Nav from './components/Nav'
import PlanPage from './components/PlanPage'
import GroceryPage from './components/GroceryPage'
import OrderPage from './components/OrderPage'
import ReceiptPage from './components/ReceiptPage'
import PreferencesSheet from './components/PreferencesSheet'
import OnboardingFlow, { WelcomeScreen } from './components/OnboardingFlow'
import LoginPage from './components/LoginPage'
import HouseholdInvitePrompt from './components/HouseholdInvitePrompt'

function useIsWide(breakpoint = 1024) {
  const [wide, setWide] = useState(window.innerWidth >= breakpoint)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const handler = (e) => setWide(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return wide
}

function formatDateRange(start, end) {
  if (!start || !end) return null
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' })
  if (sMonth === eMonth) {
    return { text: `${sMonth} ${s.getDate()}`, endText: `${e.getDate()}` }
  }
  return { text: `${sMonth} ${s.getDate()}`, endText: `${eMonth} ${e.getDate()}` }
}

function App() {
  const [page, setPage] = useState('plan')
  const [showPrefs, setShowPrefs] = useState(false)
  const [authed, setAuthed] = useState(null)
  const [onboardingDone, setOnboardingDone] = useState(null)
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem('souschef_welcomed') === 'true')
  const [pendingInvite, setPendingInvite] = useState(null) // { inviter_name } or null
  const [inviteChecked, setInviteChecked] = useState(false)
  const isWide = useIsWide()
  const [mealData, setMealData] = useState(null)

  const handlePlanLoad = useCallback((data) => setMealData(data), [])

  useEffect(() => {
    api.getMe()
      .then(() => {
        setAuthed(true)
        // Check for pending household invite
        api.getPendingInvite().then(data => {
          if (data.invite) {
            setPendingInvite(data.invite)
          }
          setInviteChecked(true)
        }).catch(() => setInviteChecked(true))
        // Fast path: skip round trip if localStorage says onboarded
        if (localStorage.getItem('souschef_onboarded') === 'true') {
          setOnboardingDone(true)
          return
        }
        // Authoritative check from DB
        return api.getOnboardingStatus()
          .then(data => {
            setOnboardingDone(data.completed)
            if (data.completed) localStorage.setItem('souschef_onboarded', 'true')
          })
      })
      .catch(() => {
        setAuthed(false)
        setOnboardingDone(false)
        setInviteChecked(true)
      })
  }, [])

  const dateRange = mealData ? formatDateRange(mealData.start_date, mealData.end_date) : null

  if (authed === null) {
    return <div className="loading" style={{ paddingTop: '40vh' }}>Setting the table...</div>
  }

  // Welcome → Login → Onboarding → App
  if (!authed && !welcomed) {
    return <WelcomeScreen onStart={() => {
      localStorage.setItem('souschef_welcomed', 'true')
      setWelcomed(true)
    }} />
  }

  if (!authed) {
    return <LoginPage />
  }

  if (!onboardingDone) {
    return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />
  }

  // Show household invite prompt if pending
  if (inviteChecked && pendingInvite) {
    return <HouseholdInvitePrompt
      inviterName={pendingInvite.inviter_name}
      onResolved={() => {
        setPendingInvite(null)
        // Reload to pick up new household context
        window.location.reload()
      }}
    />
  }

  return (
    <div className="app">
      <Nav page={page} setPage={setPage} prefsOpen={showPrefs} onTogglePrefs={() => setShowPrefs(p => !p)} isWide={isWide} />
      <main>
        {isWide && (page === 'plan' || page === 'grocery') ? (
          <>
            {dateRange && (
              <>
                <div className="page-header">
                  <div className="date-range-big">
                    {dateRange.text} <em>&ndash;</em> {dateRange.endText}
                  </div>
                  <div className="date-subtitle">Your next 10 days</div>
                </div>
              </>
            )}
            <div className="two-col">
              <div className="col-plan"><PlanPage showHeader={false} onLoad={handlePlanLoad} onNavigate={setPage} /></div>
              <div className="col-grocery"><GroceryPage sidebar /></div>
            </div>
          </>
        ) : (
          <>
            {page === 'plan' && <PlanPage onNavigate={setPage} />}
            {page === 'grocery' && <GroceryPage />}
          </>
        )}
        {page === 'order' && <OrderPage />}
        {page === 'receipt' && <ReceiptPage />}
      </main>
      <nav className="bottom-nav">
        <div className={`nav-tab${page === 'plan' ? ' active' : ''}`} onClick={() => setPage('plan')}>
          <div className="nav-tab-icon">{'\u{1F5D3}'}</div>
          <div className="nav-tab-label">Plan</div>
        </div>
        {!isWide && (
          <div className={`nav-tab${page === 'grocery' ? ' active' : ''}`} onClick={() => setPage('grocery')}>
            <div className="nav-tab-icon">{'\u{1F6D2}'}</div>
            <div className="nav-tab-label">Grocery</div>
          </div>
        )}
        <div className={`nav-tab${page === 'order' ? ' active' : ''}`} onClick={() => setPage('order')}>
          <div className="nav-tab-icon">{'\u{1F4E6}'}</div>
          <div className="nav-tab-label">Order</div>
        </div>
        <div className={`nav-tab${page === 'receipt' ? ' active' : ''}`} onClick={() => setPage('receipt')}>
          <div className="nav-tab-icon">{'\u{1F9FE}'}</div>
          <div className="nav-tab-label">Receipt</div>
        </div>
      </nav>

      {showPrefs && <PreferencesSheet onClose={() => setShowPrefs(false)} />}
    </div>
  )
}

export default App
