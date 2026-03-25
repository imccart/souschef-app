import { useState } from 'react'
import { api } from '../api/client'
import styles from './HouseholdInvitePrompt.module.css'

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
    <div className={styles.prompt}>
      <div className={styles.card}>
        <div className={styles.icon}>{'\u{1F3E0}'}</div>
        <h2 className={styles.title}>You've been invited</h2>
        <p className={styles.body}>
          <strong>{inviterName}</strong> invited you to their household.
          You'll share meals and grocery lists.
        </p>
        <div className={styles.actions}>
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
