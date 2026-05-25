import { useEffect, useState } from 'react'
import { api } from '../api/client'
import styles from './AdminStats.module.css'

function money(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function userStatus(r) {
  if (r.active) return 'active'
  if (r.last_login) return 'signed out'
  return 'not logged in'
}

export default function AdminStats() {
  const [m, setM] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)        // detail key currently expanded
  const [details, setDetails] = useState({})    // key -> rows cache
  const [detailErr, setDetailErr] = useState(null)

  const load = async () => {
    try {
      const data = await api.getAdminMetrics()
      if (data?.error) { setError(data.error); return }
      setM(data.metrics || {})
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load metrics')
    }
  }

  useEffect(() => { load() }, [])

  const fetchDetail = async (key) => {
    try {
      const d = await api.getAdminDetail(key)
      if (d?.error) { setDetailErr(d.error); return }
      setDetails(prev => ({ ...prev, [key]: d.rows || [] }))
    } catch (e) {
      setDetailErr(e.message || 'Failed to load')
    }
  }

  const openDetail = async (key) => {
    if (open === key) { setOpen(null); return }
    setOpen(key)
    setDetailErr(null)
    if (!details[key]) await fetchDetail(key)
  }

  // Run a management action, then refresh the affected list + the top-line counts.
  const runAction = async (call, key) => {
    setDetailErr(null)
    try {
      const res = await call()
      if (res?.error) { setDetailErr(res.error); return }
      await fetchDetail(key)
      load()
    } catch (e) {
      setDetailErr(e.message || 'Action failed')
    }
  }

  const actions = {
    approve: (email) => runAction(() => api.approveWaitlist(email), 'waitlist'),
    dismiss: (email) => runAction(() => api.dismissWaitlist(email), 'waitlist'),
    cancelInvite: (id) => runAction(() => api.cancelInvite(id), 'invites'),
    revoke: (email) => runAction(() => api.revokeUser(email), 'users'),
    del: (email) => runAction(() => api.deleteUserAdmin(email), 'users'),
  }

  if (error) return (
    <div className={styles.error}>
      {error}
      <button className={styles.retry} onClick={() => { setM(null); setError(null); load() }}>Retry</button>
    </div>
  )
  if (!m) return <div className={styles.empty}>Loading…</div>

  const usersSub = `${m.active_signed_in} active · ${m.pending_activation} not logged in`
    + (m.users_new_7d > 0 ? ` · ${m.users_new_7d} new this wk` : '')
  const tipsSub = money(m.tips_cents)
    + (m.tip_subscribers > 0 ? ` · ${m.tip_subscribers} monthly` : '')

  const groups = [
    {
      title: 'Overview',
      tiles: [
        { label: 'Users', value: m.users_total, sub: usersSub, detail: 'users' },
        { label: 'Households', value: m.households, detail: 'households' },
        { label: 'Waitlist', value: m.waitlist, detail: 'waitlist' },
        { label: 'Invites sent', value: m.invites_sent, sub: `${m.invites_accepted ?? 0} accepted`, detail: 'invites' },
      ],
    },
    {
      title: 'Engagement (last 7 days)',
      tiles: [
        { label: 'Kroger linked', value: m.kroger_linked, detail: 'kroger' },
        { label: 'Meals planned', value: m.meals_planned_7d },
        { label: 'Grocery items added', value: m.grocery_items_7d },
        { label: 'Receipts parsed', value: m.receipts_7d },
      ],
    },
    {
      title: 'Support & money',
      tiles: [
        { label: 'Open feedback', value: m.open_feedback, alert: m.open_feedback > 0 },
        { label: 'Tips received', value: m.tips_total, sub: tipsSub, detail: 'tips' },
      ],
    },
  ]

  const tileBody = (t) => (
    <>
      <div className={styles.value}>{t.raw ? t.value : (t.value ?? 0)}</div>
      <div className={styles.label}>{t.label}</div>
      {t.sub && <div className={styles.sub}>{t.sub}</div>}
    </>
  )

  return (
    <div className={styles.wrap}>
      {groups.map(g => (
        <div key={g.title} className={styles.group}>
          <div className={styles.groupTitle}>{g.title}</div>
          <div className={styles.grid}>
            {g.tiles.map(t => (
              t.detail ? (
                <button
                  key={t.label}
                  className={`${styles.tile} ${styles.clickable} ${open === t.detail ? styles.active : ''}`}
                  onClick={() => openDetail(t.detail)}
                >
                  {tileBody(t)}
                  <span className={styles.chev}>{open === t.detail ? '▾' : '›'}</span>
                </button>
              ) : (
                <div key={t.label} className={`${styles.tile} ${t.alert ? styles.alert : ''}`}>
                  {tileBody(t)}
                </div>
              )
            ))}
          </div>
          {g.tiles.some(t => t.detail === open) && (
            <Detail keyName={open} rows={details[open]} error={detailErr} actions={actions} />
          )}
        </div>
      ))}
      <div className={styles.footer}>
        <button className={styles.refresh} onClick={load}>Refresh</button>
      </div>
    </div>
  )
}

function Detail({ keyName, rows, error, actions }) {
  if (error) return <div className={styles.detail}><div className={styles.detailEmpty}>{error}</div></div>
  if (rows === undefined) return <div className={styles.detail}><div className={styles.detailEmpty}>Loading…</div></div>
  if (!rows.length) return <div className={styles.detail}><div className={styles.detailEmpty}>None.</div></div>

  if (keyName === 'households') {
    return (
      <div className={styles.detail}>
        {rows.map((h, i) => (
          <div key={h.household_id || i} className={styles.hhBlock}>
            <div className={styles.hhTitle}>{h.owner_email || h.household_id}</div>
            {h.members.map(mb => (
              <div key={mb.email} className={styles.detailRow}>
                <span className={styles.detailPrimary}>{mb.email}</span>
                <span className={styles.detailSecondary}>{mb.role}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const secondaryFor = (r) => {
    if (keyName === 'users') return userStatus(r) + (r.household_role ? ` · ${r.household_role}` : '')
    if (keyName === 'waitlist') return fmtDate(r.requested_at)
    if (keyName === 'invites') return r.status + (r.invited_by ? ` · by ${r.invited_by}` : '')
    if (keyName === 'tips') return `${money(r.amount_cents)} · ${r.mode} · ${fmtDate(r.created_at)}`
    return ''  // kroger: email only
  }

  const buttonsFor = (r) => {
    if (keyName === 'waitlist') return (
      <>
        <button className={styles.actBtn} onClick={() => actions.approve(r.email)}>Approve</button>
        <button className={styles.actBtn} onClick={() => actions.dismiss(r.email)}>Dismiss</button>
      </>
    )
    if (keyName === 'invites' && r.status === 'pending') return (
      <button className={styles.actBtn} onClick={() => {
        if (window.confirm(`Cancel the invite to ${r.email}?`)) actions.cancelInvite(r.id)
      }}>Cancel</button>
    )
    if (keyName === 'users' && !r.protected) return (
      <>
        <button className={styles.actBtn} onClick={() => {
          if (window.confirm(`Revoke access for ${r.email}? They'll be signed out and blocked from logging back in. Their data is kept and you can re-approve later.`)) actions.revoke(r.email)
        }}>Revoke</button>
        <button className={styles.actDanger} onClick={() => {
          if (window.confirm(`Permanently delete ${r.email} and ALL their data? This cannot be undone.`)) actions.del(r.email)
        }}>Delete</button>
      </>
    )
    return null
  }

  return (
    <div className={styles.detail}>
      {rows.map((r, i) => {
        const secondary = secondaryFor(r)
        const btns = buttonsFor(r)
        return (
          <div key={(r.email || '') + i} className={styles.detailRow}>
            <span className={styles.detailPrimary}>{r.email}</span>
            <span className={styles.detailRight}>
              {secondary && <span className={styles.detailSecondary}>{secondary}</span>}
              {btns}
            </span>
          </div>
        )
      })}
    </div>
  )
}
