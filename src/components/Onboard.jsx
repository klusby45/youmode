import { useState } from 'react'
import * as api from '../data.js'
import { CLASSIC_TEMPLATE, detectTimezone, slugify } from '../config.js'
import { THEMES } from '../theme.js'
import { VOICES } from '../copy.js'
import { todayInTz } from '../lib/challenge.js'
import Icon from './Icons.jsx'

const FORMATS = [
  { key: 'solo', label: 'Solo', icon: 'target', blurb: 'Just you and the calendar.' },
  { key: 'versus', label: 'Versus', icon: 'versus', blurb: 'Head to head with a friend, scored side by side.' },
  { key: 'accountability', label: 'Partners', icon: 'check', blurb: 'Different goals, same commitment. You keep each other honest.' },
  { key: 'community', label: 'Community', icon: 'grid', blurb: 'A crew of up to 12, everyone running their own checklist.' },
]

// The guided start: one decision per screen, fixed warm copy (the user picks
// their voice at the "yours" step; copyFor kicks in post-pick, in-app).
const STEPS = ['format', 'basics', 'checklist', 'stakes', 'yours', 'code']

export default function Onboard({ profile, onDone, signOut, theme, tone, pickTheme, pickTone }) {
  const [step, setStep] = useState('welcome')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // create state
  const tz = detectTimezone()
  const [name, setName] = useState(`${profile.displayName}'s Challenge`)
  const [format, setFormat] = useState('versus')
  const [startDate, setStartDate] = useState(todayInTz(tz))
  const [stake, setStake] = useState('')
  const [template, setTemplate] = useState('classic') // classic | blank
  const [items, setItems] = useState(CLASSIC_TEMPLATE.map((t) => ({ ...t })))
  const [createdCode, setCreatedCode] = useState(null)

  // join state
  const [code, setCode] = useState('')
  const [role, setRole] = useState('participant')
  const [joinStake, setJoinStake] = useState('')

  function updateItem(i, patch) {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }
  function removeItem(i) {
    setItems((xs) => xs.filter((_, j) => j !== i))
  }
  function addItem(kind) {
    setItems((xs) => [...xs, { key: '', label: '', hint: '', group: 'Custom', icon: kind === 'photo' ? 'camera' : 'bolt', kind }])
  }
  function seedTemplate(kind) {
    setTemplate(kind)
    setItems(kind === 'classic' ? CLASSIC_TEMPLATE.map((t) => ({ ...t })) : [{ key: '', label: '', hint: '', group: 'Custom', icon: 'camera', kind: 'photo' }])
  }

  function finalizeItems() {
    const seen = new Set()
    const out = []
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
    setBusy(true)
    setErr(null)
    try {
      const final = finalizeItems()
      if (!final.length) throw new Error('Add at least one daily item')
      const ch = await api.createChallenge(
        { name: name.trim() || 'My Challenge', format, startDate, timezone: tz, stakeText: stake.trim() || null, items: final },
        profile.id,
      )
      setCreatedCode(ch.joinCode)
      setStep('code')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function doJoin() {
    setBusy(true)
    setErr(null)
    try {
      const cid = await api.joinChallenge(code, role)
      if (role === 'participant' && joinStake.trim()) {
        const bundle = await api.loadAll(profile.id)
        const mine = bundle.active?.members.find((m) => m.userId === profile.id && m.challengeId === cid)
        if (mine) await api.updateMyMember(mine.id, { stakeText: joinStake.trim() })
      }
      await onDone()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  const stepIdx = STEPS.indexOf(step)
  const back = (to) => () => { setErr(null); setStep(to) }
  const next = (to) => () => { setErr(null); setStep(to) }

  return (
    <div className="sun-scope">
      <div className="sun-bg" />
      <div className="onb-wrap">
        <div className="login-brand" style={{ marginBottom: 14 }}>
          <div className="lb-mark" style={{ fontSize: 42 }}>YOU</div>
          <div className="lb-word" style={{ fontSize: 17 }}>MODE</div>
        </div>

        {stepIdx >= 0 && (
          <div className="onb-dots" aria-hidden="true">
            {STEPS.map((s, i) => <i key={s} className={i <= stepIdx ? 'on' : ''} />)}
          </div>
        )}

        {step === 'welcome' && (
          <>
            <div className="screen-title center">Hey {profile.displayName}, let's build your challenge.</div>
            <p className="center muted onb-sub-lg">A few quick picks. You can change all of it later.</p>
            <button className="btn btn-accent btn-block" style={{ marginTop: 18 }} onClick={next('format')}>
              Let's build it →
            </button>
            <button className="auth-flip" onClick={next('join')}>Have an invite code? Join instead</button>
            <button className="auth-flip" onClick={signOut}>Sign out</button>
          </>
        )}

        {step === 'format' && (
          <>
            <div className="screen-title">How do you want to run it?</div>
            <div className="fmt-picker" style={{ marginTop: 16 }}>
              {FORMATS.map((f) => (
                <button key={f.key} type="button" className={'fmt-chip' + (format === f.key ? ' active' : '')} onClick={() => setFormat(f.key)}>
                  <Icon name={f.icon} size={18} />
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '10px 2px 18px' }}>{FORMATS.find((f) => f.key === format).blurb}</p>
            <button className="btn btn-accent btn-block" onClick={next('basics')}>Next →</button>
            <button className="auth-flip" onClick={back('welcome')}>Back</button>
            <button className="auth-flip" onClick={next('join')}>Have an invite code? Join instead</button>
          </>
        )}

        {step === 'basics' && (
          <>
            <div className="screen-title">Name it. Pick day 1.</div>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Challenge name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '2px 2px 16px' }}>Timezone: {tz}</p>
            <button className="btn btn-accent btn-block" onClick={next('checklist')}>Next →</button>
            <button className="auth-flip" onClick={back('format')}>Back</button>
          </>
        )}

        {step === 'checklist' && (
          <>
            <div className="screen-title">What does showing up look like?</div>
            <p className="muted onb-sub-lg">Every item is a daily promise, logged as photo proof or a simple check.</p>
            <div className="row-split" style={{ margin: '14px 0 12px' }}>
              <button className={'btn btn-sm' + (template === 'classic' ? ' btn-accent' : '')} onClick={() => seedTemplate('classic')}>75 Hard classic</button>
              <button className={'btn btn-sm' + (template === 'blank' ? ' btn-accent' : '')} onClick={() => seedTemplate('blank')}>Start blank</button>
            </div>
            {items.map((it, i) => (
              <div className="builder-row" key={i}>
                <button className={'kind-toggle ' + it.kind} onClick={() => updateItem(i, { kind: it.kind === 'photo' ? 'check' : 'photo', icon: it.kind === 'photo' ? 'bolt' : 'camera' })}>
                  {it.kind === 'photo' ? '📷 Photo' : '✓ Check'}
                </button>
                <input className="br-label" value={it.label} placeholder="e.g. Home-cooked meal" onChange={(e) => updateItem(i, { label: e.target.value })} />
                <input className="br-hint" value={it.hint || ''} placeholder="detail (optional)" onChange={(e) => updateItem(i, { hint: e.target.value })} />
                <button className="br-del" onClick={() => removeItem(i)} title="Remove"><Icon name="x" size={15} /></button>
              </div>
            ))}
            <div className="row-split" style={{ marginTop: 4 }}>
              <button className="btn btn-sm" onClick={() => addItem('photo')}><Icon name="camera" size={14} />Add photo item</button>
              <button className="btn btn-sm" onClick={() => addItem('check')}><Icon name="check" size={14} />Add checkmark</button>
            </div>
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-accent btn-block" style={{ marginTop: 14 }}
              onClick={() => (finalizeItems().length ? next('stakes')() : setErr('Add at least one daily item'))}>
              Next →
            </button>
            <button className="auth-flip" onClick={back('basics')}>Back</button>
          </>
        )}

        {step === 'stakes' && (
          <>
            <div className="screen-title">Want something on the line?</div>
            <p className="muted onb-sub-lg">Optional. A stake your crew holds you to if you miss a day.</p>
            <div className="field" style={{ marginTop: 14 }}>
              <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder="e.g. buy the coffees for a month" />
            </div>
            <button className="btn btn-accent btn-block" onClick={next('yours')}>{stake.trim() ? 'Set my stake' : 'Skip for now'}</button>
            <button className="auth-flip" onClick={back('checklist')}>Back</button>
          </>
        )}

        {step === 'yours' && (
          <>
            <div className="screen-title">Make it yours.</div>
            <p className="muted onb-sub-lg">How it looks, how it talks to you. Change anytime from your avatar.</p>
            <div className="section-label" style={{ marginTop: 16 }}>Colorway</div>
            {THEMES.map((t) => (
              <button key={t.key} className={'theme-opt' + (t.key === theme ? ' active' : '')} onClick={() => pickTheme(t.key)}>
                <span className="theme-swatch" style={{ background: t.swatch.bg }}>
                  <i style={{ background: t.swatch.a }} />
                  <i style={{ background: t.swatch.b }} />
                </span>
                <span className="to-label">{t.label}</span>
                {t.key === theme && <span className="to-check"><Icon name="check" size={18} /></span>}
              </button>
            ))}
            <div className="section-label">Voice</div>
            {VOICES.map((v) => (
              <button key={v.key} className={'theme-opt voice-opt' + (v.key === tone ? ' active' : '')} onClick={() => pickTone(v.key)}>
                <span className="to-label">
                  {v.label}
                  <small>{v.preview}</small>
                </span>
                {v.key === tone && <span className="to-check"><Icon name="check" size={18} /></span>}
              </button>
            ))}
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-accent btn-block" style={{ marginTop: 14 }} disabled={busy} onClick={doCreate}>
              {busy ? 'Creating…' : 'Create my challenge'}
            </button>
            <button className="auth-flip" onClick={back('stakes')}>Back</button>
          </>
        )}

        {step === 'code' && (
          <>
            <div className="screen-title center">You're in. Share your code.</div>
            <p className="center muted onb-sub-lg">Anyone with this code can join you. Send it to your people.</p>
            <div className="code-big">{createdCode}</div>
            <button className="btn btn-block" onClick={() => navigator.clipboard?.writeText(createdCode).catch(() => {})}>Copy code</button>
            <button className="btn btn-go btn-block" style={{ marginTop: 10 }} onClick={onDone}>Start Day 1 →</button>
            <p className="center muted" style={{ fontSize: 12, marginTop: 14 }}>No referee? No problem. Finished days count automatically, with AI spot checks keeping photos honest.</p>
          </>
        )}

        {step === 'join' && (
          <>
            <div className="screen-title">Join a challenge</div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Invite code</label>
              <input value={code} autoCapitalize="characters" spellCheck="false" onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. MOHAWK" style={{ letterSpacing: 4, fontFamily: 'var(--cond)', textTransform: 'uppercase' }} />
            </div>
            <div className="field">
              <label>Joining as</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="participant">Competitor, I'm doing the challenge</option>
                <option value="referee">Referee, I judge their days</option>
              </select>
            </div>
            {role === 'participant' && (
              <div className="field">
                <label>Your stake (optional)</label>
                <input value={joinStake} onChange={(e) => setJoinStake(e.target.value)} placeholder="If you miss a day, what do you owe?" />
              </div>
            )}
            {role === 'participant' && (
              <p className="muted" style={{ fontSize: 12, margin: '4px 2px 12px' }}>You'll start with the creator's daily checklist. You can customize yours from the Today screen.</p>
            )}
            {err && <div className="login-err">{err}</div>}
            <button className="btn btn-accent btn-block" disabled={busy || code.trim().length < 4} onClick={doJoin}>
              {busy ? 'Joining…' : 'Join Challenge'}
            </button>
            <button className="auth-flip" onClick={back('welcome')}>Back</button>
          </>
        )}
      </div>
    </div>
  )
}
