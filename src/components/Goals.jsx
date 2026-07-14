import { useState } from 'react'
import { useApp } from '../appContext.js'
import { goalStatus, todayInTz, daysBetween } from '../lib/challenge.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'
import GoalCoach from './GoalCoach.jsx'

// Optional goals per member: professional milestones and/or a body goal.
// Cards carry the member's accent. Participants without a body plan get the
// coach entry point.
export default function Goals() {
  const { participants, plans, me, myPlan, isReferee, t } = useApp()
  const [coaching, setCoaching] = useState(false)
  return (
    <div>
      <div className="screen-head">
        <div>
          <div className="screen-title">{t('goals.title')}</div>
          <div className="screen-sub">{t('goals.sub')}</div>
        </div>
      </div>
      {participants.map((p) => {
        const theirPlans = plans.filter((pl) => pl.userId === p.userId)
        return (
          <div key={p.id}>
            {p.goalLabel && <GoalCard p={p} />}
            {theirPlans.map((plan, i) => (
              <BodyGoalCard key={plan.id} plan={plan} name={p.displayName} accent={p.accent}
                showWeighIn={i === theirPlans.length - 1} />
            ))}
          </div>
        )
      })}

      {!isReferee && (
        <button className="goal-create" onClick={() => setCoaching(true)}>
          <span className="gc-stars" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="gc-ic"><Icon name="target" size={20} /></span>
          <span className="gc-txt">
            <b>Create a new goal</b>
            <small>Tell the coach what you want. It sets fair targets, you approve them, and the app tracks them daily.{myPlan ? ' You can stack goals or replace your current one.' : ''}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}
      {coaching && <GoalCoach onClose={() => setCoaching(false)} />}
    </div>
  )
}

const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const wash = (accent) => ({ '--gc-wash': `color-mix(in srgb, ${accent} 9%, transparent)` })

function CardHead({ accent, title, mine }) {
  return (
    <div className="goal-top">
      <span className="vs-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
      <span className="goal-name">{title}</span>
      {mine && <span className="chip chip-muted" style={{ marginLeft: 'auto' }}>You</span>}
    </div>
  )
}

function Milestone({ n, title, right }) {
  return (
    <div className="goal-row">
      <span className="ms-title"><span className="ms-badge">{n}</span>{title}</span>
      {right}
    </div>
  )
}

// ── professional goal ──────────────────────────────────────────────────────
function GoalCard({ p }) {
  const { cfg, me, actions } = useApp()
  const g = goalStatus(p, cfg)
  if (!g) return null
  const mine = p.userId === me.id

  async function setLaunched(v) {
    if (!mine) return
    await actions.updateMyMember(p.id, { launched: v, launchedAt: v ? cfg.todayStr : null })
    await actions.refresh()
  }
  async function bump(delta) {
    if (!mine) return
    await actions.updateMyMember(p.id, { count: Math.max(0, (g.count || 0) + delta) })
    await actions.refresh()
  }

  return (
    <div className="goal-card" style={wash(p.accent)}>
      <CardHead accent={p.accent} title={p.displayName} mine={mine} />
      <div className="muted" style={{ fontSize: 14 }}>{g.label}</div>

      <div className="goal-milestone">
        <Milestone n="1" title="Launch" right={
          g.launched
            ? <span className="chip chip-green"><Icon name="check" size={13} />Launched {fmtDate(g.launchedAt)}</span>
            : g.launchOverdue
              ? <span className="chip chip-red"><Icon name="x" size={13} />Overdue</span>
              : <span className="chip chip-amber"><Icon name="clock" size={13} />{g.daysToLaunch} days left</span>
        } />
        {mine && (
          g.launched
            ? <button className="btn btn-ghost btn-block" onClick={() => setLaunched(false)}>Undo launch</button>
            : <button className="btn btn-go btn-block" onClick={() => setLaunched(true)}><Icon name="bolt" size={16} />Mark as launched</button>
        )}
      </div>

      {g.target != null && (
        <div className="goal-milestone">
          <Milestone n="2" title={`${g.target} ${g.countLabel}`} right={
            g.countMet
              ? <span className="chip chip-green"><Icon name="check" size={13} />Target hit</span>
              : g.daysToFinal < 0
                ? <span className="chip chip-red"><Icon name="x" size={13} />Time up</span>
                : <span className="chip chip-muted"><Icon name="clock" size={13} />{g.daysToFinal} days left</span>
          } />
          <div className="goal-row" style={{ alignItems: 'flex-end' }}>
            <div>
              <span style={{ fontFamily: 'var(--num-font)', fontSize: 34 }}>{g.count}</span>
              <span className="muted" style={{ fontFamily: 'var(--cond)', fontSize: 16 }}> / {g.target} {g.countLabel}</span>
            </div>
            {mine && (
              <div className="counter">
                <button onClick={() => bump(-1)} aria-label="decrease"><Icon name="minus" size={18} /></button>
                <button onClick={() => bump(1)} aria-label="increase"><Icon name="plus" size={18} /></button>
              </div>
            )}
          </div>
          <div className="bar">
            <div className="bar-fill" style={{
              width: g.countPct + '%',
              background: g.countMet ? 'var(--green)' : `linear-gradient(90deg, ${p.accent}, color-mix(in srgb, ${p.accent} 55%, #fff))`,
            }} />
          </div>
          <div className="vs-mini-l" style={{ marginTop: 6 }}>{g.countPct}% · due {fmtDate(g.finalDeadline)}</div>
        </div>
      )}
    </div>
  )
}

// ── body goal: targets, weigh-ins, trend, pace ─────────────────────────────
function BodyGoalCard({ plan, name, accent, showWeighIn = true }) {
  const { me, cfg, weighIns, actions, members, isReferee } = useApp()
  const mine = plan.userId === me.id
  // Weight numbers follow the owner's sharing setting (like photos): owner
  // and referee always see them; challenge-mates only if sharing is 'all'.
  const owner = members.find((m) => m.userId === plan.userId)
  const seeNumbers = mine || isReferee || (owner?.photoSharing ?? 'icons') === 'all'

  async function remove() {
    if (!mine) return
    if (!window.confirm(`Remove this goal (${plan.goalText})? Your weigh-in history stays.`)) return
    try {
      await api.deleteBodyPlan(plan.id)
      await actions.refresh()
    } catch (e) {
      setErr(e.message)
    }
  }
  const points = weighIns.filter((w) => w.userId === plan.userId)
  const latest = points[points.length - 1]
  const current = latest?.weight ?? plan.startWeight
  const [wt, setWt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  let pace = null
  if (points.length >= 2) {
    const recent = points.slice(-4)
    const days = daysBetween(recent[0].date, recent[recent.length - 1].date) || 1
    pace = ((recent[recent.length - 1].weight - recent[0].weight) / days) * 7
  }
  const daysLeft = plan.targetDate ? daysBetween(todayInTz(cfg.timezone), plan.targetDate) : null
  const projected = pace != null && daysLeft != null ? current + (pace / 7) * daysLeft : null

  async function logWeighIn() {
    const w = Number(wt)
    if (!w || w < 50 || w > 500) { setErr('Enter a real weight'); return }
    setBusy(true)
    setErr(null)
    try {
      await actions.addWeighIn(me.id, todayInTz(cfg.timezone), w)
      await actions.refresh()
      setWt('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="goal-card" style={wash(accent)}>
      <div className="goal-top">
        <span className="vs-dot" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span className="goal-name">{name} · Body goal</span>
        {mine && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="chip chip-muted">You</span>
            <button className="iconbtn" onClick={remove} aria-label="Remove goal"><Icon name="x" size={14} /></button>
          </span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {plan.targetWeight} lbs · {plan.rateTarget >= 0 ? 'lean gain' : 'cut'}{plan.targetDate ? ` by ${fmtDate(plan.targetDate)}` : ''}
      </div>

      <div className="goal-milestone">
        <span className="chip chip-muted">{plan.proteinMin}–{plan.proteinMax}g protein · {Number(plan.calorieTarget).toLocaleString()} cal/day</span>

        {seeNumbers ? (
          <>
            <div className="bg-stats">
              <div className="bg-now">
                <span className="n">{current}</span><span className="u">lbs</span>
                <div className="cap">current</div>
              </div>
              <div className="bg-pace">
                {pace != null ? (
                  <>
                    <div className="countdown" style={{ color: 'var(--green)', fontSize: 16 }}>{pace >= 0 ? '+' : ''}{pace.toFixed(1)} lb/wk</div>
                    {projected != null && <div className="bg-hint">on pace for ~{Math.round(projected)} by {fmtDate(plan.targetDate)}</div>}
                  </>
                ) : (
                  <div className="bg-hint">{points.length === 1 ? 'one more weigh-in unlocks your trend' : 'log weekly to unlock pace & trend'}</div>
                )}
              </div>
            </div>

            <TrendLine points={points} start={plan.startWeight} target={plan.targetWeight} accent={accent} uid={plan.id} />
          </>
        ) : (
          <div className="bg-hint" style={{ marginTop: 10 }}>progress kept private — {name} still sees it daily</div>
        )}

        {mine && showWeighIn && (
          <div className="weigh-row">
            <label className="weigh-input">
              <input type="number" inputMode="decimal" step="0.1" placeholder={String(current)} value={wt}
                onChange={(e) => setWt(e.target.value)} />
              <span className="u">lbs today</span>
            </label>
            <button className="btn btn-go" disabled={busy || !wt} onClick={logWeighIn}>
              {busy ? 'Saving…' : 'Log weigh-in'}
            </button>
          </div>
        )}
        {err && <div className="login-err">{err}</div>}
      </div>
    </div>
  )
}

function TrendLine({ points, start, target, accent, uid }) {
  if (points.length < 2) return null
  const W = 320, H = 76, PAD = 8
  const gid = `tg-${String(uid).slice(0, 8)}`
  const weights = points.map((p) => p.weight)
  const lo = Math.min(...weights, start ?? Infinity, target ?? Infinity) - 1
  const hi = Math.max(...weights, start ?? -Infinity, target ?? -Infinity) + 1
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const y = (w) => PAD + (1 - (w - lo) / (hi - lo)) * (H - PAD * 2)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={accent} stopOpacity="0.28" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {target != null && (
        <>
          <line x1={PAD} x2={W - PAD} y1={y(target)} y2={y(target)} stroke="var(--line-2)" strokeDasharray="4 4" />
          <text x={W - PAD} y={y(target) - 3} textAnchor="end" fontSize="9" fill="var(--muted-2)" fontFamily="Oswald, sans-serif">{target}</text>
        </>
      )}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.weight)} r="2.2" fill={accent} />)}
      <circle cx={x(points.length - 1)} cy={y(last.weight)} r="5.5" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="2" />
    </svg>
  )
}
