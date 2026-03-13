import { useState } from 'react'
import { api } from '../api/client'

export default function HouseholdInvitePrompt({ inviterName, onResolved }) {
  const [busy, setBusy] = useState(false)

  const handleAccept = async () => {
    setBusy(true)
    await api.acceptInvite()
    onResolved('accepted')
  }

  const handleDecline = async () => {
    setBusy(true)
    await api.declineInvite()
    onResolved('declined')
  }

  return (
    <div className="invite-prompt">
      <div className="invite-card">
        <div className="invite-icon">{'\u{1F3E0}'}</div>
        <h2 className="invite-title">You've been invited</h2>
        <p className="invite-body">
          <strong>{inviterName}</strong> invited you to their household.
          You'll share meals and grocery lists.
        </p>
        <div className="invite-actions">
          <button className="btn primary" onClick={handleAccept} disabled={busy}>
            Join
          </button>
          <button className="btn" onClick={handleDecline} disabled={busy}>
            No thanks
          </button>
        </div>
      </div>
    </div>
  )
}
