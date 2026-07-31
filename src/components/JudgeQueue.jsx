import { useState } from 'react'
import { useApp } from '../appContext.js'
import { daysBetween, isLogComplete } from '../lib/challenge.js'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'
import Lightbox from './Lightbox.jsx'

export default function JudgeQueue() {
  const { logs, members, participants, cfg, reqsFor, myMember, t } = useApp()

  const memberOf = (uid) => members.find((m) => m.userId === uid)
  // A redeemed day is INCOMPLETE by definition — that's why it was redeemed —
  // so it would never pass the isLogComplete gate. Let it through explicitly:
  // deciding it is the whole point of the save in a refereed challenge.
  const isSaved = (l) => memberOf(l.userId)?.redemptionDate === l.logDate
  const queue = logs
    .filter((l) => l.status === 'pending' && (isLogComplete(reqsFor(l.userId), l) || isSaved(l)))
    .sort((a, b) => (a.logDate < b.logDate ? -1 : 1))
  const recent = logs
    .filter((l) => l.status === 'approved' || l.status === 'rejected')
    .sort((a, b) => (a.logDate > b.logDate ? -1 : 1))
    .slice(0, 6)
  const dayOf = (l) => daysBetween(cfg.startStr, l.logDate) + 1

  return (
    <div>
      <div className="screen-head" style={{ alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {myMember?.stakeImage && <span className="jb-head"><img src={myMember.stakeImage} alt="" /></span>}
          <div>
            <div className="screen-title">{t('judge.title')}</div>
            <div className="screen-sub">{queue.length ? t('judge.sub.queue', { n: queue.length }) : t('judge.sub.clear')}</div>
          </div>
        </div>
      </div>

      {queue.length === 0 && (
        <div className="empty">
          <div className="e-ic"><Icon name="gavel" size={40} /></div>
          <div className="screen-title" style={{ fontSize: 20 }}>{t('judge.empty.title')}</div>
          <p>{t('judge.empty.sub', { names: participants.map((p) => p.displayName).join(' or ') || 'a competitor' })}</p>
        </div>
      )}

      {queue.map((log) => (
        <ReviewCard key={log.id} log={log} member={memberOf(log.userId)} reqs={reqsFor(log.userId)}
          day={dayOf(log)} saved={isSaved(log)} />
      ))}

      {recent.length > 0 && (
        <>
          <div className="section-label">{t('judge.recent')}</div>
          {recent.map((l) => (
            <div key={l.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
              <span className="vs-name" style={{ fontSize: 14 }}>
                <span className="vs-dot" style={{ background: memberOf(l.userId)?.accent }} />{memberOf(l.userId)?.displayName} · Day {dayOf(l)}
              </span>
              <span className={'chip ' + (l.status === 'approved' ? 'chip-green' : 'chip-red')}>
                <Icon name={l.status === 'approved' ? 'check' : 'x'} size={13} />{l.status}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ReviewCard({ log, member, reqs, day, saved }) {
  const { actions } = useApp()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(null) // { path, label }

  async function rule(verdict) {
    setBusy(true)
    try {
      await actions.reviewDay(log.id, verdict, note.trim() || null)
      await actions.refresh()
    } finally {
      setBusy(false)
    }
  }

  const aiFlags = reqs.filter((r) => {
    const e = log.entriesByReq[r.id]
    return e?.aiFlag && !e.aiDismissed
  })

  return (
    <div className="review-card">
      <div className="review-head">
        <span className="vs-name"><span className="vs-dot" style={{ background: member?.accent }} />{member?.displayName} · Day {day}</span>
        <span className="muted" style={{ fontSize: 12 }}>{log.logDate}</span>
      </div>

      {/* A save request looks like a failed day, because it is one. Say so up
          front so the referee judges it as a plea, not a completed day. */}
      {saved && (
        <div className="card" style={{ margin: '0 0 12px', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon name="shield" size={16} />
          <span className="muted" style={{ fontSize: 13 }}>
            <b style={{ color: 'var(--text)' }}>Used their one save.</b> This day is short and won't pass on its own.
            Approving it counts the day; rejecting it fails the day. Either way the save is spent.
          </span>
        </div>
      )}

      <div className="proof-grid">
        {reqs.map((r) => {
          const e = log.entriesByReq[r.id]
          if (r.kind === 'photo') {
            const flagged = e?.aiFlag && !e.aiDismissed
            const paths = e?.photoPaths?.length ? e.photoPaths : (e?.photoPath ? [e.photoPath] : [null])
            return paths.map((p, i) => (
              <div key={`${r.id}-${i}`} className={'proof-thumb' + (p ? ' tappable' : '')}
                onClick={() => p && setZoom({ path: p, label: `${member?.displayName} · ${r.label}${paths.length > 1 ? ` (${i + 1}/${paths.length})` : ''}` })}>
                {p && <ProofImage path={p} alt={r.label} />}
                {flagged && i === 0 && <span className="pt-badge ai"><Icon name="bolt" size={11} strokeWidth={3} /></span>}
                <span className="pt-label">{r.label.split(' ')[0]}{paths.length > 1 ? ` ${i + 1}` : ''}</span>
              </div>
            ))
          }
          const on = !!e?.checked
          return (
            <div key={r.id} className="proof-thumb check-tile" style={{ color: on ? 'var(--blue)' : 'var(--muted-2)' }}>
              <Icon name={r.icon || 'bolt'} size={22} />
              <span className={'pt-badge ' + (on ? 'ok' : 'no')}><Icon name={on ? 'check' : 'x'} size={11} strokeWidth={3} /></span>
              <span className="pt-label">{r.label.split(' ')[0]}</span>
            </div>
          )
        })}
      </div>

      {aiFlags.length > 0 && (
        <div className="ai-note">
          <span className="an-txt"><b>AI spot check:</b> {aiFlags.map((r) => `${r.label} — ${log.entriesByReq[r.id].aiNote || 'looks off'}`).join('; ')}</span>
        </div>
      )}

      <textarea className="note-input" placeholder="Optional note (good manners for a rejection)…" value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="review-actions">
        <button className="btn btn-danger" disabled={busy} onClick={() => rule('rejected')}><Icon name="x" size={16} />Reject</button>
        <button className="btn btn-go" disabled={busy} onClick={() => rule('approved')}><Icon name="check" size={16} />Approve</button>
      </div>

      {zoom && <Lightbox path={zoom.path} label={zoom.label} onClose={() => setZoom(null)} />}
    </div>
  )
}
