import { useState } from 'react'
import { useApp } from '../appContext.js'
import { dayDate, currentDayNumber } from '../lib/challenge.js'
import DayProof from './DayProof.jsx'
import Sheet from './Sheet.jsx'
import Icon from './Icons.jsx'

export default function History() {
  const { participants, summaries, cfg, reqsFor, logsFor, daysFor, me, myMember, isReferee, actions, t } = useApp()
  const dayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  const [sel, setSel] = useState(null) // { p, n, date, log }
  const [extending, setExtending] = useState(false)

  return (
    <div>
      {/* No title — the History tab is the title (Miska). One hint line only. */}
      <div className="screen-head">
        <div className="screen-sub">Tap a day to see the details.</div>
      </div>

      {participants.map((p) => {
        const s = summaries[p.userId]
        if (!s) return null
        const pDays = daysFor(p.userId)
        const mine = p.userId === me.id && !isReferee
        return (
          <div key={p.id} style={{ marginBottom: 22 }}>
            <div className="hist-person">
              <span className="hist-name"><span className="vs-dot" style={{ background: p.accent }} />{p.displayName}</span>
              <span className="chip chip-green">{s.approved} done{p.totalDays ? ` · ${pDays}-day run` : ''}</span>
            </div>
            <div className="cal-grid">
              {Array.from({ length: pDays }, (_, i) => i + 1).map((n) => {
                const date = dayDate(cfg.startStr, n)
                const state = s.states[n]
                const log = s.logsByDate[date]
                const isToday = date === cfg.todayStr
                // My own past/today cells are always openable (even with no log)
                // so I can backfill a meal I logged late; others' need a log.
                const openable = log || (mine && n <= dayNum && n >= 1)
                return (
                  <button key={n} className={`cal-cell ${state}${log ? ' has' : ''}${isToday ? ' today' : ''}`}
                    onClick={() => openable && setSel({ p, n, date, log })} title={`Day ${n} · ${date}`}>
                    {n}
                  </button>
                )
              })}
              {mine && (
                <button className="cal-cell add" onClick={() => setExtending(true)} title="Add days to my run">
                  <Icon name="plus" size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>
            {mine && (
              <button className="add-days-cap" onClick={() => setExtending(true)}>+ add days to my run</button>
            )}
          </div>
        )
      })}

      <div className="legend">
        <span><i style={{ background: 'var(--green)' }} />Approved</span>
        <span><i style={{ background: 'var(--amber)' }} />Awaiting referee</span>
        <span><i style={{ background: 'var(--red)' }} />Failed</span>
        {/* Only shown once someone has actually spent a save — no point
            explaining a state nobody in this challenge is in. */}
        {participants.some((p) => summaries[p.userId]?.excused > 0) && (
          <span><i style={{ background: 'var(--blue)' }} />Saved</span>
        )}
        <span><i style={{ background: 'var(--panel-3)', border: '1px solid var(--text)' }} />Today</span>
      </div>

      {sel && (
        <DayProof profile={sel.p} reqs={reqsFor(sel.p.userId)} dayNumber={sel.n} date={sel.date}
          // Live log (not the tap-time snapshot) so a meal backfilled in the
          // sheet re-renders its macros immediately.
          log={logsFor(sel.p.userId).find((l) => l.logDate === sel.date) || sel.log}
          cfg={cfg} totalDays={daysFor(sel.p.userId)} onClose={() => setSel(null)} />
      )}
      {extending && (
        <AddDays current={daysFor(me.id)} memberId={myMember.id} cfg={cfg} t={t}
          refresh={actions.refresh} update={actions.updateMyMember} onClose={() => setExtending(false)} />
      )}
    </div>
  )
}

// Self-serve run extension: additive only — you can add days to your own run,
// never shorten it or touch anyone else's.
function AddDays({ current, memberId, cfg, t, refresh, update, onClose }) {
  const [extra, setExtra] = useState(15)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const clean = Math.max(1, Math.min(90, Math.round(Number(extra) || 0)))
  const newTotal = Math.min(365, current + clean)
  const finishDate = dayDate(cfg.startStr, newTotal)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      await update(memberId, { totalDays: newTotal })
      await refresh()
      onClose()
    } catch (e) {
      setErr(/total_days/.test(e.message || '') ? 'This feature needs a quick server update — ping Kyle.' : e.message)
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Extend my run</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        {t('history.extend.sub')}
      </p>
      <div className="row-split" style={{ marginBottom: 12 }}>
        {[5, 15, 25].map((n) => (
          <button key={n} className={'btn btn-sm' + (clean === n ? ' btn-accent' : '')} onClick={() => setExtra(n)}>+{n} days</button>
        ))}
      </div>
      <div className="card center" style={{ padding: 14, marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>Your run: </span>
        <b>{current} → {newTotal} days</b>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>new finish line: {finishDate}</div>
      </div>
      {err && <div className="login-err">{err}</div>}
      <div className="review-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-go" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Make it ${newTotal}`}</button>
      </div>
    </Sheet>
  )
}
