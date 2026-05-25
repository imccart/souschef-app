import { useEffect, useState } from 'react'
import { api } from '../api/client'
import styles from './AdminFeedback.module.css'

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function AdminFeedback({ embedded = false }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('open')
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState({})

  const load = async () => {
    try {
      const data = await api.getAllFeedback()
      if (data?.error) {
        setError(data.error)
        setItems([])
        return
      }
      setItems(data.feedback || [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load feedback')
      setItems([])
    }
  }

  useEffect(() => { load() }, [])

  const handleSend = async (id) => {
    const draft = (drafts[id] || '').trim()
    if (!draft) return
    setSending(s => ({ ...s, [id]: true }))
    try {
      const res = await api.respondToFeedback(id, draft)
      if (res?.error) {
        setError(res.error)
      } else {
        setDrafts(d => { const n = { ...d }; delete n[id]; return n })
        await load()
      }
    } catch (e) {
      setError(e.message || 'Failed to send response')
    } finally {
      setSending(s => { const n = { ...s }; delete n[id]; return n })
    }
  }

  // "Open" = needs attention: not dismissed and not already responded/resolved.
  const HANDLED = ['responded', 'resolved', 'dismissed']
  const isOpen = (it) => !it.dismissed && !HANDLED.includes(it.status)

  const filtered = (items || []).filter(it => {
    if (filter === 'all') return true
    if (filter === 'open') return isOpen(it)
    if (filter === 'handled') return !isOpen(it)
    return true
  })

  const counts = (items || []).reduce((acc, it) => {
    acc.all += 1
    if (isOpen(it)) acc.open += 1
    else acc.handled += 1
    return acc
  }, { all: 0, open: 0, handled: 0 })

  const inner = (
    <>
        <div className={styles.tabs}>
          {['open', 'handled', 'all'].map(t => (
            <button
              key={t}
              className={`${styles.tab} ${filter === t ? styles.active : ''}`}
              onClick={() => setFilter(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)} ({counts[t]})
            </button>
          ))}
        </div>

        {error && (
          <div className={styles.error}>
            {error}
            <button className={styles.retry} onClick={() => { setItems(null); load() }}>Retry</button>
          </div>
        )}

        {items === null && !error && (
          <div className={styles.empty}>Loading…</div>
        )}

        {items !== null && filtered.length === 0 && !error && (
          <div className={styles.empty}>Nothing here.</div>
        )}

        {filtered.map(it => (
          <div key={it.id} className={styles.item}>
            <div className={styles.itemHeader}>
              <span className={styles.email}>{it.email}</span>
              <span className={styles.meta}>
                {it.page && <span className={styles.pageTag}>{it.page}</span>}
                <span>{formatWhen(it.created_at)}</span>
              </span>
            </div>
            <div className={styles.message}>{it.message}</div>

            {it.status === 'responded' ? (
              <>
                <div className={styles.response}>{it.response}</div>
                <div className={styles.responseMeta}>
                  Responded {formatWhen(it.responded_at)}
                </div>
              </>
            ) : (
              <div className={styles.composer}>
                <textarea
                  className={styles.textarea}
                  placeholder="Write a response…"
                  value={drafts[it.id] || ''}
                  onChange={e => setDrafts(d => ({ ...d, [it.id]: e.target.value }))}
                />
                <div className={styles.composerActions}>
                  <button
                    className={styles.send}
                    disabled={sending[it.id] || !(drafts[it.id] || '').trim()}
                    onClick={() => handleSend(it.id)}
                  >
                    {sending[it.id] ? 'Sending…' : 'Send response'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
    </>
  )

  if (embedded) return inner

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>User feedback</h1>
          <button className={styles.exit} onClick={() => {
            history.replaceState(null, '', window.location.pathname + window.location.search)
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          }}>
            Back to app
          </button>
        </div>
        {inner}
      </div>
    </div>
  )
}
