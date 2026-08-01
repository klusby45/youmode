import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { todayInTz } from '../lib/challenge.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'

// Chat interface for creating or tuning body goals. The coach (server-side)
// interviews, negotiates, and proposes a structured plan; nothing is saved
// until the user explicitly accepts the proposal card (add or replace).
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
  const scrollRef = useRef(null)
  const wrapRef = useRef(null)

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
  }, [msgs, proposal, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setErr(null)
    const next = [...msgs, { role: 'user', content: text }]
    setMsgs(next)
    setBusy(true)
    try {
      const { reply, proposal: p } = await api.coachChat(next.filter((m) => m.content !== GREETING))
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

      <div className="coach-msgs" ref={scrollRef}>
        {msgs.map((m, i) => (
          <div key={i} className={'cm ' + (m.role === 'user' ? 'user' : 'ai')}>{m.content}</div>
        ))}
        {busy && <div className="cm ai thinking">thinking…</div>}

        {proposal && (
          <div className="plan-preview">
            <div className="pp-title"><Icon name="bolt" size={14} />The plan</div>
            <div className="pp-goal">{proposal.goalText}</div>
            <div className="pp-grid">
              {proposal.startWeight && <span>start <b>{proposal.startWeight} lbs</b></span>}
              <span>target <b>{proposal.targetWeight} lbs</b></span>
              <span>protein <b>{proposal.proteinMin}–{proposal.proteinMax}g</b></span>
              <span>calories <b>{Number(proposal.calorieTarget).toLocaleString()}/day</b></span>
              <span>pace <b>{proposal.rateTarget > 0 ? '+' : ''}{proposal.rateTarget} lb/wk</b></span>
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
