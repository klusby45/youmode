import { useState } from 'react'
import * as api from '../data.js'
import { CLASSIC_TEMPLATE, detectTimezone, slugify } from '../config.js'
import { copyFor, getStoredTone } from '../copy.js'
import { todayInTz } from '../lib/challenge.js'
import Icon from './Icons.jsx'

const FORMATS = [
  { key: 'solo', label: 'Solo', icon: 'target' },
  { key: 'versus', label: 'Versus', icon: 'versus' },
  { key: 'accountability', label: 'Partners', icon: 'check' },
  { key: 'community', label: 'Community', icon: 'grid' },
]

// First-run flow: create a challenge (with a fully editable checklist +
// optional stakes) or join one with a friend's code.
export default function Onboard({ profile, onDone, signOut }) {
  // Pre-provider render — voice comes from the device cache.
  const t = copyFor(getStoredTone())
  const [step, setStep] = useState('choice') // choice | create | code | join
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // create state
  const tz = detectTimezone()
  const [name, setName] = useState(`${profile.displayName}'s Challenge`)
  const [format, setFormat] = useState('versus')
  const [startDate, setStartDate] = useState(todayInTz(tz))
  const [stake, setStake] = useState('')
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
      if (!final.length) throw new Error('Add at least one daily requirement')
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
        // stake lives on my member row — fetch it via a cheap reload in onDone
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

  return (
    <div className="onb-wrap">
      <div className="login-brand" style={{ marginBottom: 14 }}>
        <div className="lb-mark" style={{ fontSize: 42 }}>YOU</div>
        <div className="lb-word" style={{ fontSize: 17 }}>MODE</div>
      </div>

      {step === 'choice' && (
        <>
          <div className="screen-title center">Hey {profile.displayName} 👊</div>
          <p className="center muted" style={{ fontSize: 14 }}>{t('onboard.hello.sub')}</p>
          <div className="onb-choice">
            <div className="card" onClick={() => setStep('create')}>
              <div className="onb-title"><Icon name="bolt" size={20} style={{ color: 'var(--red)' }} />Start a challenge</div>
              <div className="onb-sub">{t('onboard.start.sub')}</div>
            </div>
            <div className="card" onClick={() => setStep('join')}>
              <div className="onb-title"><Icon name="versus" size={20} style={{ color: 'var(--green)' }} />Join with a code</div>
              <div className="onb-sub">{t('onboard.join.sub')}</div>
            </div>
          </div>
          <button className="auth-flip" onClick={signOut}>Sign out</button>
        </>
      )}

      {step === 'create' && (
        <>
          <div className="screen-title">Build your challenge</div>
          <div className="screen-sub" style={{ marginBottom: 18 }}>Timezone: {tz}</div>

          <div className="section-label" style={{ marginTop: 0 }}>Format</div>
          <div className="fmt-picker">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" className={'fmt-chip' + (format === f.key ? ' active' : '')} onClick={() => setFormat(f.key)}>
                <Icon name={f.icon} size={18} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '2px 2px 16px' }}>{t(`format.${format}.blurb`)}</p>

          <div className="field">
            <label>Challenge name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div className="section-label">Daily requirements — every day, all 75</div>
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

          <div className="section-label">{t('onboard.stake.label')}</div>
          <div className="field">
            <input value={stake} onChange={(e) => setStake(e.target.value)} placeholder={t('onboard.stake.ph')} />
          </div>

          {err && <div className="login-err">{err}</div>}
          <button className="btn btn-accent btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={doCreate}>
            {busy ? 'Creating…' : 'Create Challenge'}
          </button>
          <button className="auth-flip" onClick={() => setStep('choice')}>Back</button>
        </>
      )}

      {step === 'code' && (
        <>
          <div className="screen-title center">{t('onboard.done.title')}</div>
          <p className="center muted" style={{ fontSize: 14 }}>{t('onboard.done.sub')}</p>
          <div className="code-big">{createdCode}</div>
          <button className="btn btn-block" onClick={() => navigator.clipboard?.writeText(createdCode).catch(() => {})}>Copy code</button>
          <button className="btn btn-go btn-block" style={{ marginTop: 10 }} onClick={onDone}>Start Day 1 →</button>
          <p className="center muted" style={{ fontSize: 12, marginTop: 14 }}>{t('onboard.done.honor')}</p>
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
              <option value="participant">Competitor — I'm doing the challenge</option>
              <option value="referee">Referee — I judge their days</option>
            </select>
          </div>
          {role === 'participant' && (
            <div className="field">
              <label>Your stake (optional)</label>
              <input value={joinStake} onChange={(e) => setJoinStake(e.target.value)} placeholder={t('onboard.join.stake.ph')} />
            </div>
          )}
          {role === 'participant' && (
            <p className="muted" style={{ fontSize: 12, margin: '4px 2px 12px' }}>You'll start with the creator's daily checklist — you can customize yours from the Today screen.</p>
          )}
          {err && <div className="login-err">{err}</div>}
          <button className="btn btn-accent btn-block" disabled={busy || code.trim().length < 4} onClick={doJoin}>
            {busy ? 'Joining…' : 'Join Challenge'}
          </button>
          <button className="auth-flip" onClick={() => setStep('choice')}>Back</button>
        </>
      )}
    </div>
  )
}
