import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { todayInTz } from '../lib/challenge.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'

// Chat interface for creating or tuning body goals, and the one place you hand
// the app anything it should know about you. The coach (server-side) interviews,
// negotiates, and proposes a structured plan; nothing is saved until the user
// explicitly accepts the card in the thread.
//
// Blood work is attached here rather than in its own screen: setting a target,
// changing one, and handing over lab numbers are all the same conversation.

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// Reading a full panel takes about twenty seconds. Say where we are, so the
// wait reads as a wait and not as a hang.
const READING = [
  [0, 'Reading the page…'],
  [6, 'Finding your results…'],
  [13, 'Checking the numbers…'],
  [21, 'Long panel. Still going…'],
]

// Flat text for the coach's system prompt. A panel still sitting in the review
// card counts: someone who attaches their results and asks a question in the
// same breath should not be told the app cannot see them.
function labNote(draft, onFile) {
  const panel = draft || onFile
  if (!panel?.markers?.length) return null
  const rows = panel.markers
    .map((m) => `${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}`
      + `${m.ref ? ` (ref ${m.ref})` : ''}${m.flag !== 'normal' ? ` FLAGGED ${m.flag.toUpperCase()}` : ''}`)
    .join('\n')
  const when = draft ? `drawn ${panel.drawnOn}, just uploaded` : `drawn ${panel.drawnOn}`
  return `Panel ${when}:\n${rows}`
}

export default function GoalCoach({ onClose }) {
  const { me, cfg, actions, myPlans, challenge, t } = useApp()
  const hadPlans = myPlans.length > 0
  const GREETING = hadPlans ? t('coach.greeting.more') : t('coach.greeting.new')
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: GREETING }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [accepting, setAccepting] = useState(false)
  const [err, setErr] = useState(null)
  const [labs, setLabs] = useState([])       // panels already on file
  const [labDraft, setLabDraft] = useState(null) // read, awaiting confirmation
  const [reading, setReading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const scrollRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => { api.listLabResults(me.id).then(setLabs).catch(() => {}) }, [me.id])

  useEffect(() => {
    if (!reading) return
    setElapsed(0)
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [reading])

  // Body scroll lock + iOS keyboard handling. The overlay is pinned to the
  // *visual* viewport (height AND offsetTop) so when the keyboard opens the
  // whole chat shrinks to sit above it — header, messages, and input all stay
  // in frame instead of scrolling off the top.
  useEffect(() => {
    const s = document.body.style
    const prev = { position: s.position, top: s.top, width: s.width }
    const y = window.scrollY
    s.position = 'fixed'; s.top = `-${y}px`; s.width = '100%'
    const vv = window.visualViewport
    const fit = () => {
      const el = wrapRef.current
      if (!el) return
      if (vv) {
        el.style.height = `${vv.height}px`
        el.style.transform = `translateY(${vv.offsetTop}px)`
      }
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => {
      s.position = prev.position; s.top = prev.top; s.width = prev.width
      window.scrollTo(0, y)
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, proposal, busy, labDraft, reading])

  // Read the file in flight and show what came back. Nothing is stored yet:
  // a silently misread ApoB would set a wrong target with no way to trace it,
  // so the numbers go on screen before they go in the database.
  async function onPick(file) {
    if (!file || reading) return
    setErr(null)
    setReading(true)
    setMsgs((xs) => [...xs, { role: 'user', content: `Attached ${file.name || 'my results'}` }])
    try {
      const b64 = await toBase64(file)
      const out = await api.extractLabs(b64, file.type, cfg.todayStr)
      setLabDraft({ ...out, drawnOn: out.drawnOn || cfg.todayStr })
    } catch (e) {
      setErr(e.message || 'Could not read that file.')
    } finally {
      setReading(false)
    }
  }

  async function saveLabs() {
    setAccepting(true)
    setErr(null)
    try {
      await api.saveLabResult(me.id, labDraft)
      setLabs(await api.listLabResults(me.id))
      setLabDraft(null)
      setMsgs((xs) => [...xs, { role: 'assistant', content: 'Saved. Ask me for a target and I will use these.' }])
    } catch (e) {
      setErr(/relation|does not exist/i.test(e.message || '')
        ? "Results aren't switched on yet. Try again once the update lands."
        : e.message)
    } finally {
      setAccepting(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setErr(null)
    const next = [...msgs, { role: 'user', content: text }]
    setMsgs(next)
    setBusy(true)
    try {
      // The panel goes to the coach as context, not as a chat message. A
      // message got buried as the thread grew; this rides in the system prompt.
      // A panel that has been read but not yet confirmed counts too, otherwise
      // asking a question right after attaching gets "I can't see that file".
      const onFile = labs[0] || (await api.listLabResults(me.id).catch(() => []))[0]
      const outgoing = next.filter((m) => m.content !== GREETING)
      const { reply, proposal: p } = await api.coachChat(outgoing, labNote(labDraft, onFile))
      setMsgs((xs) => [...xs, { role: 'assistant', content: reply }])
      if (p) setProposal(p)
    } catch {
      setErr("Couldn't reach the coach. Check your connection and resend.")
      setMsgs(next) // keep the user's message so they can retry
    } finally {
      setBusy(false)
    }
  }

  // mode: 'add' stacks a new goal; 'replace' overwrites the (single) current one.
  async function accept(mode) {
    setAccepting(true)
    setErr(null)
    try {
      if (mode === 'replace' && myPlans.length === 1) {
        await api.updateBodyPlan(myPlans[0].id, proposal)
      } else {
        await api.createBodyPlan(me.id, proposal)
      }
      // Give goal-users their ad-hoc extra-meal slots (idempotent).
      await api.ensureExtraMealSlots(challenge.id, me.id).catch(() => {})
      // Seed the first weigh-in only for first-ever plans — established
      // members are already tracking and today's real weigh-in must win.
      if (!hadPlans && proposal.startWeight) {
        await api.addWeighIn(me.id, todayInTz(cfg.timezone), proposal.startWeight).catch(() => {})
      }
      await actions.refresh()
      onClose()
    } catch (e) {
      setErr(/duplicate|unique/i.test(e.message || '') ? 'Multiple goals need a quick server update — ping Kyle. (Or use Replace.)' : e.message)
      setAccepting(false)
    }
  }

  return (
    <div className="coach" ref={wrapRef}>
      <div className="coach-head">
        <span className="coach-title"><Icon name="target" size={18} /> Goal Coach</span>
        <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>

      {/* What the coach already knows, and the only place to take it back. */}
      {labs.length > 0 && !labDraft && (
        <div className="coach-labs">
          <Icon name="check" size={13} />
          <span>Blood work on file · {labs[0].drawnOn}</span>
          <button className="lr-x" aria-label="Remove blood work"
            onClick={async () => {
              await api.deleteLabResult(labs[0].id).catch(() => {})
              setLabs(await api.listLabResults(me.id).catch(() => []))
            }}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      <div className="coach-msgs" ref={scrollRef}>
        {msgs.map((m, i) => (
          <div key={i} className={'cm ' + (m.role === 'user' ? 'user' : 'ai')}>{m.content}</div>
        ))}
        {busy && <div className="cm ai thinking">thinking…</div>}
        {reading && (
          <div className="cm ai">
            <div className="lab-bar"><i /></div>
            {READING.filter(([at]) => elapsed >= at).pop()[1]}
          </div>
        )}

        {labDraft && (
          <div className="plan-preview">
            <div className="pp-title"><Icon name="upload" size={14} />Your results</div>
            <div className="lab-draft-head">
              <span>Check these, then save. Remove anything that reads wrong.</span>
              <input className="fr-input lab-date" type="date" value={labDraft.drawnOn}
                aria-label="Drawn on"
                onChange={(e) => setLabDraft((d) => ({ ...d, drawnOn: e.target.value }))} />
            </div>
            <div className="lab-list">
              {labDraft.markers.map((m, i) => (
                <div key={i} className={'lab-row' + (m.flag !== 'normal' ? ' flag' : '')}>
                  <span className="lr-name">{m.name}</span>
                  <span className="lr-val">
                    <b>{m.value}</b>{m.unit ? ` ${m.unit}` : ''}
                    {m.ref ? <small> · ref {m.ref}</small> : null}
                  </span>
                  <button className="lr-x" aria-label={`Remove ${m.name}`}
                    onClick={() => setLabDraft((d) => ({ ...d, markers: d.markers.filter((_, j) => j !== i) }))}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="review-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" disabled={accepting} onClick={() => setLabDraft(null)}>Discard</button>
              <button className="btn btn-go" disabled={accepting || !labDraft.markers.length} onClick={saveLabs}>
                {accepting ? 'Saving…' : `Save ${labDraft.markers.length}`}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '10px 2px 0', lineHeight: 1.5 }}>
              {labDraft.partial ? 'Long panel, so this is the out-of-range results plus the main ones. ' : ''}
              The file is not stored. These are your numbers, not advice.
            </p>
          </div>
        )}

        {proposal && (
          <div className="plan-preview">
            <div className="pp-title"><Icon name="bolt" size={14} />The plan</div>
            <div className="pp-goal">{proposal.goalText}</div>
            {/* Render only what this plan carries. A nutrition-only goal has
                no weights and no pace, and printing blanks for them would
                imply a scale target the member never asked for. */}
            <div className="pp-grid">
              {proposal.startWeight != null && <span>start <b>{proposal.startWeight} lbs</b></span>}
              {proposal.targetWeight != null && <span>target <b>{proposal.targetWeight} lbs</b></span>}
              {proposal.proteinMin != null && <span>protein <b>{proposal.proteinMin}–{proposal.proteinMax}g</b></span>}
              {proposal.calorieTarget != null && <span>calories <b>{Number(proposal.calorieTarget).toLocaleString()}/day</b></span>}
              {proposal.fiberTarget != null && <span>fiber <b>{proposal.fiberTarget}g+</b></span>}
              {proposal.satFatMax != null && <span>sat fat <b>under {proposal.satFatMax}g</b></span>}
              {proposal.sodiumMax != null && <span>sodium <b>under {Number(proposal.sodiumMax).toLocaleString()}mg</b></span>}
              {proposal.sugarMax != null && <span>added sugar <b>under {proposal.sugarMax}g</b></span>}
              {proposal.rateTarget != null && <span>pace <b>{proposal.rateTarget > 0 ? '+' : ''}{proposal.rateTarget} lb/wk</b></span>}
              {proposal.targetDate && <span>by <b>{proposal.targetDate}</b></span>}
            </div>
            <div className="review-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" disabled={accepting} onClick={() => setProposal(null)}>Keep tweaking</button>
              {hadPlans && myPlans.length === 1 && (
                <button className="btn" disabled={accepting} onClick={() => accept('replace')}>Replace current</button>
              )}
              <button className="btn btn-go" disabled={accepting} onClick={() => accept('add')}>{accepting ? 'Saving…' : hadPlans ? 'Add goal' : 'Accept plan'}</button>
            </div>
          </div>
        )}
        {err && <div className="login-err" style={{ textAlign: 'left' }}>{err}</div>}
      </div>

      <div className="coach-input">
        <label className="coach-clip" aria-label="Attach blood work" title="Attach blood work">
          <Icon name="upload" size={17} />
          <input type="file" accept="image/*,application/pdf" disabled={reading}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />
        </label>
        <input value={input} placeholder="Describe your goal…" disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
        <button className="coach-send" disabled={busy || !input.trim()} onClick={send} aria-label="Send">
          <Icon name="bolt" size={18} />
        </button>
      </div>
    </div>
  )
}
