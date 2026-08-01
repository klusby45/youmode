import { useState } from 'react'
import { useApp } from '../appContext.js'
import { isMealReq } from '../config.js'
import { isExtraMeal } from '../data.js'
import { canSeePhotos } from '../lib/privacy.js'
import { dayState, logDone, logTotal, entrySatisfies, mealProgress, daysBetween, canEditDay, SAVE_WINDOW_DAYS } from '../lib/challenge.js'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'
import Sheet from './Sheet.jsx'
import Lightbox from './Lightbox.jsx'
import { PhotoSlot, AddMealSlot, CaptionSheet } from './Today.jsx'

// Chip class/icon fixed; labels follow the viewer's voice.
const stateChip = (t) => ({
  approved: ['chip-green', t('proof.status.approved'), 'check'],
  pending: ['chip-amber', t('proof.status.pending'), 'clock'],
  fail: ['chip-red', t('proof.status.fail'), 'x'],
  active: ['chip-amber', t('proof.status.active'), 'bolt'],
  upcoming: ['chip-muted', t('proof.status.upcoming'), 'clock'],
  excused: ['chip-muted', 'Saved', 'shield'],
})

// Read-only detail of one member's day: photos (tap to zoom), checks, AI
// flags, verdict. Rendered as a swipe-dismissable bottom sheet.
export default function DayProof({ profile, reqs, dayNumber, date, log, cfg, totalDays, onClose }) {
  const { isReferee, plans, t, me, actions, challenge, myMember, members } = useApp()
  // Resolve the day owner's member row LIVE rather than trusting the profile
  // snapshot taken when the cell was tapped — otherwise spending a save inside
  // this sheet leaves the header still reading "failed" until it's reopened.
  const ownerMember = members.find((m) => m.userId === profile.userId)
  const ownerRedemption = ownerMember?.redemptionDate ?? profile.redemptionDate ?? null
  const [zoom, setZoom] = useState(null) // { path, label }
  const [uploading, setUploading] = useState(null) // req id of an in-flight meal photo
  const [captioning, setCaptioning] = useState(null) // { req, entry } meal being described
  const [saveErr, setSaveErr] = useState(null)
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
    redemptionDate: ownerRedemption,
  })
  // The one save: offered only on YOUR OWN failed day, only while you still
  // have it, and only within the last week. The window used to be yesterday
  // alone, which was too tight to be usable — people don't notice a missed day
  // until a day or two later, so the day they needed had already aged out
  // (Dylen, 2026-07-31). A week covers noticing late while still refusing to
  // reach back far enough to rewrite an old result in a stakes challenge.
  const daysAgo = daysBetween(date, cfg.todayStr)
  const canSave = !!myMember && me.id === profile.userId && state === 'fail'
    && !ownerRedemption && daysAgo >= 1 && daysAgo <= SAVE_WINDOW_DAYS
  const chips = stateChip(t)
  const [chipCls, chipLabel, chipIcon] = chips[state] || chips.upcoming
  const total = logTotal(reqs)
  const done = logDone(reqs, log)
  const extraFilled = (r) => { const e = log?.entriesByReq?.[r.id]; return !!(e?.photoPaths?.length || e?.photoPath) }
  const extraUsed = (r) => { const e = log?.entriesByReq?.[r.id]; return !!(e?.photoPaths?.length || e?.photoPath || e?.caption) }
  const plan = plans?.find((p) => p.userId === profile.userId)
  // Backfill: the owner, on their own day, with a body plan, can add/edit meal
  // descriptions to fix macros for a day they logged late (Kyle's birthday
  // dinner past midnight). Nutrition data only — never touches completion.
  const canBackfill = !!plan && me.id === profile.userId
  // Meal reqs move into the editable block when backfilling; the read-only
  // grid keeps only non-meal proof photos then.
  // Meals pool: an empty numbered slot on a day whose meal count was already
  // met isn't a gap, so don't show it as one. (The backfill block below still
  // lists every slot — there it's an affordance to add, not a missing item.)
  const mealsMet = mealProgress(reqs, log).met
  const photos = reqs.filter((r) => r.kind === 'photo' && (!isExtraMeal(r) || extraFilled(r))
    && !(canBackfill && isMealReq(r)) && !(mealsMet && isMealReq(r) && !r.optional && !extraFilled(r)))
  const checks = reqs.filter((r) => r.kind === 'check')
  // Spent your save on this day? Then it reopens for the proof you forgot to
  // log. Your own day only, and only this one date — see canEditDay. Declared
  // after canBackfill because it defers meal slots to the backfill block.
  const canLateLog = me.id === profile.userId && date !== cfg.todayStr
    && canEditDay(date, cfg, ownerRedemption)
  const lateReqs = canLateLog
    ? reqs.filter((r) => !isExtraMeal(r) && !(canBackfill && isMealReq(r))
        && r.frequency !== 'weekly' && r.frequency !== 'monthly')
        .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    : []
  // Anything the late block owns is dropped from the read-only views below so
  // a requirement never renders twice in the same sheet.
  const inLate = (r) => lateReqs.some((x) => x.id === r.id)
  const mealPhotoReqs = reqs.filter((r) => isMealReq(r) && (!isExtraMeal(r) || extraFilled(r))).sort((a, b) => a.sort - b.sort)
  const extraMealSlots = reqs.filter((r) => isExtraMeal(r) && r.kind === 'photo').sort((a, b) => a.sort - b.sort)
  const nextPhotoExtra = extraMealSlots.find((r) => !extraFilled(r))
  const nextDescribeExtra = extraMealSlots.find((r) => !extraUsed(r))

  // Late proof on a redeemed day. Same writes as Today, pointed at that date;
  // RLS is ownership-only with no date gate, so nothing server-side changes.
  async function onPickLate(req, file) {
    if (!file) return
    setUploading(req.id); setSaveErr(null)
    try {
      await actions.uploadProof(challenge.id, me.id, date, req, file, log?.entriesByReq?.[req.id])
      await actions.refresh()
    } catch { setSaveErr(`"${req.label}" photo didn't save. Try again.`) }
    finally { setUploading(null) }
  }
  async function onClearLate(req) {
    setUploading(req.id); setSaveErr(null)
    try {
      await actions.clearPhotos(challenge.id, me.id, date, req)
      await actions.refresh()
    } catch { setSaveErr("Couldn't remove that photo. Try again.") }
    finally { setUploading(null) }
  }
  async function onToggleLate(req) {
    const on = entrySatisfies(req, log?.entriesByReq?.[req.id])
    setSaveErr(null)
    try {
      await actions.setChecked(challenge.id, me.id, date, req, !on)
      await actions.refresh()
    } catch { setSaveErr(`"${req.label}" didn't save. Try again.`) }
  }

  async function onPickMeal(req, file) {
    if (!file) return
    setUploading(req.id); setSaveErr(null)
    try {
      await actions.uploadProof(challenge.id, me.id, date, req, file, log?.entriesByReq?.[req.id])
      await actions.refresh()
    } catch { setSaveErr(`"${req.label}" photo didn't save. Try again.`) }
    finally { setUploading(null) }
  }
  async function onClearMeal(req) {
    setSaveErr(null)
    try { await actions.clearPhotos(challenge.id, me.id, date, req); await actions.refresh() }
    catch { setSaveErr(`Couldn't clear "${req.label}". Try again.`) }
  }

  // Fuel summary — only if this member has a body plan and logged meals with
  // estimates that day. Sums the stored per-meal macro estimates.
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

      {canSave && <UseSave date={date} memberId={myMember.id} hasReferee={cfg.hasReferee}
        onDone={actions.refresh} useRedemption={actions.useRedemption} />}

      {/* Redeemed day: add the proof you actually earned but forgot to log.
          This never decides the day on its own — a referee still rules, and on
          the honor system the day stays excused rather than passed. */}
      {canLateLog && lateReqs.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 2 }}>Add what you missed</div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            {cfg.hasReferee ? 'The referee sees these were added late.' : 'The day stays saved either way.'}
          </p>
          <div className="slots-grid">
            {lateReqs.filter((r) => r.kind === 'photo').map((r) => (
              <PhotoSlot key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable
                uploading={uploading === r.id} onPick={(f) => onPickLate(r, f)} onClear={() => onClearLate(r)}
                mealMode={false} />
            ))}
          </div>
          {lateReqs.filter((r) => r.kind !== 'photo').map((r) => {
            const on = entrySatisfies(r, log?.entriesByReq?.[r.id])
            return (
              <button key={r.id} className={'watertoggle' + (on ? ' on' : '')} onClick={() => onToggleLate(r)}
                style={{ marginBottom: 8 }}>
                <span className="wt-box" style={on ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>
                  {on && <Icon name="check" size={18} />}
                </span>
                <span style={{ flex: 1 }}>
                  <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                  <span className="wt-hint">{on ? 'Logged ✓' : (r.hint || 'Tap if you did it')}</span>
                </span>
                <Icon name={r.icon || 'bolt'} size={22} style={{ color: on ? 'var(--blue)' : 'var(--muted-2)' }} />
              </button>
            )
          })}
        </>
      )}

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

      {canBackfill && (
        <>
          <div className="section-label" style={{ marginTop: hasFuel ? 4 : 0 }}>Meals this day</div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Add or edit a meal and the macros update — handy for a dinner you logged late.
          </p>
          <div className="slots-grid">
            {mealPhotoReqs.map((r) => (
              <PhotoSlot key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable
                uploading={uploading === r.id} onPick={(f) => onPickMeal(r, f)} onClear={() => onClearMeal(r)}
                mealMode onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} />
            ))}
            {nextPhotoExtra && (
              <AddMealSlot uploading={uploading === nextPhotoExtra.id}
                onPick={(f) => onPickMeal(nextPhotoExtra, f)} captureOnly={nextPhotoExtra.captureOnly} />
            )}
          </div>
          {nextDescribeExtra && (
            <button className="btn btn-sm" style={{ marginTop: 8 }}
              onClick={() => setCaptioning({ req: nextDescribeExtra, entry: log?.entriesByReq?.[nextDescribeExtra.id] })}>
              <Icon name="edit" size={14} />Add a meal by description
            </button>
          )}
          {saveErr && <div className="login-err" style={{ marginTop: 8 }}>{saveErr}</div>}
        </>
      )}

      <div className="modal-photos">
        {photos.filter((r) => !inLate(r)).flatMap((r) => {
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

      {checks.filter((r) => !inLate(r)).map((r) => {
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

      {captioning && (
        <CaptionSheet req={captioning.req} entry={captioning.entry}
          onSave={async (text) => {
            const { req, entry } = captioning
            setCaptioning(null); setSaveErr(null)
            try {
              // Existing entry (has a photo already) → just recaption; a fresh
              // describe-only meal → create the entry on this day first.
              const eid = entry?.id
                ? (await actions.saveCaption(entry.id, text), entry.id)
                : (await actions.logMealCaption(challenge.id, me.id, date, req, text)).id
              await actions.refresh()
              if (text.trim()) { await actions.estimateMeal(eid); await actions.refresh() }
            } catch { setSaveErr(`Couldn't update "${req.label}". Try again.`) }
          }}
          onClose={() => setCaptioning(null)} />
      )}
    </Sheet>
  )
}

// Your one save. Everyone gets exactly one per challenge, so this asks twice:
// the first tap explains what it costs, the second spends it. Deliberately
// undersold — it's a safety net for a real life day, not something to farm.
function UseSave({ date, memberId, hasReferee, onDone, useRedemption }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (!confirming) {
    return (
      <button className="card save-offer" onClick={() => setConfirming(true)}>
        <Icon name="shield" size={17} />
        <span className="so-txt">
          <b>Use your one save</b>
          <small>One per challenge.</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 12, padding: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        {hasReferee
          ? 'The referee decides. Spent either way.'
          : "No fail, streak intact. Won't count as passed."}
      </p>
      {err && <div className="login-err" style={{ textAlign: 'left', marginBottom: 10 }}>{err}</div>}
      <div className="review-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={() => { setConfirming(false); setErr(null) }}>Keep it</button>
        <button className="btn btn-accent" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null)
          try { await useRedemption(memberId, date); await onDone() }
          catch (e) { setErr(e.message); setBusy(false) }
        }}>{busy ? 'Saving…' : 'Use it on this day'}</button>
      </div>
    </div>
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
