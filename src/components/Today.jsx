import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { isMealReq } from '../config.js'
import { canEditDay, currentDayNumber, isLogComplete, logDone, logTotal, entrySatisfies, weeklyProgress } from '../lib/challenge.js'
import { IS_MOBILE } from '../lib/device.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'
import ProofImage from './ProofImage.jsx'
import Sheet from './Sheet.jsx'
import DayComplete from './DayComplete.jsx'

export default function Today() {
  const { cfg, me, logs, reqsFor, actions, challenge, daysFor, myPlan, t, mode, summaries } = useApp()
  const myDays = daysFor(me.id)
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(null) // requirement id of an in-flight check
  const [saveErr, setSaveErr] = useState(null)
  const [captioning, setCaptioning] = useState(null) // { req, entry } meal being described

  const reqs = reqsFor(me.id)
  const dayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  const myLogs = logs.filter((l) => l.userId === me.id)
  const log = myLogs.find((l) => l.logDate === cfg.todayStr) || null
  const approved = log?.status === 'approved'
  const rejected = log?.status === 'rejected'
  const editable = canEditDay(cfg.todayStr, cfg) && !approved

  const doneCount = logDone(reqs, log)
  const total = logTotal(reqs)
  const complete = isLogComplete(reqs, log)

  // Day Complete celebration: fires only on the false→true transition of
  // `complete` in THIS session (never on mount, so finishing on another device
  // doesn't re-celebrate here) and once per day via localStorage.
  const [celebrate, setCelebrate] = useState(false)
  const wasComplete = useRef(complete)
  useEffect(() => {
    if (complete && !wasComplete.current && dayNum >= 1 && dayNum <= myDays) {
      const key = `75hard-dc-${challenge.id}-${cfg.todayStr}`
      try {
        if (!localStorage.getItem(key)) { localStorage.setItem(key, '1'); setCelebrate(true) }
      } catch { setCelebrate(true) } // private mode: fall back to once per mount
    }
    wasComplete.current = complete
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete])

  // Self-heal: a meal that has a caption + photo but no estimate got stranded
  // (a fire-and-forget estimate silently failed). Retry it once per entry per
  // session, then refresh to pull the result. Prevents permanent "estimating…".
  const healed = useRef(new Set())
  useEffect(() => {
    if (!myPlan || !log) return
    const stranded = reqs.filter(isMealReq).map((r) => log.entriesByReq?.[r.id]).filter(
      (e) => e && (e.photoPaths?.length || e.photoPath) && e.caption && e.estProtein == null && !healed.current.has(e.id)
    )
    if (!stranded.length) return
    stranded.forEach((e) => healed.current.add(e.id))
    Promise.allSettled(stranded.map((e) => actions.estimateMeal(e.id)))
      .then(() => actions.refresh())
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, myPlan])

  async function onPick(req, file) {
    if (!file) return
    setUploading(req.id)
    setSaveErr(null)
    try {
      await actions.uploadProof(challenge.id, me.id, cfg.todayStr, req, file, log?.entriesByReq?.[req.id])
      await actions.refresh()
    } catch {
      setSaveErr(`"${req.label}" photo didn't save — check your connection and try again.`)
    } finally {
      setUploading(null)
    }
  }

  async function onClearPhotos(req) {
    setSaveErr(null)
    try {
      await actions.clearPhotos(challenge.id, me.id, cfg.todayStr, req)
      await actions.refresh()
    } catch {
      setSaveErr(`Couldn't clear "${req.label}" — check your connection and try again.`)
    }
  }

  async function toggleCheck(req) {
    if (!editable || saving) return
    const cur = entrySatisfies(req, log?.entriesByReq?.[req.id])
    setSaving(req.id)
    setSaveErr(null)
    try {
      await actions.setChecked(challenge.id, me.id, cfg.todayStr, req, !cur)
      await actions.refresh()
    } catch {
      setSaveErr(`"${req.label}" didn't save — check your connection and tap it again.`)
    } finally {
      setSaving(null)
    }
  }

  async function dismissFlag(entry) {
    await actions.dismissAiFlag(entry.id)
    await actions.refresh()
  }

  if (dayNum < 1) {
    return (
      <div className="empty">
        <div className="e-ic"><Icon name="clock" size={40} /></div>
        <div className="screen-title" style={{ fontSize: 22 }}>Not started yet</div>
        <p>{t('today.notstarted.sub', { name: challenge.name, start: cfg.startStr })}</p>
      </div>
    )
  }
  if (dayNum > myDays) {
    return (
      <div className="empty">
        <div className="e-ic"><Icon name="trophy" size={40} /></div>
        <div className="screen-title" style={{ fontSize: 22 }}>{t('today.finished.title', { n: myDays })}</div>
        <p>{t('today.finished.sub')}</p>
      </div>
    )
  }

  // One flush grid — no group sections; every tile carries its own title.
  // Extra-meal slots only render once filled; the empty next one is offered
  // via the "+ Add a meal" tile (body-goal users only).
  const isFilled = (r) => { const e = log?.entriesByReq?.[r.id]; return !!(e?.photoPaths?.length || e?.photoPath) }
  const daily = (r) => r.frequency !== 'weekly'
  const photos = reqs.filter((r) => r.kind === 'photo' && daily(r) && (!api.isExtraMeal(r) || isFilled(r)))
  const checks = reqs.filter((r) => r.kind === 'check' && daily(r))
  // Weekly-cadence items live in their own "This week" section — they never
  // gate the day, so they're pulled out of the daily grids above.
  const weekly = reqs.filter((r) => r.frequency === 'weekly' && !api.isExtraMeal(r)).sort((a, b) => a.sort - b.sort)
  const wprog = weeklyProgress(reqs, myLogs, { startStr: cfg.startStr, dayNumber: dayNum, totalDays: myDays })
  const extraSlots = reqs.filter((r) => api.isExtraMeal(r) && r.kind === 'photo').sort((a, b) => a.sort - b.sort)
  const nextExtra = extraSlots.find((r) => !isFilled(r))
  // Body-goal extras (only for members with a plan): filled meal entries get
  // captions; estimates roll up into the macro bar.
  const meals = myPlan ? photos.filter(isMealReq)
    .map((r) => ({ req: r, entry: log?.entriesByReq?.[r.id] }))
    .filter(({ entry }) => entry?.photoPaths?.length || entry?.photoPath) : []
  const estP = meals.reduce((a, { entry }) => a + (entry.estProtein || 0), 0)
  const estC = meals.reduce((a, { entry }) => a + (entry.estCalories || 0), 0)
  const flagged = reqs
    .map((r) => ({ req: r, entry: log?.entriesByReq?.[r.id] }))
    .filter(({ entry }) => entry?.aiFlag && !entry.aiDismissed)

  return (
    <div>
      {mode === 'soft' ? (
        // Linen layout: the day IS the hero — big ring, serif day number, and
        // a voice line instead of the stat-dense header + togo banner.
        <>
          <SoftHero dayNum={dayNum} done={doneCount} total={total} date={cfg.todayStr} complete={complete} t={t} />
          {(approved || rejected || (complete && cfg.hasReferee)) && (
            <StatusBanner approved={approved} rejected={rejected} complete={complete} note={log?.judgeNote}
              doneCount={doneCount} total={total} hasReferee={cfg.hasReferee} t={t} />
          )}
        </>
      ) : (
        <>
          <div className="today-hero">
            <div>
              <div className="section-label" style={{ margin: '0 0 2px' }}>Today · {cfg.todayStr}</div>
              <div className="h-day">DAY {dayNum}</div>
            </div>
            <Ring done={doneCount} total={total} />
          </div>

          <StatusBanner approved={approved} rejected={rejected} complete={complete} note={log?.judgeNote}
            doneCount={doneCount} total={total} hasReferee={cfg.hasReferee} t={t} />
        </>
      )}

      {myPlan && (
        <div className="macrobar">
          <MacroRow label="Protein" value={estP} unit="g"
            target={myPlan.proteinMin} max={myPlan.proteinMax} />
          <MacroRow label="Calories" value={estC} unit=""
            target={myPlan.calorieTarget} />
          <div className="mb-hint">{meals.length ? 'estimates from your meal photos + captions' : 'log meals with captions to start counting'}</div>
        </div>
      )}

      {saveErr && (
        <div className="ai-note" style={{ borderColor: 'color-mix(in srgb, var(--red) 45%, transparent)', background: 'color-mix(in srgb, var(--red) 8%, transparent)' }}>
          <span className="an-txt"><b>Not saved:</b> {saveErr}</span>
          <button className="btn btn-sm" onClick={() => setSaveErr(null)}>OK</button>
        </div>
      )}

      {flagged.map(({ req, entry }) => (
        <div className="ai-note" key={entry.id}>
          <span className="an-txt"><b>Spot check · {req.label}:</b> {entry.aiNote || t('today.aiflag.fallback')}</span>
          <button className="btn btn-sm" onClick={() => dismissFlag(entry)}>{t('today.aiflag.dismiss')}</button>
        </div>
      ))}

      {photos.some((r) => r.multi) && (
        <div className="section-label" style={{ marginBottom: 8 }}>
          <span className="new-badge" style={{ marginLeft: 0 }}>New: multi-photo upload on workouts</span>
        </div>
      )}
      <div className="slots-grid" style={{ marginTop: 12 }}>
        {photos.map((r) => (
          <PhotoSlot key={r.id} req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
            uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
            mealMode={!!myPlan && isMealReq(r)}
            onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} />
        ))}
        {myPlan && editable && nextExtra && (
          <AddMealSlot uploading={uploading === nextExtra.id} onPick={(f) => onPick(nextExtra, f)} />
        )}
      </div>

      {checks.length > 0 && <div style={{ height: 14 }} />}
      {checks.map((r) => {
        const on = entrySatisfies(r, log?.entriesByReq?.[r.id])
        const busy = saving === r.id
        return (
          <button key={r.id} className={'watertoggle' + (on ? ' on' : '')} onClick={() => toggleCheck(r)}
            disabled={!editable || busy} style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
            <span className="wt-box" style={on ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>{on && <Icon name="check" size={18} />}</span>
            <span style={{ flex: 1 }}>
              <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
              <span className="wt-hint">{busy ? 'Saving…' : on ? `Saved ✓${r.hint ? ' · ' + r.hint : ''}` : (r.hint || 'Just check it')}</span>
            </span>
            <Icon name={r.icon || 'bolt'} size={22} style={{ color: on ? 'var(--blue)' : 'var(--muted-2)' }} />
          </button>
        )
      })}

      {weekly.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>This week</div>
          {weekly.map((r) => {
            const wp = wprog[r.id] || { done: 0, target: r.timesPerWeek || 1, met: false }
            const onToday = entrySatisfies(r, log?.entriesByReq?.[r.id])
            const badge = `${wp.done} of ${wp.target} this week`
            if (r.kind === 'check') {
              const busy = saving === r.id
              return (
                <button key={r.id} className={'watertoggle wk' + (onToday ? ' on' : '') + (wp.met ? ' met' : '')}
                  onClick={() => toggleCheck(r)} disabled={!editable || busy} style={{ marginBottom: 8, opacity: busy ? 0.6 : undefined }}>
                  <span className="wt-box" style={onToday ? { background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff' } : undefined}>{onToday && <Icon name="check" size={18} />}</span>
                  <span style={{ flex: 1 }}>
                    <span className="wt-title" style={{ display: 'block' }}>{r.label}</span>
                    <span className="wt-hint" style={wp.met ? { color: 'var(--green)' } : undefined}>{busy ? 'Saving…' : `${badge}${onToday ? ' · logged today' : ''}`}</span>
                  </span>
                  <Icon name={r.icon || 'bolt'} size={22} style={{ color: wp.met ? 'var(--green)' : 'var(--muted-2)' }} />
                </button>
              )
            }
            return (
              <div key={r.id} className={'wk-photo' + (wp.met ? ' met' : '')}>
                <div className="wk-row">
                  <span className="wk-title">{r.label}</span>
                  <span className={'wk-badge' + (wp.met ? ' met' : '')}>{badge}</span>
                </div>
                <div className="slots-grid">
                  <PhotoSlot req={r} entry={log?.entriesByReq?.[r.id]} editable={editable}
                    uploading={uploading === r.id} onPick={(f) => onPick(r, f)} onClear={() => onClearPhotos(r)}
                    mealMode={!!myPlan && isMealReq(r)}
                    onCaption={() => setCaptioning({ req: r, entry: log?.entriesByReq?.[r.id] })} />
                </div>
              </div>
            )
          })}
        </>
      )}

      {!editable && !approved && (
        <p className="center muted" style={{ fontSize: 12, marginTop: 16 }}>This day is locked — you can only log proof on the current day.</p>
      )}

      {celebrate && (
        <DayComplete dayNum={dayNum} streak={(summaries[me.id]?.streak ?? 0) + 1}
          name={challenge.name} onClose={() => setCelebrate(false)} />
      )}

      {captioning && (
        <CaptionSheet req={captioning.req} entry={captioning.entry}
          onSave={async (text) => {
            const { id: eid } = captioning.entry
            const label = captioning.req.label
            setCaptioning(null)
            try {
              // Save the new caption (clears the stale estimate), show
              // "estimating…", then re-score the meal and refresh the numbers.
              await actions.saveCaption(eid, text)
              healed.current.add(eid) // we own this re-estimate; block the self-heal effect from double-firing
              await actions.refresh()
              if (text.trim()) {
                await actions.estimateMeal(eid)
                await actions.refresh()
              }
            } catch {
              healed.current.delete(eid) // failed — let the self-heal net retry it later
              setSaveErr(`Couldn't update "${label}" — check your connection and try again.`)
            }
          }}
          onClose={() => setCaptioning(null)} />
      )}
    </div>
  )
}

function PhotoSlot({ req, entry, editable, uploading, onPick, onClear, mealMode, onCaption }) {
  const paths = entry?.photoPaths?.length ? entry.photoPaths : (entry?.photoPath ? [entry.photoPath] : [])
  const filled = paths.length > 0
  const flagged = entry?.aiFlag && !entry.aiDismissed
  const canAddMore = editable && (!filled || (req.multi && paths.length < api.MAX_PHOTOS_PER_ITEM))
  const showCap = mealMode && filled // caption + macros live on the tile itself
  const hint = uploading ? 'Uploading…'
    : !filled ? (req.hint || 'Photo proof')
    : req.multi ? (canAddMore ? 'Tap to add another' : 'Full set')
    : 'Tap to retake'
  return (
    <label className={'slot' + (filled ? ' filled' : '') + (uploading ? ' uploading' : '') + (!(editable && (canAddMore || !req.multi)) ? ' locked' : '')}>
      {filled && <span className="slot-thumb"><ProofImage path={paths[paths.length - 1]} alt={req.label} /></span>}
      {!filled && <span className="slot-ic"><Icon name={req.icon || 'camera'} size={22} /></span>}
      {filled && !flagged && (
        <span className="slot-check">
          {req.multi && paths.length > 1
            ? <b style={{ fontSize: 11 }}>{paths.length}</b>
            : <Icon name="check" size={15} strokeWidth={2.4} />}
        </span>
      )}
      {flagged && <span className="ai-chip"><Icon name="bolt" size={11} />AI flag</span>}
      {req.multi && paths.length > 1 && <span className="slot-stack">{paths.length} photos</span>}
      {req.minMinutes && <span className="slot-min">{req.minMinutes} min</span>}
      {filled && editable && (
        <button className="slot-clear" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear() }} aria-label="Remove photos">
          <Icon name="x" size={13} strokeWidth={2.5} />
        </button>
      )}
      <span className="slot-label">{req.label}</span>
      {showCap ? (
        <button className={'slot-cap' + (entry?.caption ? '' : ' empty')}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCaption() }}>
          {entry?.caption ? (
            <>
              <span className="sc-text">{entry.caption}<Icon name="edit" size={11} className="sc-edit" /></span>
              <span className="sc-est">{entry.estProtein != null ? `~${entry.estProtein}g protein · ${entry.estCalories ?? '?'} cal · tap to edit` : 'estimating…'}</span>
            </>
          ) : (
            <span className="sc-text">＋ what was it?</span>
          )}
        </button>
      ) : (
        <span className="slot-hint">{hint}</span>
      )}
      {/* Camera capture only on phones/tablets — silently absent on desktop.
          Value reset lets iOS re-fire the picker for the same file after a retry. */}
      {(editable && (canAddMore || !req.multi)) && IS_MOBILE && <input type="file" accept="image/*" capture="environment"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />}
    </label>
  )
}

// Ad-hoc extra meal: a dashed "+" tile that shoots straight into the next
// free extra slot; the resulting tile is captioned like any meal.
function AddMealSlot({ uploading, onPick }) {
  return (
    <label className={'slot add-meal' + (uploading ? ' uploading' : '')}>
      <span className="slot-ic"><Icon name="plus" size={24} strokeWidth={2.2} /></span>
      <span className="slot-label">Add a meal</span>
      <span className="slot-hint">{uploading ? 'Uploading…' : 'optional · counts toward your goal'}</span>
      {IS_MOBILE && <input type="file" accept="image/*" capture="environment"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />}
    </label>
  )
}

function StatusBanner({ approved, rejected, complete, note, doneCount, total, hasReferee, t }) {
  if (approved) {
    return (
      <div className="daybanner done">
        <div className="db-title" style={{ color: 'var(--green)' }}>{t('today.banner.approved.title')}</div>
        <div className="db-sub">{t('today.banner.approved.sub', { note })}</div>
      </div>
    )
  }
  if (rejected) {
    return (
      <div className="daybanner rejected">
        <div className="db-title" style={{ color: 'var(--red)' }}>{t('today.banner.rejected.title')}</div>
        <div className="db-sub">{t('today.banner.rejected.sub', { note })}</div>
      </div>
    )
  }
  if (complete) {
    return hasReferee ? (
      <div className="daybanner review">
        <div className="db-title" style={{ color: 'var(--amber)' }}>{t('today.banner.review.title')}</div>
        <div className="db-sub">{t('today.banner.review.sub')}</div>
      </div>
    ) : (
      <div className="daybanner done">
        <div className="db-title" style={{ color: 'var(--green)' }}>{t('today.banner.done.title')}</div>
        <div className="db-sub">{t('today.banner.done.sub')}</div>
      </div>
    )
  }
  return (
    <div className="daybanner">
      <div className="db-title">{t('today.banner.togo.title', { k: total - doneCount })}</div>
      <div className="db-sub">{t('today.banner.togo.sub', { total })}</div>
    </div>
  )
}

function MacroRow({ label, value, unit, target, max }) {
  const goal = target || 1
  const pct = Math.min(100, Math.round((value / goal) * 100))
  // Earn your green: amber while under target, green once you've hit it.
  const color = target != null && value >= target ? 'var(--green)' : 'var(--amber)'
  const goalText = max && max !== target ? `${target}–${max}${unit}` : `${target}${unit}`
  return (
    <div className="mb-row">
      <span className="mb-label">{label}</span>
      <div className="bar" style={{ flex: 1 }}>
        <div className="bar-fill" style={{ width: pct + '%', background: color }} />
      </div>
      <span className="mb-num"><b>{value ? `~${value}` : 0}</b>{unit} / {goalText}</span>
    </div>
  )
}

// One-line meal description, edited in a small sheet; the AI reads photo +
// caption to estimate macros, which render on the tile itself.
function CaptionSheet({ req, entry, onSave, onClose }) {
  const [text, setText] = useState(entry?.caption || '')
  const [busy, setBusy] = useState(false)
  const submit = () => { if (text.trim() && !busy) { setBusy(true); onSave(text) } }
  return (
    <Sheet onClose={onClose} position="top">
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>{req.label}</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
        One line on what it was — the AI reads this plus the photo and updates your macro bar.
      </p>
      <input className="fr-input" style={{ width: '100%' }} autoFocus value={text}
        placeholder="e.g. 6 scrambled eggs + oatmeal with honey"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      {entry?.estProtein != null && (
        <p className="muted" style={{ fontSize: 12, margin: '8px 2px 0' }}>
          current estimate: ~{entry.estProtein}g protein · {entry.estCalories} cal
        </p>
      )}
      <div className="review-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-go" disabled={busy || !text.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  )
}

// Soft-mode hero: the big centered ring with the serif day number inside and
// an encouraging voice line below. The small Ring stays untouched for dark mode.
function SoftHero({ dayNum, done, total, date, complete, t }) {
  return (
    <div className="soft-hero">
      <div className="section-label" style={{ margin: 0 }}>Today · {date}</div>
      <HeroRing done={done} total={total} dayNum={dayNum} />
      <p className="sh-line">
        {complete ? t('today.hero.done') : t('today.hero.encourage', { k: total - done, total })}
      </p>
    </div>
  )
}

function HeroRing({ done, total, dayNum }) {
  const size = 190, sw = 10, r = size / 2 - sw - 2
  const c = 2 * Math.PI * r
  const off = c * (1 - (total ? done / total : 0))
  const colr = done === total && total > 0 ? 'var(--green)' : 'var(--brand)'
  const mid = size / 2
  return (
    <svg width={size} height={size} className="ring sh-ring">
      <circle className="ring-bg" cx={mid} cy={mid} r={r} fill="none" strokeWidth={sw} />
      <circle cx={mid} cy={mid} r={r} fill="none" strokeWidth={sw} stroke={colr}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }} />
      {/* .ring rotates -90deg; counter-rotate the text. Explicit y offsets, not
          dominant-baseline (iOS Safari is unreliable with webfont metrics). */}
      <text x={mid} y={mid - 4} textAnchor="middle" className="sh-day" transform={`rotate(90 ${mid} ${mid})`}>Day {dayNum}</text>
      <text x={mid} y={mid + 26} textAnchor="middle" className="sh-count" transform={`rotate(90 ${mid} ${mid})`}>{done} of {total}</text>
    </svg>
  )
}

function Ring({ done, total }) {
  const r = 26
  const c = 2 * Math.PI * r
  const pct = total ? done / total : 0
  const off = c * (1 - pct)
  const colr = done === total && total > 0 ? 'var(--green)' : 'var(--amber)'
  return (
    <svg width="68" height="68" className="ring">
      <circle className="ring-bg" cx="34" cy="34" r={r} fill="none" strokeWidth="6" />
      <circle cx="34" cy="34" r={r} fill="none" strokeWidth="6" stroke={colr} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      <text x="34" y="34" textAnchor="middle" dominantBaseline="central" className="ring-label" transform="rotate(90 34 34)">{done}/{total}</text>
    </svg>
  )
}
