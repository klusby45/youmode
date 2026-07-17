import { useState } from 'react'
import { pickableThemes } from '../theme.js'
import { VOICES } from '../copy.js'
import Icon from './Icons.jsx'

// The two screens shared by both onboarding flows — the guided Onboard and the
// talk-to-build OnboardCoach. Pure presentational: the parent owns the state
// and step transitions and wraps these in its own .sun-scope page.

// The mode picker: two experiences (Linen soft / Navy dark), plus Midnight
// only for legacy accounts already on it. Shared by onboarding and YouSheet.
// Keeps the theme-opt base class so sunrise-scope overrides apply for free.
export function ModeCards({ theme, pickTheme }) {
  return pickableThemes(theme).map((tm) => (
    <button key={tm.key} className={'theme-opt mode-card' + (tm.key === theme ? ' active' : '')} onClick={() => pickTheme(tm.key)}>
      <span className="mode-preview" style={{ background: tm.swatch.bg }}>
        <b className="mp-aa" style={{ color: tm.swatch.text, fontFamily: tm.mode === 'soft' ? "'Playfair Display',Georgia,serif" : 'var(--cond)' }}>Aa</b>
        <i style={{ background: tm.swatch.a }} />
        <i style={{ background: tm.swatch.b }} />
      </span>
      <span className="to-label">
        {tm.label}
        <small>{tm.blurb}</small>
      </span>
      {tm.key === theme && <span className="to-check"><Icon name="check" size={18} /></span>}
    </button>
  ))
}

// Mode + voice picker. The primary button's behavior differs by flow
// (Onboard creates the challenge here; OnboardCoach already created it and just
// advances), so the label and handler are fully controlled by the parent.
export function ColorwayVoiceStep({
  theme, tone, pickTheme, pickTone,
  primaryLabel, busyLabel, busy, err, onPrimary, onBack,
}) {
  return (
    <>
      <div className="screen-title">Make it yours.</div>
      <p className="muted onb-sub-lg">How it looks, how it talks to you. Change anytime from your avatar.</p>
      <div className="section-label" style={{ marginTop: 16 }}>Mode</div>
      <ModeCards theme={theme} pickTheme={pickTheme} />
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
      <button className="btn btn-accent btn-block" style={{ marginTop: 14 }} disabled={busy} onClick={onPrimary}>
        {busy ? (busyLabel || primaryLabel) : primaryLabel}
      </button>
      {onBack && <button className="auth-flip" onClick={onBack}>Back</button>}
    </>
  )
}

// The invite step — the last stop for social formats (solo skips it entirely).
// Copy + share message match the format's dynamic.
const INVITE_COPY = {
  versus: { title: 'Invite your rival.', sub: 'Send them the code. You two, scored side by side.', who: 'Come take me on in You Mode' },
  accountability: { title: 'Invite your partner.', sub: 'They run their own checklist. You keep each other honest.', who: "Be my accountability partner on You Mode" },
  community: { title: 'Invite your crew.', sub: 'Anyone with this code joins your leaderboard.', who: 'Join my You Mode crew' },
}

export function ShareCodeStep({ code, format, onDone }) {
  const c = INVITE_COPY[format] || INVITE_COPY.community
  const [copied, setCopied] = useState(false)
  const shareText = `${c.who}. Join with code ${code} at youmode.app`
  const doShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'You Mode', text: shareText, url: 'https://youmode.app' })
      else { await navigator.clipboard?.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    } catch { /* user cancelled the share sheet */ }
  }
  const doCopy = async () => {
    try { await navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* no clipboard */ }
  }
  return (
    <>
      <div className="screen-title center">{c.title}</div>
      <p className="center muted onb-sub-lg">{c.sub}</p>
      <div className="code-big">{code}</div>
      <button className="btn btn-go btn-block" onClick={doShare}><Icon name="upload" size={16} />Share invite</button>
      <button className="btn btn-block" style={{ marginTop: 10 }} onClick={doCopy}>{copied ? 'Copied ✓' : 'Copy code'}</button>
      <button className="auth-flip" onClick={onDone}>Start Day 1 →</button>
      <p className="center muted" style={{ fontSize: 12, marginTop: 8 }}>You can share this code anytime from Standings.</p>
    </>
  )
}
