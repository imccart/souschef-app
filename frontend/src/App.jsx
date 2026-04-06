import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from './api/client'
import Nav from './components/Nav'
import useSwipeNav from './hooks/useSwipeNav'
import PlanPage from './components/PlanPage'
import GroceryPage from './components/GroceryPage'
import OrderPage from './components/OrderPage'
import ReceiptPage from './components/ReceiptPage'
import PreferencesSheet from './components/PreferencesSheet'
import MyKitchenSheet from './components/MyKitchenSheet'
import OnboardingFlow, { WelcomeScreen } from './components/OnboardingFlow'
import LoginPage from './components/LoginPage'
import HouseholdInvitePrompt from './components/HouseholdInvitePrompt'
import { CrashTest } from './components/ErrorBoundary'
import TourOverlay from './components/TourOverlay'

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
  const [showKitchen, setShowKitchen] = useState(false)
  const [authed, setAuthed] = useState(null)
  const [onboardingDone, setOnboardingDone] = useState(null)
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem('mealrunner_welcomed') === 'true')
  const [pendingInvite, setPendingInvite] = useState(null) // { inviter_name } or null
  const [householdInfo, setHouseholdInfo] = useState(null) // { household_member, household_owner_name } or null
  const [inviteChecked, setInviteChecked] = useState(false)
  const isWide = useIsWide()
  const [tourActive, setTourActive] = useState(false)
  const [mealData, setMealData] = useState(null)
  const [feedbackResponses, setFeedbackResponses] = useState([])
  const mobilePages = useMemo(() => ['plan', 'grocery', 'order', 'receipt'], [])
  const swipeHandlers = useSwipeNav(mobilePages, page, setPage)

  const [groceryVersion, setGroceryVersion] = useState(0)
  const handlePlanLoad = useCallback((data) => {
    setMealData(data)
    setGroceryVersion(v => v + 1)
  }, [])

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
        // Check for feedback responses (always, regardless of onboarding state)
        api.getFeedbackResponses().then(data => {
          if (data.responses?.length) setFeedbackResponses(data.responses)
        }).catch(() => {})
        // Fast path: skip round trip if localStorage says onboarded
        if (localStorage.getItem('mealrunner_onboarded') === 'true') {
          setOnboardingDone(true)
          return
        }
        // Authoritative check from DB
        return api.getOnboardingStatus()
          .then(data => {
            setOnboardingDone(data.completed)
            if (data.completed) localStorage.setItem('mealrunner_onboarded', 'true')
            if (data.household_member) setHouseholdInfo({ ownerName: data.household_owner_name })
          })
      })
      .catch(() => {
        setAuthed(false)
        setOnboardingDone(false)
        setInviteChecked(true)
      })
  }, [])

  const dateRange = mealData ? formatDateRange(mealData.start_date, mealData.end_date) : null

  // Test route: getmealrunner.app/app#oops
  if (window.location.hash === '#oops') {
    return <CrashTest />
  }

  if (authed === null) {
    return <div className="loading" style={{ paddingTop: '40vh' }}>Setting the table...</div>
  }

  // Welcome → Login → Onboarding → App
  if (!authed && !welcomed) {
    return <WelcomeScreen onStart={() => {
      localStorage.setItem('mealrunner_welcomed', 'true')
      setWelcomed(true)
    }} />
  }

  if (!authed) {
    return <LoginPage />
  }

  // Show household invite prompt before onboarding — invited members
  // skip onboarding entirely (they join an existing household's data)
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

  if (!onboardingDone) {
    return <OnboardingFlow onComplete={() => { setOnboardingDone(true); setTourActive(true) }} householdInfo={householdInfo} />
  }

  return (
    <div className="app">
      <Nav page={page} setPage={setPage} kitchenOpen={showKitchen} onToggleKitchen={() => setShowKitchen(k => !k)} prefsOpen={showPrefs} onTogglePrefs={() => setShowPrefs(p => !p)} isWide={isWide} />
      <main {...(!isWide ? { onTouchStart: swipeHandlers.onTouchStart, onTouchMove: swipeHandlers.onTouchMove, onTouchEnd: swipeHandlers.onTouchEnd } : {})} style={!isWide ? swipeHandlers.style : undefined}>
        {feedbackResponses.map(fr => (
          <div key={fr.id} className="feedback-response-banner">
            <div className="feedback-response-text">{fr.response}</div>
            <button className="feedback-response-dismiss" onClick={async () => {
              try { await api.dismissFeedbackResponse(fr.id) } catch {}
              setFeedbackResponses(prev => prev.filter(r => r.id !== fr.id))
            }}>Yes, Chef!</button>
          </div>
        ))}
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
              <div className="col-grocery" data-tour="grocery-sidebar"><GroceryPage sidebar key={`grocery-${groceryVersion}`} /></div>
            </div>
          </>
        ) : (
          <>
            {page === 'plan' && <PlanPage onNavigate={setPage} />}
            {page === 'grocery' && <GroceryPage key={`grocery-${groceryVersion}`} />}
          </>
        )}
        {page === 'order' && <OrderPage />}
        {page === 'receipt' && <ReceiptPage />}
      </main>
      <nav className="bottom-nav">
        <div className={`nav-tab${page === 'plan' ? ' active' : ''}`} data-tour="plan-tab" onClick={() => setPage('plan')}>
          <div className="nav-tab-icon">{'\u{1F5D3}'}</div>
          <div className="nav-tab-label">Plan</div>
        </div>
        {!isWide && (
          <div className={`nav-tab${page === 'grocery' ? ' active' : ''}`} data-tour="grocery-tab" onClick={() => setPage('grocery')}>
            <div className="nav-tab-icon">{'\u{1F6D2}'}</div>
            <div className="nav-tab-label">Grocery</div>
          </div>
        )}
        <div className={`nav-tab${page === 'order' ? ' active' : ''}`} data-tour="order-tab" onClick={() => setPage('order')}>
          <div className="nav-tab-icon">{'\u{1F697}'}</div>
          <div className="nav-tab-label">Order</div>
        </div>
        <div className={`nav-tab${page === 'receipt' ? ' active' : ''}`} data-tour="receipt-tab" onClick={() => setPage('receipt')}>
          <div className="nav-tab-icon">{'\u{1F9FE}'}</div>
          <div className="nav-tab-label">Receipt</div>
        </div>
      </nav>

      {showKitchen && <MyKitchenSheet onClose={() => setShowKitchen(false)} />}
      {showPrefs && <PreferencesSheet onClose={() => setShowPrefs(false)} onStartTour={() => { setShowPrefs(false); setTourActive(true) }} />}
      {tourActive && <TourOverlay onComplete={() => setTourActive(false)} />}
    </div>
  )
}

export default App
