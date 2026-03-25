import { useState, useEffect } from 'react'
import { api } from '../api/client'
import ladleImg from '../assets/ladle.png'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [waitlist, setWaitlist] = useState(false)
  const [error, setError] = useState(null)

  // Check for expired magic link and clean up the URL
  const [expired] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'expired') {
      window.history.replaceState({}, '', window.location.pathname)
      return true
    }
    return false
  })

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
        <img className={styles.ladle} src={ladleImg} alt="" />
        <div className={styles.wordmark}>sous<em>chef</em></div>

        {waitlist ? (
          <div className={styles.sent}>
            <div className={styles.sentTitle}>No Stairway. Denied!</div>
            <div className={styles.sentDesc}>
              Souschef is in early access. We'll let you know when there's a spot for you.
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

            <form onSubmit={handleSubmit} className={styles.form}>
              <input
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
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
