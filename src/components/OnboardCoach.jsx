import { useEffect, useRef, useState } from 'react'
import * as api from '../data.js'
import { detectTimezone, slugify } from '../config.js'
import { pinChrome, applyTheme, getStoredTheme } from '../theme.js'
import { todayInTz } from '../lib/challenge.js'
import Icon from './Icons.jsx'
import Onboard, { FORMATS } from './Onboard.jsx'
import ItemRowEditor from './ItemRowEditor.jsx'
import { ColorwayVoiceStep, ShareCodeStep } from './PostCreateSteps.jsx'

// Talk-to-build onboarding. A brand-new member says (or types) what they want
// to accomplish; the coach interviews briefly and proposes a whole challenge,
// which the member reviews/edits before creating. The manual guided Onboard is
// kept as an escape hatch ("prefer to set it up yourself?"). Voice is optional
// and degrades to typing when the mic is unavailable or denied.

// Long-ramble friendly: record continuously for up to 10 minutes. Under the
// hood the recorder rotates in ~60s segments — each segment uploads and
// transcribes in the background (in speech order) while recording continues,
// so payloads stay small, no function times out, and the transcript builds
// live in the input as they talk.
const MAX_SECS = 600
const SEG_SECS = 60

const micSupported = typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia
  && typeof window !== 'undefined' && !!window.MediaRecorder

// A stake is something other people hold you to, so the field only shows for
// social formats and its voice matches the vibe. Solo has no stake at all.
const STAKE_COPY = {
  versus: { label: 'The wager', ph: 'e.g. loser buys dinner for a month' },
  accountability: { label: "What's on the line", ph: 'e.g. miss a day, you cover their coffee' },
  community: { label: 'The group stake', ph: 'e.g. last place buys the round' },
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// (Item rows now come from the shared ItemRowEditor, which owns GrowText.)

export default function OnboardCoach({ profile, onDone, signOut, onCancel, theme, tone, pickTheme, pickTone }) {
  const tz = detectTimezone()
  const [manual, setManual] = useState(false)
  // A 10-minute ramble is too precious to live only in React state (Mayssa
  // lost hers to a stuck chat, 2026-07-17): the conversation + draft persist
  // to localStorage per user, and a reload drops you right back in.
  const persistKey = `ym-onb-${profile.id}`
  const savedRef = useRef(null)
  if (savedRef.current === null) {
    try { savedRef.current = JSON.parse(localStorage.getItem(persistKey) || 'null') || false }
    catch { savedRef.current = false }
  }
  const saved = savedRef.current
  const [step, setStep] = useState(saved?.msgs?.length ? 'interview' : 'ramble') // ramble | interview | review | yours | code
  const [msgs, setMsgs] = useState(saved?.msgs || [])
  const [input, setInput] = useState(saved?.input || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const autoRef = useRef(0) // auto-trigger attempts for the current user turn

  // proposal → editable review state
  const [name, setName] = useState('')
  const [format, setFormat] = useState('solo')
  const [dayCount, setDayCount] = useState(75)
  const [startDate, setStartDate] = useState(todayInTz(tz))
  const [stake, setStake] = useState('')
  const [items, setItems] = useState([])
  const [plan, setPlan] = useState(null) // opt-in body plan the coach proposed
  const [acceptPlan, setAcceptPlan] = useState(true)
  const [createdCode, setCreatedCode] = useState(null)

  // voice capture
  const [recState, setRecState] = useState('idle') // idle | recording | transcribing
  const [elapsed, setElapsed] = useState(0)
  const [micDenied, setMicDenied] = useState(false)
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const discardRef = useRef(false) // Discard tapped: drop the whole take
  const liveRef = useRef(false) // true while the mic session is running
  const bufRef = useRef('') // transcript accumulates here; flushes to the box only on stop
  const secsRef = useRef(0) // interval-owned elapsed counter
  const pendingRef = useRef(0) // segments awaiting transcription
  const queueRef = useRef(Promise.resolve()) // serializes appends in speech order
  const meterRef = useRef(null) // { ctx, raf } for the live input level
  const auraRef = useRef(null) // the glow element the level drives
  const scrollRef = useRef(null)
  const rambleTaRef = useRef(null)

  // Stop any live recording + timer if the screen unmounts mid-capture.
  useEffect(() => () => {
    clearInterval(timerRef.current)
    stopMeter() // leaving mid-take shouldn't strand an AudioContext
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop() } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  // Keep the in-progress session on disk (cleared when the challenge is created).
  useEffect(() => {
    try {
      if (msgs.length || input.trim()) localStorage.setItem(persistKey, JSON.stringify({ msgs, input }))
      else localStorage.removeItem(persistKey)
    } catch { /* private mode */ }
  }, [msgs, input, persistKey])

  // Self-healing chat: if the conversation is sitting on an unanswered user
  // message (a restored session, or a turn that failed), trigger the coach
  // ourselves — the user should never have to nudge it. Two auto-attempts per
  // turn, then the error + manual retry stand.
  useEffect(() => {
    if (step !== 'interview' || busy) return
    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'user' || autoRef.current >= 2) return
    const attempt = autoRef.current += 1
    const t = setTimeout(() => runCoach(msgs), attempt === 1 ? 400 : 2500)
    return () => clearTimeout(t)
  }, [step, busy, msgs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Grow the ramble box with the transcript so a long ramble stays visible
  // instead of hiding above the fold of a 3-row textarea.
  useEffect(() => {
    const el = rambleTaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [input, step])

  // The build flow lives in cream Paper, with two dark exceptions: the ramble
  // (the voice "moment"), and the "make it yours" + code steps once the user
  // has actually picked Ink — so the picker previews their real choice.
  const inkScreen = step === 'ramble' || ((step === 'yours' || step === 'code') && theme === 'navy')
  useEffect(() => {
    if (!manual) pinChrome(inkScreen ? '#14110D' : '#F2ECDF')
  }, [manual, inkScreen])
  // Restore the signed-in colorway's chrome when onboarding exits to the app.
  useEffect(() => () => { applyTheme(getStoredTheme()) }, [])

  if (manual) {
    return <Onboard profile={profile} onDone={onDone} signOut={signOut} onCancel={onCancel} onUseGuide={() => setManual(false)}
      theme={theme} tone={tone} pickTheme={pickTheme} pickTone={pickTone} />
  }

  function seedFromProposal(p) {
    setName(p.name || 'My Challenge')
    setFormat(p.format || 'solo')
    setDayCount(p.dayCount || 75)
    setStake(p.suggestedStake || '')
    setPlan(p.bodyPlan || null)
    setAcceptPlan(!!p.bodyPlan) // default on when the coach proposed one
    setItems((p.items || []).map((it) => ({
      key: '', label: it.label || '', hint: it.hint || '', group: it.group || 'Custom',
      icon: it.icon || (it.kind === 'photo' ? 'camera' : 'bolt'),
      kind: it.kind === 'check' ? 'check' : 'photo', minMinutes: it.minMinutes,
      frequency: it.frequency === 'weekly' || it.frequency === 'monthly' ? it.frequency : 'daily',
      timesPerWeek: it.frequency === 'weekly' ? Math.min(6, Math.max(1, Number(it.timesPerWeek) || 2)) : null,
      timesPerMonth: it.frequency === 'monthly' ? Math.min(10, Math.max(1, Number(it.timesPerMonth) || 1)) : null,
      timesPerDay: it.kind === 'check' && Number(it.timesPerDay) > 1 ? Math.min(6, Math.round(Number(it.timesPerDay))) : null,
    })))
  }

  async function runCoach(next) {
    setBusy(true); setErr(null)
    try {
      const { reply, proposal } = await api.onboardChat(next)
      // Show something no matter what — a silent turn strands the user in a
      // dead chat (Mayssa, 2026-07-17: model spent its whole budget reasoning,
      // returned nothing, and the UI just sat there).
      const text = (reply || '').trim()
      const usable = proposal && proposal.items?.length
      if (text && text !== '…') setMsgs((xs) => [...xs, { role: 'assistant', content: text }])
      else if (!usable) setMsgs((xs) => [...xs, { role: 'assistant', content: "I've got all of that. Say \"build it\" and I'll turn it into your challenge." }])
      if (usable) { seedFromProposal(proposal); setStep('review') }
    } catch {
      setErr("Couldn't reach the setup guide. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  // ramble → first message opens the interview
  function startInterview() {
    const text = input.trim()
    if (!text || busy) return
    autoRef.current = 0 // fresh turn, fresh auto-retry budget
    const next = [{ role: 'user', content: text }]
    setMsgs(next); setInput(''); setStep('interview')
    runCoach(next)
  }

  // interview follow-ups
  function send() {
    const text = input.trim()
    if (!text || busy) return
    autoRef.current = 0
    const next = [...msgs, { role: 'user', content: text }]
    setMsgs(next); setInput('')
    runCoach(next)
  }

  // ── voice capture (rotating segments) ──────────────────────────────────
  // Each MediaRecorder owns its chunk list; on stop its blob goes through
  // handleSegment. Rotation stops the current recorder and immediately starts
  // a fresh one on the same live stream, so recording never pauses.
  function makeRecorder(stream) {
    const MR = window.MediaRecorder
    const mime = MR.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MR.isTypeSupported?.('audio/webm') ? 'audio/webm'
      : MR.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : ''
    // Bitrate is a hint: Chrome honors it (keeps segments tiny); iOS ignores it.
    const rec = mime ? new MR(stream, { mimeType: mime, audioBitsPerSecond: 32000 }) : new MR(stream)
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    rec.onstop = () => handleSegment(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
    return rec
  }

  async function transcribeSeg(blob) {
    const b64 = await blobToBase64(blob)
    try { return (await api.transcribeAudio(b64, blob.type)).text }
    catch {
      // Breathe before retrying: an immediate second call during a network
      // blip just fails again and costs the segment.
      await new Promise((r) => setTimeout(r, 700))
      return (await api.transcribeAudio(b64, blob.type)).text
    }
  }

  // Live input level, straight off the mic stream, so the glow answers her
  // voice instead of a fixed timer. Without this she talks for three minutes
  // at a decorative animation with no evidence anything is listening.
  function startMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let smooth = 0
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          const d = Math.abs(data[i] - 128) / 128
          if (d > peak) peak = d
        }
        smooth = smooth * 0.75 + Math.min(1, peak * 2.4) * 0.25
        auraRef.current?.style.setProperty('--lvl', smooth.toFixed(3))
        meterRef.current = { ctx, raf: requestAnimationFrame(tick) }
      }
      meterRef.current = { ctx, raf: requestAnimationFrame(tick) }
    } catch { /* the meter is a nicety; recording works without it */ }
  }
  function stopMeter() {
    const m = meterRef.current
    if (!m) return
    cancelAnimationFrame(m.raf)
    m.ctx?.close?.().catch(() => {})
    meterRef.current = null
    auraRef.current?.style.setProperty('--lvl', '0')
  }

  // Transcriptions run through a promise chain so text always lands in the
  // order it was spoken, even if a later segment transcribes faster. Segments
  // transcribe in the background WHILE recording (keeps the final wait short),
  // but the text stays in bufRef — the box only fills once, on stop. Filling
  // it mid-recording read as "it stopped listening" (Tom test, 2026-07-17).
  function handleSegment(blob) {
    if (discardRef.current) { settleIfDone(); return }
    if (!blob.size || blob.size < 2000) { settleIfDone(); return } // sub-second blip, no speech
    pendingRef.current += 1
    queueRef.current = queueRef.current.then(async () => {
      try {
        const text = await transcribeSeg(blob)
        if (text) bufRef.current = (bufRef.current ? bufRef.current.trim() + ' ' : '') + text
      } catch {
        setErr("Part of that didn't come through. Keep talking or type the missing part.")
      } finally {
        pendingRef.current -= 1
        settleIfDone()
      }
    })
  }

  function settleIfDone() {
    if (liveRef.current || pendingRef.current !== 0) return
    // Everything's transcribed: flush the whole take at once (unless discarded).
    if (!discardRef.current && bufRef.current) {
      const take = bufRef.current
      setInput((cur) => (cur ? cur.trim() + ' ' : '') + take)
    }
    bufRef.current = ''
    discardRef.current = false
    setRecState('idle')
  }

  async function startRec() {
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      startMeter(stream)
      discardRef.current = false
      bufRef.current = ''
      liveRef.current = true
      recRef.current = makeRecorder(stream)
      recRef.current.start()
      secsRef.current = 0
      setElapsed(0)
      setRecState('recording')
      timerRef.current = setInterval(() => {
        secsRef.current += 1
        const n = secsRef.current
        setElapsed(n)
        if (n >= MAX_SECS) stopRec()
        else if (n % SEG_SECS === 0) rotateSeg()
      }, 1000)
    } catch (e) {
      if (['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(e?.name)) setMicDenied(true)
      else setErr("Couldn't start the mic. Just type it below.")
      setRecState('idle')
    }
  }

  function rotateSeg() {
    const stream = streamRef.current
    const rec = recRef.current
    if (!stream || !rec || rec.state === 'inactive') return
    try { rec.stop() } catch { /* already stopped */ } // → onstop → handleSegment
    recRef.current = makeRecorder(stream)
    recRef.current.start()
  }

  function stopRec() {
    clearInterval(timerRef.current)
    stopMeter()
    liveRef.current = false
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch { /* already stopped */ } }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRecState('transcribing') // settleIfDone flips to idle once the queue drains
    setTimeout(settleIfDone, 2500) // safety: final onstop produced no segment
  }

  function cancelRec() {
    discardRef.current = true // Discard = throw away the whole take (typed text stays)
    stopRec()
  }

  // ── review item editing (mirrors Onboard's builder) ────────────────────
  const updateItem = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const removeItem = (i) => setItems((xs) => xs.filter((_, j) => j !== i))
  const addItem = (kind) => setItems((xs) => [...xs, { key: '', label: '', hint: '', group: 'Custom', icon: kind === 'photo' ? 'camera' : kind === 'timer' ? 'clock' : 'bolt', kind, ...(kind === 'timer' ? { minMinutes: 10 } : {}) }])

  function finalizeItems() {
    const seen = new Set(); const out = []
    for (const it of items) {
      const label = it.label.trim()
      if (!label) continue
      let key = it.key || slugify(label)
      while (seen.has(key)) key += '_2'
      seen.add(key)
      out.push({ ...it, label, key })
    }
    return out
  }

  async function doCreate() {
    setBusy(true); setErr(null)
    try {
      const final = finalizeItems()
      if (!final.length) throw new Error('Add at least one daily item')
      const ch = await api.createChallenge(
        { name: name.trim() || 'My Challenge', format, startDate, timezone: tz, stakeText: format !== 'solo' && stake.trim() ? stake.trim() : null, items: final, dayCount: Number(dayCount) || 75 },
        profile.id,
      )
      // Opt-in body goal: wire weigh-ins + macro tracking, mirroring
      // GoalCoach.accept. Best-effort — a plan hiccup must never sink the
      // challenge the user just created.
      if (plan && acceptPlan) {
        try {
          await api.createBodyPlan(profile.id, plan)
          await api.ensureExtraMealSlots(ch.id, profile.id).catch(() => {})
          if (plan.startWeight) await api.addWeighIn(profile.id, startDate, plan.startWeight).catch(() => {})
        } catch { /* keep the challenge; the plan can be added later from Goals */ }
      }
      try { localStorage.removeItem(persistKey) } catch { /* private mode */ } // session complete
      setCreatedCode(ch.joinCode)
      setStep('yours')
    } catch (e) {
      // Network/transient failures are the common case; keep it human and make
      // clear the edits survive so the user retries here instead of wandering off.
      const msg = e?.message || ''
      setErr(/fetch|network|timeout|Failed to/i.test(msg)
        ? 'The connection dropped before it saved.'
        : (msg || 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className={'lin' + (inkScreen ? ' oc-ink' : '')}>
      <div className="lin-bg" />
      <div className="onb-wrap">
        <header className="au-top">
          <span className="au-brand">
            <img className="au-logo" src="/logo-96.png" alt="" />
            <span className="au-word">You Mode</span>
          </span>
        </header>

        {step === 'ramble' && (
          <>
            {recState !== 'idle' && (
              // Breathing sunrise aura behind the mic while listening; it
              // quickens while we write the words down. Pure CSS, GPU-cheap.
              <div ref={auraRef} aria-hidden="true"
                className={'oc-aura' + (recState === 'transcribing' ? ' thinking' : ' live')}><i /><i /></div>
            )}
            <h2 className="au-q" style={{ textAlign: 'center' }}>What do you want to accomplish?</h2>
            <p className="center muted onb-sub-lg" style={{ maxWidth: 360, margin: '10px auto 0' }}>Tell me what you want to do. Ramble if you want. I'll turn it into a challenge.</p>

            {micSupported && !micDenied && (
              <div className="oc-mic-row">
                {recState === 'transcribing' ? (
                  <>
                    {/* A pencil, because that is literally what is happening.
                        The old lightning bolt meant nothing here. */}
                    <button className="oc-mic" disabled><Icon name="edit" size={28} /></button>
                    <span className="oc-mic-hint oc-hint-busy">Writing it down…</span>
                  </>
                ) : recState === 'recording' ? (
                  <>
                    <button className="oc-mic rec" onClick={stopRec} aria-label="Stop recording"><Icon name="stop" size={26} /></button>
                    <span className="oc-timer">{mmss}</span>
                    {/* Never let the 10-minute cutoff arrive unannounced. */}
                    <span className={'oc-mic-hint' + (elapsed >= MAX_SECS - 60 ? ' oc-hint-busy' : '')}>
                      {elapsed >= MAX_SECS - 60
                        ? `${Math.max(1, Math.ceil((MAX_SECS - elapsed) / 60))} minute left. Tap to finish.`
                        : 'Take your time. Up to 10 minutes.'}
                    </span>
                    <button className="oc-cancel" onClick={cancelRec}>Discard</button>
                  </>
                ) : (
                  <>
                    <button className="oc-mic" onClick={startRec} aria-label="Start recording"><Icon name="mic" size={30} /></button>
                    <span className="oc-mic-hint">Tap to talk</span>
                  </>
                )}
              </div>
            )}

            <div className="oc-chatbar" style={{ marginTop: 14 }}>
              <textarea ref={rambleTaRef} value={input} rows={3} placeholder={micDenied ? "Mic's off. Just type it here." : 'Or type it here…'}
                onChange={(e) => setInput(e.target.value)} />
            </div>
            {micDenied && <p className="muted" style={{ fontSize: 12, margin: '2px 2px 0' }}>Mic access is off. You can still type everything.</p>}
            {err && <div className="login-err">{err}</div>}

            <button className="btn btn-accent btn-block" style={{ marginTop: 14 }} disabled={!input.trim() || recState !== 'idle' || busy} onClick={startInterview}>Set it up →</button>
            <button className="auth-flip" onClick={() => setManual(true)}>Prefer to set it up yourself?</button>
            {onCancel && <button className="auth-flip" onClick={onCancel}>← Back to my challenge</button>}
            {!onCancel && <button className="auth-flip" onClick={signOut}>Sign out</button>}
          </>
        )}

        {step === 'interview' && (
          <>
            <div className="oc-msgs" ref={scrollRef}>
              {msgs.map((m, i) => <div key={i} className={'cm ' + (m.role === 'user' ? 'user' : 'ai')}>{m.content}</div>)}
              {busy && <div className="cm ai thinking">thinking…</div>}
            </div>
            {err && <div className="login-err" style={{ textAlign: 'left' }}>{err}</div>}
            <div className="oc-chatbar">
              <textarea value={input} rows={2} placeholder="Type your answer…" disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button className="btn btn-accent oc-send" disabled={busy || !input.trim()} onClick={send} aria-label="Send"><Icon name="chevron" size={18} /></button>
            </div>
            <button className="auth-flip" onClick={() => setManual(true)}>Prefer to set it up yourself?</button>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="screen-title">Here's your challenge.</div>
            <p className="muted onb-sub-lg">Built from what you told me. Tweak anything, then create it.</p>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="oc-daybox">
              <div className="field">
                <label>Days</label>
                <div className="oc-stepper">
                  <button type="button" aria-label="Fewer days"
                    onClick={() => setDayCount((d) => Math.max(7, (Number(d) || 75) - 1))}><Icon name="minus" size={16} /></button>
                  {/* Tap the number and type it — ± for nudges (Mayssa) */}
                  <span className="oc-step-n">
                    <input className="oc-step-in" type="number" inputMode="numeric" min={7} max={365}
                      value={dayCount} aria-label="Number of days"
                      onChange={(e) => setDayCount(e.target.value)}
                      onBlur={() => setDayCount((d) => Math.min(365, Math.max(7, Math.round(Number(d)) || 75)))} />
                    days
                  </span>
                  <button type="button" aria-label="More days"
                    onClick={() => setDayCount((d) => Math.min(365, (Number(d) || 75) + 1))}><Icon name="plus" size={16} /></button>
                </div>
              </div>
              <div className="field">
                <label>Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </div>

            <div className="section-label">Format</div>
            <div className="fmt-picker">
              {FORMATS.map((f) => (
                <button key={f.key} type="button" className={'fmt-chip' + (format === f.key ? ' active' : '')} onClick={() => setFormat(f.key)}>
                  <Icon name={f.icon} size={18} /><span>{f.label}</span>
                </button>
              ))}
            </div>

            <div className="section-label">Your checklist</div>
            {items.map((it, i) => (
              <ItemRowEditor key={i} it={it}
                onChange={(patch) => updateItem(i, patch)}
                onRemove={() => removeItem(i)} />
            ))}
            <div className="row-split" style={{ marginTop: 4 }}>
              <button className="btn btn-sm" onClick={() => addItem('photo')}><Icon name="camera" size={14} />Add photo item</button>
              <button className="btn btn-sm" onClick={() => addItem('check')}><Icon name="check" size={14} />Add checkmark</button>
              <button className="btn btn-sm" onClick={() => addItem('timer')}><Icon name="clock" size={14} />Add timer</button>
            </div>

            {plan && (
              <div className="oc-plan">
                <div className="oc-plan-head">
                  <span className="section-label" style={{ margin: 0 }}>Nutrition and weight</span>
                  <button type="button" className={'oc-plan-toggle' + (acceptPlan ? ' on' : '')} onClick={() => setAcceptPlan((v) => !v)}>
                    {acceptPlan ? 'Included' : 'Skipped'}
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: '2px 2px 10px' }}>
                  Weekly weigh-ins plus macro estimates from your meal photos, checked against these targets. Change or drop it anytime.
                </p>
                {plan.goalText && <div className="oc-plan-goal">{plan.goalText}</div>}
                <div className="pp-grid" style={acceptPlan ? undefined : { opacity: 0.45 }}>
                  {/* Only render what this plan actually carries. An 'aware'
                      plan has no weights and no targets, and printing empty
                      ones would invent goals the member declined. */}
                  {plan.startWeight ? <span>start <b>{plan.startWeight} lbs</b></span> : null}
                  {plan.targetWeight ? <span>target <b>{plan.targetWeight} lbs</b></span> : null}
                  {plan.proteinMin ? <span>protein <b>{plan.proteinMin}–{plan.proteinMax}g</b></span> : null}
                  {plan.calorieTarget ? <span>calories <b>{Number(plan.calorieTarget).toLocaleString()}/day</b></span> : null}
                  {plan.fiberTarget ? <span>fiber <b>{plan.fiberTarget}g</b></span> : null}
                  {plan.satFatMax ? <span>sat fat <b>under {plan.satFatMax}g</b></span> : null}
                  {plan.sodiumMax ? <span>sodium <b>under {Number(plan.sodiumMax).toLocaleString()}mg</b></span> : null}
                  {plan.mode === 'aware' ? <span>just the numbers, <b>no targets</b></span> : null}
                  <span>pace <b>{plan.rateTarget > 0 ? '+' : ''}{plan.rateTarget} lb/wk</b></span>
                  {plan.targetDate ? <span>by <b>{plan.targetDate}</b></span> : null}
                </div>
              </div>
            )}

            {format !== 'solo' && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>{STAKE_COPY[format].label} · optional</label>
                <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder={STAKE_COPY[format].ph} />
              </div>
            )}

            {err && (
              <div className="ai-note" style={{ borderColor: 'color-mix(in srgb, var(--red) 45%, transparent)', background: 'color-mix(in srgb, var(--red) 8%, transparent)', marginTop: 12 }}>
                <span className="an-txt"><b>Couldn't create it:</b> {err} Your edits are safe. Tap Create to try again.</span>
              </div>
            )}
            <button className="btn btn-accent btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={doCreate}>{busy ? 'Creating…' : err ? 'Try again' : 'Create my challenge'}</button>
            <p className="center muted" style={{ fontSize: 12, marginTop: 10 }}>You can edit your challenge anytime.</p>
            <button className="auth-flip" onClick={() => { setErr(null); setStep('interview') }}>Keep tweaking with the guide</button>
          </>
        )}

        {step === 'yours' && (
          <ColorwayVoiceStep theme={theme} tone={tone} pickTheme={pickTheme} pickTone={pickTone}
            primaryLabel="Looks good →" onPrimary={() => (format === 'solo' ? onDone() : setStep('code'))} onBack={() => setStep('review')} />
        )}

        {step === 'code' && <ShareCodeStep code={createdCode} format={format} onDone={onDone} />}
      </div>
    </div>
  )
}
