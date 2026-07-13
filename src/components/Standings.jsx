import { Fragment, useState } from 'react'
import { useApp } from '../appContext.js'
import { isExtraMeal } from '../data.js'
import { currentDayNumber, logDone, logTotal, isLogComplete } from '../lib/challenge.js'
import Icon from './Icons.jsx'
import DayProof from './DayProof.jsx'
import Sheet from './Sheet.jsx'

// Chip/icon structure is fixed; labels come from the user's voice.
const tcStatus = (t) => ({
  approved: { chip: 'chip-green', label: t('standings.status.approved'), icon: 'check' },
  pending: { chip: 'chip-amber', label: t('standings.status.pending'), icon: 'clock' },
  active: { chip: 'chip-muted', label: t('standings.status.active'), icon: 'bolt' },
  fail: { chip: 'chip-red', label: t('standings.status.fail'), icon: 'x' },
})

export default function Standings() {
  const { cfg, challenge, members, participants, summaries, logs, reqsFor, me, daysFor, maxDays, actions, t } = useApp()
  const [proof, setProof] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const amOwner = challenge.ownerId === me.id
  const dayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  const started = dayNum >= 1 && dayNum <= maxDays
  const referee = members.find((m) => m.role === 'referee')
  const todayLog = (uid) => logs.find((l) => l.userId === uid && l.logDate === cfg.todayStr)
  const format = cfg.format
  const solo = format === 'solo'
  const stakers = participants.filter((p) => p.stakeText)
  const title = solo ? t('standings.title.solo')
    : format === 'accountability' ? t('standings.title.accountability')
    : t('standings.title.group')

  return (
    <div>
      <div className="screen-head">
        <div>
          <div className="screen-title">{title}</div>
          <div className="screen-sub">
            {amOwner ? (
              <button className="rename-chip" onClick={() => setRenaming(true)} title="Rename challenge">
                {challenge.name} <Icon name="edit" size={11} />
              </button>
            ) : challenge.name}
            {' · '}{dayNum < 1 ? 'starts ' + cfg.startStr : dayNum > cfg.totalDays ? 'complete' : `Day ${dayNum} of ${cfg.totalDays}`}
          </div>
        </div>
        <span className="chip chip-muted">code {challenge.joinCode}</span>
      </div>

      {format === 'community' ? (
        <Leaderboard participants={participants} summaries={summaries} daysFor={daysFor} meId={me.id} />
      ) : (
        <div className={'scoreboard' + (solo ? ' solo' : format === 'accountability' ? ' grid' : '')}>
          {participants.map((p, i) => (
            <Fragment key={p.id}>
              <Column s={summaries[p.userId]} p={p} totalDays={daysFor(p.userId)} />
              {format === 'versus' && i === 0 && participants.length === 2 && <div className="vs-divider">VS</div>}
            </Fragment>
          ))}
        </div>
      )}

      {referee ? (
        <div className="ref-strip">
          <span className="rs-head">{referee.stakeImage ? <img src={referee.stakeImage} alt="" /> : <Icon name="gavel" size={20} />}</span>
          <span>
            <span className="rs-name" style={{ display: 'block' }}>{t('standings.ref.name', { name: referee.displayName })}</span>
            <span className="rs-sub">{t('standings.ref.sub')}</span>
          </span>
        </div>
      ) : (
        <div className="ref-strip">
          <span className="rs-head"><Icon name="bolt" size={20} /></span>
          <span>
            <span className="rs-name" style={{ display: 'block' }}>{t('standings.honor.title')}</span>
            <span className="rs-sub">{t('standings.honor.sub')}</span>
          </span>
        </div>
      )}

      <div className="section-label">Today's progress</div>
      {started ? (
        participants.map((p) => (
          <PersonRow key={p.id} p={p} reqs={reqsFor(p.userId)} mine={p.userId === me.id}
            log={todayLog(p.userId)} onOpen={() => setProof(p)} t={t}
            days={daysFor(p.userId)} approved={summaries[p.userId]?.approved ?? 0} />
        ))
      ) : (
        <div className="card center muted" style={{ padding: 18 }}>Daily progress unlocks {cfg.startStr}.</div>
      )}

      {stakers.length > 0 && (
        <>
          <div className="section-label">{t('standings.section.stakes')}</div>
          <div className={'stakes' + (stakers.length === 1 ? ' solo' : '')}>
            {stakers.map((p) => <StakeCard key={p.id} p={p} s={summaries[p.userId]} t={t} />)}
          </div>
        </>
      )}

      {proof && (
        <DayProof profile={proof} reqs={reqsFor(proof.userId)} dayNumber={dayNum} date={cfg.todayStr}
          log={todayLog(proof.userId)} cfg={cfg} totalDays={daysFor(proof.userId)} onClose={() => setProof(null)} />
      )}
      {renaming && (
        <RenameSheet current={challenge.name}
          onSave={async (name) => {
            await actions.renameChallenge(challenge.id, name)
            await actions.refresh()
            setRenaming(false)
          }}
          onClose={() => setRenaming(false)} />
      )}
    </div>
  )
}

// Community scoreboard: compact ranked rows instead of side-by-side columns —
// scales past two people and stays readable on a phone.
function Leaderboard({ participants, summaries, daysFor, meId }) {
  const ranked = [...participants].sort((a, b) => (summaries[b.userId]?.approved ?? 0) - (summaries[a.userId]?.approved ?? 0))
  return (
    <div className="leaderboard">
      {ranked.map((p, i) => {
        const s = summaries[p.userId] || {}
        return (
          <div key={p.id} className={'lb-row' + (p.userId === meId ? ' me' : '')}>
            <span className="lb-rank">{i + 1}</span>
            <span className="vs-dot" style={{ background: p.accent }} />
            <span className="lb-name">{p.displayName}</span>
            <span className="lb-streak"><Icon name="flame" size={13} fill="var(--amber)" />{s.streak ?? 0}</span>
            <span className="lb-days" style={{ color: p.accent }}>{s.approved ?? 0}<small>/{daysFor(p.userId)}</small></span>
            <span className="lb-bar"><span className="lb-fill" style={{ width: (s.completionPct ?? 0) + '%', background: p.accent }} /></span>
          </div>
        )
      })}
    </div>
  )
}

function Column({ s, p, totalDays }) {
  if (!s || !p) return null
  return (
    <div className="vs-col">
      <div className="vs-name"><span className="vs-dot" style={{ background: p.accent }} />{p.displayName}</div>
      <div className="vs-day" style={{ color: p.accent }}>{s.approved}<small> /{totalDays}</small></div>
      <div className="vs-streak"><Icon name="flame" size={14} fill="var(--amber)" />{s.streak} day streak</div>
      <div className="vs-row">
        <div className="vs-mini"><div className="vs-mini-n" style={{ color: 'var(--green)' }}>{s.approved}</div><div className="vs-mini-l">Pass</div></div>
        <div className="vs-mini"><div className="vs-mini-n" style={{ color: s.failed ? 'var(--red)' : 'var(--muted)' }}>{s.failed}</div><div className="vs-mini-l">Fail</div></div>
        <div className="vs-mini"><div className="vs-mini-n" style={{ color: s.pending ? 'var(--amber)' : 'var(--muted)' }}>{s.pending}</div><div className="vs-mini-l">Pend</div></div>
      </div>
      <div className="bar" style={{ marginTop: 12 }}>
        <div className="bar-fill" style={{ width: s.completionPct + '%', background: p.accent }} />
      </div>
      <div className="vs-mini-l" style={{ marginTop: 6 }}>{s.completionPct}% complete</div>
    </div>
  )
}

// Compact icon-level row (Miska's design): counts + requirement icons, never
// photo thumbnails — pixels live behind "See proof", gated by the owner's
// privacy setting. Uniform for everyone, scales to community size.
function PersonRow({ p, reqs, mine, log, onOpen, t, days, approved }) {
  const total = logTotal(reqs)
  const done = logDone(reqs, log)
  const complete = isLogComplete(reqs, log)
  const status = log?.status === 'approved' ? 'approved' : log?.status === 'rejected' ? 'fail' : complete ? 'pending' : 'active'
  const m = tcStatus(t)[status]
  const paths = (e) => (e?.photoPaths?.length ? e.photoPaths : (e?.photoPath ? [e.photoPath] : []))
  const hasAiFlags = reqs.some((r) => {
    const e = log?.entriesByReq?.[r.id]
    return e?.aiFlag && !e.aiDismissed
  })
  // Empty extra-meal slots don't render — only the ones actually logged.
  const cells = reqs.filter((r) => !isExtraMeal(r) || paths(log?.entriesByReq?.[r.id]).length)
  const MAX_ICONS = 8
  const shown = cells.slice(0, MAX_ICONS)
  const more = cells.length - shown.length
  return (
    <button className="today-card" onClick={onOpen}>
      <div className="tc-head">
        <span className="vs-name"><span className="vs-dot" style={{ background: p.accent }} />{p.displayName}{mine && <span className="tc-you">you</span>}</span>
        <span className="prow-nums">
          <span className="tc-count" style={{ color: p.accent }}>{approved}<small>/{days}</small></span>
          <span className="tc-count" style={{ color: done === total && total > 0 ? 'var(--green)' : 'var(--text)' }}>{done}<small>/{total} today</small></span>
        </span>
      </div>
      <div className="prow-icons">
        {shown.map((r) => {
          const e = log?.entriesByReq?.[r.id]
          const ok = r.kind === 'photo' ? paths(e).length > 0 : !!e?.checked
          return (
            <span key={r.id} className={'prow-ic' + (ok ? ' done' : '')} title={r.label}>
              <Icon name={r.icon || (r.kind === 'photo' ? 'camera' : 'bolt')} size={14} />
              {ok && <span className="tc-check"><Icon name="check" size={9} strokeWidth={3} /></span>}
            </span>
          )
        })}
        {more > 0 && <span className="prow-ic prow-more">+{more}</span>}
      </div>
      <div className="tc-foot">
        <span className={'chip ' + m.chip}><Icon name={m.icon} size={12} />{m.label}</span>
        {hasAiFlags && <span className="chip chip-amber" style={{ marginLeft: 8 }}><Icon name="bolt" size={12} />AI flag</span>}
        <span className="tc-tap">See proof <Icon name="chevron" size={13} /></span>
      </div>
    </button>
  )
}

// Owner-only challenge rename. Top-anchored so the keyboard can't cover it.
function RenameSheet({ current, onSave, onClose }) {
  const [name, setName] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = () => {
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    onSave(name).catch((e) => { setErr(e.message); setBusy(false) })
  }
  return (
    <Sheet onClose={onClose} position="top">
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Rename challenge</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        Shows in the top bar and standings. Only you (the owner) can change it.
      </p>
      <input className="fr-input" style={{ width: '100%' }} autoFocus value={name} maxLength={60}
        placeholder="e.g. 75 Hard" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      {err && <div className="login-err" style={{ textAlign: 'left' }}>{err}</div>}
      <div className="review-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-go" disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  )
}

function StakeCard({ p, s, t }) {
  const lit = s?.forfeitTriggered
  return (
    <div className={'stake' + (lit ? ' lit' : '')}>
      {p.stakeImage && (
        <div className="stake-portrait">
          <img className="forfeit-head" src={p.stakeImage} alt="" />
          <div className="stake-stamp">{t('stake.stamp')}</div>
          <div className="stake-safe-tag">{t('stake.tag')}</div>
        </div>
      )}
      <div className="stake-top">
        <span className="stake-name" style={{ color: p.accent }}>{p.displayName}</span>
        <Icon name="scissors" size={18} style={{ color: lit ? 'var(--red)' : 'var(--muted)' }} />
      </div>
      <div className="stake-forfeit">{t('stake.if', { name: p.displayName })} <strong style={{ color: 'var(--text)' }}>{p.stakeText}</strong></div>
      <div className="stake-status">
        {lit ? <><Icon name="x" size={13} strokeWidth={2.5} />{t('stake.due', { n: s.failed })}</> : <><Icon name="check" size={13} strokeWidth={2.5} />{t('stake.safe')}</>}
      </div>
    </div>
  )
}
