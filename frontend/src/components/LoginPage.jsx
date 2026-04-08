import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import runnerRImg from '../assets/runner-r.png'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [waitlist, setWaitlist] = useState(false)
  const [error, setError] = useState(null)
  const googleBtnRef = useRef(null)

  // Check for expired magic link and clean up the URL
  const [expired] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'expired') {
      window.history.replaceState({}, '', window.location.pathname)
      return true
    }
    return false
  })

  // Initialize Google Sign-In button
  useEffect(() => {
    let cancelled = false
    async function initGoogle() {
      try {
        const { client_id } = await api.googleClientId()
        if (cancelled || !client_id || !googleBtnRef.current) return
        // Wait for GIS script to load
        const waitForGoogle = () => new Promise((resolve) => {
          if (window.google?.accounts?.id) return resolve()
          const check = setInterval(() => {
            if (window.google?.accounts?.id) { clearInterval(check); resolve() }
          }, 100)
        })
        await waitForGoogle()
        if (cancelled) return
        window.google.accounts.id.initialize({
          client_id,
          callback: async (response) => {
            setError(null)
            try {
              const result = await api.googleAuth(response.credential)
              if (result.waitlist) {
                setWaitlist(true)
              } else if (result.ok) {
                window.location.reload()
              }
            } catch {
              setError('Google sign-in failed')
            }
          },
        })
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
          text: 'signin_with',
        })
      } catch { /* Google auth unavailable — magic link still works */ }
    }
    initGoogle()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setError(null)
    try {
      const result = await api.login(email.trim())
      if (result.sent) {
        setSent(true)
      } else if (result.waitlist) {
        setWaitlist(true)
      } else {
        setError(result.error || 'Something went wrong')
      }
    } catch {
      setError('Could not reach the server')
    }
    setSending(false)
  }

  return (
    <div className={styles.login}>
      <div className={styles.card}>
        <div className={styles.wordmark}>meal<img className={styles.runnerR} src={runnerRImg} alt="" /><em>unner</em></div>
        <div className={styles.tagline}>From planning to pantry.</div>

        {waitlist ? (
          <div className={styles.sent}>
            <div className={styles.sentTitle}>No Stairway. Denied!</div>
            <div className={styles.sentDesc}>
              MealRunner is in early access. We'll let you know when there's a spot for you.
            </div>
            <button
              className={styles.resend}
              onClick={() => { setWaitlist(false); setEmail('') }}
            >
              Try a different email
            </button>
          </div>
        ) : sent ? (
          <div className={styles.sent}>
            <div className={styles.sentIcon}>{'\u2709\uFE0F'}</div>
            <div className={styles.sentTitle}>Check your inbox</div>
            <div className={styles.sentDesc}>
              We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
            </div>
            <button
              className={styles.resend}
              onClick={() => { setSent(false); setEmail('') }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className={styles.desc}>
              Sign in with your email to continue.
            </div>

            {expired && (
              <div className={styles.error}>That link has expired. Please request a new one.</div>
            )}
            {error && <div className={styles.error}>{error}</div>}

            <div ref={googleBtnRef} className={styles.googleBtn} />

            <div className={styles.divider}>
              <span>or</span>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <input
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button
                className={styles.btn}
                type="submit"
                disabled={sending || !email.trim()}
              >
                {sending ? 'Sending...' : 'Send sign-in link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
