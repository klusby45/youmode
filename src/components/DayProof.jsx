import { useState } from 'react'
import { useApp } from '../appContext.js'
import { isMealReq } from '../config.js'
import { isExtraMeal } from '../data.js'
import { canSeePhotos } from '../lib/privacy.js'
import { dayState, logDone, logTotal, entrySatisfies } from '../lib/challenge.js'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'
import Sheet from './Sheet.jsx'
import Lightbox from './Lightbox.jsx'

// Chip class/icon fixed; labels follow the viewer's voice.
const stateChip = (t) => ({
  approved: ['chip-green', t('proof.status.approved'), 'check'],
  pending: ['chip-amber', t('proof.status.pending'), 'clock'],
  fail: ['chip-red', t('proof.status.fail'), 'x'],
  active: ['chip-amber', t('proof.status.active'), 'bolt'],
  upcoming: ['chip-muted', t('proof.status.upcoming'), 'clock'],
})

// Read-only detail of one member's day: photos (tap to zoom), checks, AI
// flags, verdict. Rendered as a swipe-dismissable bottom sheet.
export default function DayProof({ profile, reqs, dayNumber, date, log, cfg, totalDays, onClose }) {
  const { isReferee, plans, t, me } = useApp()
  const [zoom, setZoom] = useState(null) // { path, label }
  // Photo privacy: per-requirement check against the day owner's sharing
  // setting. Referee and the owner themselves always pass.
  const seePhotos = (r) => canSeePhotos({
    viewerId: me.id, viewerIsReferee: isReferee,
    ownerUserId: profile.userId, ownerSharing: profile.photoSharing, req: r,
  })
  const state = dayState(dayNumber, {
    startStr: cfg.startStr,
    todayStr: cfg.todayStr,
    totalDays: totalDays || cfg.totalDays,
    logsByDate: log ? { [date]: log } : {},
    reqs,
    hasReferee: cfg.hasReferee,
  })
  const chips = stateChip(t)
  const [chipCls, chipLabel, chipIcon] = chips[state] || chips.upcoming
  const total = logTotal(reqs)
  const done = logDone(reqs, log)
  const extraFilled = (r) => { const e = log?.entriesByReq?.[r.id]; return !!(e?.photoPaths?.length || e?.photoPath) }
  const photos = reqs.filter((r) => r.kind === 'photo' && (!isExtraMeal(r) || extraFilled(r)))
  const checks = reqs.filter((r) => r.kind === 'check')

  // Fuel summary — only if this member has a body plan and logged meals with
  // estimates that day. Sums the stored per-meal macro estimates.
  const plan = plans?.find((p) => p.userId === profile.userId)
  const mealEntries = plan ? reqs.filter(isMealReq).map((r) => log?.entriesByReq?.[r.id]).filter(Boolean) : []
  const estP = mealEntries.reduce((a, e) => a + (e.estProtein || 0), 0)
  const estC = mealEntries.reduce((a, e) => a + (e.estCalories || 0), 0)
  const hasFuel = plan && mealEntries.some((e) => e.estProtein != null || e.estCalories != null)
  const proteinHit = plan && estP >= plan.proteinMin

  return (
    <Sheet onClose={onClose}>
      <div className="review-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="screen-title" style={{ fontSize: 22 }}>{profile.displayName} · Day {dayNumber}</div>
          <div className="screen-sub">{date} · {done}/{total} done</div>
        </div>
        <span className={'chip ' + chipCls}><Icon name={chipIcon} size={13} />{chipLabel}</span>
      </div>

      {log?.judgeNote && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>{t('proof.refnote', { note: log.judgeNote })}</span>
        </div>
      )}

      {hasFuel && (
        <div className="macrobar" style={{ marginTop: 0, marginBottom: 14 }}>
          <div className="mb-row" style={{ marginBottom: 10 }}>
            <span className="mb-label">Fuel</span>
            <span className={'chip ' + (proteinHit ? 'chip-green' : 'chip-amber')} style={{ marginLeft: 'auto' }}>
              <Icon name={proteinHit ? 'check' : 'bolt'} size={12} />{proteinHit ? 'Goal hit' : 'Under protein'}
            </span>
          </div>
          <FuelRow label="Protein" value={estP} unit="g" target={plan.proteinMin} max={plan.proteinMax} />
          <FuelRow label="Calories" value={estC} unit="" target={plan.calorieTarget} />
        </div>
      )}

      <div className="modal-photos">
        {photos.flatMap((r) => {
          const e = log?.entriesByReq?.[r.id]
          const flagged = e?.aiFlag && !e.aiDismissed
          const paths = e?.photoPaths?.length ? e.photoPaths : (e?.photoPath ? [e.photoPath] : [null])
          // Icon-only view: one untappable tile per requirement — icon, done
          // check, and the caption if they wrote one. No pixels, no Lightbox.
          if (!seePhotos(r)) {
            const on = paths[0] != null
            return [(
              <div key={r.id} className="modal-photo private">
                <div className="mp-priv">
                  <Icon name={r.icon || 'camera'} size={26} />
                  {on && <span className="mp-priv-check"><Icon name="check" size={11} strokeWidth={3} /></span>}
                  {e?.caption && <span className="mp-priv-cap">{e.caption}</span>}
                </div>
                <span className="mp-label">{r.label}</span>
              </div>
            )]
          }
          return paths.map((p, i) => {
            const label = paths.length > 1 ? `${r.label} · ${i + 1}/${paths.length}` : r.label
            return (
              <div key={`${r.id}-${i}`} className={'modal-photo' + (p ? ' tappable' : '')}
                onClick={() => p && setZoom({ path: p, label })}>
                {p ? <ProofImage path={p} alt={label} /> : (
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }}>
                    <Icon name={r.icon || 'camera'} size={22} />
                  </div>
                )}
                {p && <span className="mp-expand"><Icon name="expand" size={14} /></span>}
                {flagged && i === 0 && <span className="ai-chip"><Icon name="bolt" size={11} />AI flag</span>}
                <span className="mp-label">{label}</span>
              </div>
            )
          })
        })}
      </div>

      {isReferee && photos.some((r) => {
        const e = log?.entriesByReq?.[r.id]
        return e?.aiFlag && !e.aiDismissed
      }) && (
        <div className="ai-note" style={{ marginTop: 10 }}>
          <span className="an-txt"><b>AI spot check:</b> {photos.map((r) => {
            const e = log?.entriesByReq?.[r.id]
            return e?.aiFlag && !e.aiDismissed ? `${r.label} — ${e.aiNote || 'looks off'}. ` : ''
          }).join('')}</span>
        </div>
      )}

      {checks.map((r) => {
        const on = entrySatisfies(r, log?.entriesByReq?.[r.id])
        return (
          <div key={r.id} className="watertoggle" style={{ marginTop: 10, cursor: 'default', opacity: on ? 1 : 0.5 }}>
            <span className="wt-box" style={{ background: on ? 'var(--blue)' : 'transparent', borderColor: on ? 'var(--blue)' : 'var(--line-2)', color: '#fff' }}>
              {on ? <Icon name="check" size={18} /> : null}
            </span>
            <span style={{ flex: 1 }}>
              <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
              <span className="wt-hint">{on ? 'Logged' : 'Not logged'}</span>
            </span>
            <Icon name={r.icon || 'bolt'} size={20} style={{ color: on ? 'var(--blue)' : 'var(--muted-2)' }} />
          </div>
        )
      })}

      <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={onClose}>Close</button>

      {zoom && <Lightbox path={zoom.path} label={zoom.label} onClose={() => setZoom(null)} />}
    </Sheet>
  )
}

function FuelRow({ label, value, unit, target, max }) {
  const pct = Math.min(100, Math.round((value / (target || 1)) * 100))
  // Earn your green: amber while under target, green once you've hit it.
  const color = target != null && value >= target ? 'var(--green)' : 'var(--amber)'
  const goalText = max && max !== target ? `${target}–${max}${unit}` : `${Number(target).toLocaleString()}${unit}`
  return (
    <div className="mb-row">
      <span className="mb-label">{label}</span>
      <div className="bar" style={{ flex: 1 }}>
        <div className="bar-fill" style={{ width: pct + '%', background: color }} />
      </div>
      <span className="mb-num"><b>{value ? `~${Number(value).toLocaleString()}` : 0}</b>{unit} / {goalText}</span>
    </div>
  )
}
