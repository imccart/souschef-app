import { useState, useEffect } from 'react'
import { api } from '../api/client'
import ladleImg from '../assets/ladle.png'

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
    <div className="login">
      <div className="login-card">
        <img className="login-ladle" src={ladleImg} alt="" />
        <div className="login-wordmark">sous<em>chef</em></div>

        {waitlist ? (
          <div className="login-sent">
            <div className="login-sent-title">No Stairway. Denied!</div>
            <div className="login-sent-desc">
              Souschef is in early access. We'll let you know when there's a spot for you.
            </div>
            <button
              className="login-resend"
              onClick={() => { setWaitlist(false); setEmail('') }}
            >
              Try a different email
            </button>
          </div>
        ) : sent ? (
          <div className="login-sent">
            <div className="login-sent-icon">{'\u2709\uFE0F'}</div>
            <div className="login-sent-title">Check your inbox</div>
            <div className="login-sent-desc">
              We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
            </div>
            <button
              className="login-resend"
              onClick={() => { setSent(false); setEmail('') }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className="login-desc">
              Sign in with your email to continue.
            </div>

            {expired && (
              <div className="login-error">That link has expired. Please request a new one.</div>
            )}
            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
              <input
                className="login-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              <button
                className="login-btn"
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
