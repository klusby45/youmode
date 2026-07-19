import { useEffect } from 'react'
import { useApp } from '../appContext.js'
import Icon from './Icons.jsx'
import { celebrateHaptic } from '../lib/native.js'

// The daily payoff: a full-screen, screenshot-worthy moment when the last item
// of the day lands. One component, two personalities — the title renders in
// var(--title-font), so Linen gets serif and Navy/Midnight get the condensed
// display face. Copy is voice-flavored. Fired once per day (Today.jsx guards
// the transition + localStorage); tap anywhere or Done to dismiss.
export default function DayComplete({ dayNum, streak, name, onClose }) {
  const { t } = useApp()
  useEffect(() => { celebrateHaptic() }, []) // physical win on the phone
  return (
    <div className="dc-overlay" onClick={onClose} role="dialog" aria-label="Day complete">
      <div className="dc-burst" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="dc-card" onClick={(e) => e.stopPropagation()}>
        <div className="dc-eyebrow"><Icon name="sparkle" size={13} /> {name}</div>
        <div className="dc-title">{t('daycomplete.title', { n: dayNum })}</div>
        <svg width="132" height="132" className="ring dc-ring" aria-hidden="true">
          <circle className="ring-bg" cx="66" cy="66" r="56" fill="none" strokeWidth="9" />
          <circle cx="66" cy="66" r="56" fill="none" strokeWidth="9" stroke="var(--green)"
            strokeLinecap="round" strokeDasharray={2 * Math.PI * 56} strokeDashoffset="0"
            className="dc-arc" />
          <text x="66" y="74" textAnchor="middle" className="dc-check" transform="rotate(90 66 66)">✓</text>
        </svg>
        <p className="dc-sub">{t('daycomplete.sub')}</p>
        {streak > 1 && (
          <div className="dc-streak">
            <Icon name="flame" size={15} style={{ color: 'var(--amber)' }} />
            {t('daycomplete.streak', { n: streak })}
          </div>
        )}
        <button className="btn btn-go btn-block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
        <div className="dc-brand">YOU MODE</div>
      </div>
    </div>
  )
}
