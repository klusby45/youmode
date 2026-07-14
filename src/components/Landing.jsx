import { useEffect, useState } from 'react'
import { THEMES } from '../theme.js'
import { VOICES } from '../copy.js'
import Icon from './Icons.jsx'
import Login from './Login.jsx'

// Marketing landing for logged-out web visitors (the native app skips this
// and opens straight on auth). All copy is fixed — the voice system is an
// in-app feature the user picks during the guided start.
const BEATS = [
  {
    n: '01',
    title: 'Your checklist, not a preset.',
    body: "Start from the classic 75 Hard list or from a blank page. Add what actually matters to you, whether that's workouts, pages read, or screen-free evenings. Each item is photo proof or a simple check.",
    mock: 'checklist',
  },
  {
    n: '02',
    title: 'Your format, your stakes.',
    body: 'Go solo, head to head, with a partner, or with a crew of up to 12. Put something real on the line if you want. Nothing at all is fine too. Your call.',
    mock: 'formats',
  },
  {
    n: '03',
    title: 'Your crew keeps score.',
    body: 'One code invites your people. A referee can judge each day, or the honor system runs itself. Either way, the days you show up get counted.',
    mock: 'code',
  },
  {
    n: '04',
    title: 'AI keeps it honest.',
    body: 'Quiet spot checks on proof photos. No nagging and no streak shaming, just a fair record.',
    mock: 'ai',
  },
]

function Mock({ kind }) {
  if (kind === 'checklist') return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-row"><span className="lp-mock-kind">📷 Photo</span><span>Morning walk</span></div>
      <div className="lp-mock-row"><span className="lp-mock-kind check">✓ Check</span><span>Read 10 pages</span></div>
      <div className="lp-mock-row"><span className="lp-mock-kind check">✓ Check</span><span>No phone after 9pm</span></div>
    </div>
  )
  if (kind === 'formats') return (
    <div className="lp-mock lp-mock-chips" aria-hidden="true">
      <span className="lp-chip">Solo</span>
      <span className="lp-chip active">Partners</span>
      <span className="lp-chip">Versus</span>
      <span className="lp-chip">Community</span>
    </div>
  )
  if (kind === 'code') return (
    <div className="lp-mock lp-mock-code" aria-hidden="true">SUNRISE</div>
  )
  return (
    <div className="lp-mock" aria-hidden="true">
      <span className="lp-ai-chip"><Icon name="check" size={12} strokeWidth={3} />Spot check passed</span>
    </div>
  )
}

export default function Landing({ onAuthed }) {
  const [stage, setStage] = useState('scroll')
  const [authMode, setAuthMode] = useState('signup')

  useEffect(() => {
    // Landing owns the status-bar color while logged out; applyTheme restores
    // the user's colorway after sign-in.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#130C08')
  }, [])

  const enter = (mode) => {
    setAuthMode(mode)
    setStage('auth')
    window.scrollTo(0, 0)
  }

  if (stage === 'auth') {
    return (
      <div className="sun-scope">
        <div className="sun-bg" />
        <Login onAuthed={onAuthed} initialMode={authMode} onBack={() => setStage('scroll')} />
      </div>
    )
  }

  return (
    <div className="sun-scope lp">
      <div className="sun-bg" />

      <header className="lp-top">
        <span className="lp-lockup"><b>YOU</b>&nbsp;MODE</span>
        <button className="lp-signin" onClick={() => enter('signin')}>Sign in</button>
      </header>

      <section className="lp-hero">
        <div className="lp-mark lp-reveal" style={{ animationDelay: '.05s' }}>YOU</div>
        <div className="lp-word lp-reveal" style={{ animationDelay: '.15s' }}>MODE</div>
        <h1 className="lp-reveal" style={{ animationDelay: '.3s' }}>Build a challenge that fits your life.</h1>
        <p className="lp-sub lp-reveal" style={{ animationDelay: '.42s' }}>
          This isn't a typical fitness app or another rigid habit tracker. You Mode is the
          accountability app you design for yourself. Your checklist, your format, your stakes,
          your people. It bends around your life, not the other way around.
        </p>
        <div className="lp-cta-row lp-reveal" style={{ animationDelay: '.55s' }}>
          <button className="lp-cta" onClick={() => enter('signup')}>Build my challenge</button>
          <button className="lp-alt" onClick={() => enter('signup')}>I have an invite code</button>
        </div>
      </section>

      {BEATS.map((b) => (
        <section className="lp-beat" key={b.n}>
          <div className="lp-num">{b.n}</div>
          <h2>{b.title}</h2>
          <p>{b.body}</p>
          <Mock kind={b.mock} />
        </section>
      ))}

      <section className="lp-beat lp-yours">
        <div className="lp-num">05</div>
        <h2>Make it yours.</h2>
        <p>
          Down to the look and the voice. Five colorways, from warm daylight and soft blush to
          the original Midnight. Three voices, from gentle Monk to no-excuses Hard Core. The app
          talks to you the way you want to be talked to.
        </p>
        <div className="lp-swatches" aria-hidden="true">
          {THEMES.map((t) => (
            <span key={t.key} className="lp-swatch" style={{ background: t.swatch.bg }}>
              <i style={{ background: t.swatch.a }} />
              <i style={{ background: t.swatch.b }} />
            </span>
          ))}
        </div>
        <div className="lp-voices" aria-hidden="true">
          {VOICES.map((v) => (
            <div key={v.key} className="lp-voice"><b>{v.label}</b><span>{v.preview}</span></div>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <h2>Day 1 starts at dawn.</h2>
        <button className="lp-cta" onClick={() => enter('signup')}>Build my challenge</button>
      </section>

      <footer className="lp-foot">
        You Mode · <a href="/privacy.html">Privacy</a> · © 2026
      </footer>
    </div>
  )
}
