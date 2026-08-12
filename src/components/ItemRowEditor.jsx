import Icon from './Icons.jsx'
import { timerAllowed } from '../config.js'

// One checklist item's editor row — shared by the AI review screen, the manual
// builder, and the post-create Edit Checklist sheet, so the controls (and their
// fixes) stay identical everywhere. Born from Mayssa's feedback (2026-07-17):
//   • Photo/Check is a segmented control now — the old single flipping badge
//     didn't read as tappable, so nobody knew items could switch kinds.
//   • The weekly pill is labeled "Times a week" (was "A few times a week",
//     which hid that you pick the number) and shows the count once active.
//   • Daily check items get a per-day count ("2× a day") for AM/PM-style
//     habits. Photos stay once-a-day; split them into two items instead.
// GrowText: auto-growing textarea so long labels wrap instead of clipping.
function GrowText({ className, value, placeholder, ariaLabel, onChange }) {
  return (
    <textarea
      className={className} value={value} placeholder={placeholder} rows={1}
      style={{ resize: 'none', overflow: 'hidden' }}
      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
      aria-label={ariaLabel} onChange={onChange} />
  )
}

// Minutes-after-midnight <-> the "HH:MM" a time input speaks.
const toClock = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
const fromClock = (v) => {
  const [h, m] = String(v || '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
const clockLabel = (m) => {
  const h = Math.floor(m / 60), mm = m % 60
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`
}

export default function ItemRowEditor({ it, onChange, onRemove, onMoveUp, onMoveDown }) {
  const wk = it.frequency === 'weekly'
  const mo = it.frequency === 'monthly'
  const perDay = Math.max(1, Number(it.timesPerDay) || 1)
  return (
    <div className="builder-row br-multi">
      <div className="br-main">
        <div className="kind-seg" role="group" aria-label="Log it as">
          <button type="button" className={it.kind === 'photo' ? 'on' : ''} title="Prove it with a photo"
            onClick={() => onChange({ kind: 'photo', icon: 'camera', timesPerDay: null })}>📷 Photo</button>
          <button type="button" className={it.kind === 'check' ? 'on' : ''} title="Just check it off"
            onClick={() => onChange({ kind: 'check', icon: 'bolt', captureOnly: false })}>✓ Check</button>
          {/* For the things a tick cannot honestly prove and a photo would mean
              handing over something private. Miska's weekly money check-in:
              she is not screenshotting her bank, and clicking a box is how you
              stop taking it seriously. */}
          <button type="button" className={it.kind === 'note' ? 'on' : ''} title="Write a short note"
            onClick={() => onChange({ kind: 'note', icon: 'edit', captureOnly: false, timesPerDay: null })}>✎ Note</button>
          {/* Timer only for things you DO for minutes — hidden on meals, water,
              photos, weigh-ins. Kept visible if the item already IS a timer, so
              it never gets stuck with no way to switch off. */}
          {(timerAllowed(it.label) || it.kind === 'timer') && (
            <button type="button" className={it.kind === 'timer' ? 'on' : ''} title="Run a built-in timer"
              onClick={() => onChange({ kind: 'timer', icon: 'clock', captureOnly: false, timesPerDay: null, minMinutes: it.minMinutes || 10 })}>⏱ Timer</button>
          )}
        </div>
        {/* Put related items next to each other. Two supplements belong side
            by side; arrows beat drag-and-drop inside a list that scrolls under
            your thumb. */}
        {(onMoveUp || onMoveDown) && (
          <span className="br-move">
            <button type="button" onClick={onMoveUp} disabled={!onMoveUp} title="Move up" aria-label="Move up">
              <Icon name="chevron" size={13} style={{ transform: 'rotate(-90deg)' }} />
            </button>
            <button type="button" onClick={onMoveDown} disabled={!onMoveDown} title="Move down" aria-label="Move down">
              <Icon name="chevron" size={13} style={{ transform: 'rotate(90deg)' }} />
            </button>
          </span>
        )}
        <button className="br-del" onClick={onRemove} title="Remove"><Icon name="x" size={15} /></button>
      </div>
      <div className="br-fields">
        <GrowText className="br-label" value={it.label} placeholder="e.g. 45-min workout" ariaLabel="Item name" onChange={(e) => onChange({ label: e.target.value })} />
        <GrowText className="br-hint" value={it.hint || ''}
          placeholder={it.kind === 'note' ? 'what should you answer? e.g. what moved, and what is next' : 'detail (optional)'}
          ariaLabel={it.kind === 'note' ? 'The question to answer' : 'Detail'}
          onChange={(e) => onChange({ hint: e.target.value })} />
      </div>
      {/* Four supplements as four tiles is a lot of screen for four taps.
          Items sharing a group name collapse into one (Miska). */}
      <div className="br-group">
        <label>Group</label>
        <input className="br-group-in" type="text" maxLength={24} value={it.group || ''}
          placeholder="none, e.g. Supplements"
          onChange={(e) => onChange({ group: e.target.value.trim() || null })} />
      </div>

      {/* A sleep screenshot answers both ends of the night at once, and unlike
          a checkbox it is evidence. Both times set makes this a sleep item. */}
      {it.kind === 'photo' && (
        it.sleepBy == null || it.wakeBy == null ? (
          <button type="button" className="br-due-add" style={{ marginTop: 8 }}
            onClick={() => onChange({ sleepBy: 60, wakeBy: 540, captureOnly: false })}>
            + Check this against a sleep screenshot
          </button>
        ) : (
          <div className="br-due br-sleep">
            <label>Asleep by</label>
            <input type="time" className="br-due-in" value={toClock(it.sleepBy)}
              onChange={(e) => onChange({ sleepBy: fromClock(e.target.value) })} />
            <label>Up by</label>
            <input type="time" className="br-due-in" value={toClock(it.wakeBy)}
              onChange={(e) => onChange({ wakeBy: fromClock(e.target.value) })} />
            <button type="button" className="br-due-x" aria-label="Remove the sleep check"
              onClick={() => onChange({ sleepBy: null, wakeBy: null })}><Icon name="x" size={12} /></button>
          </div>
        )
      )}

      {it.frequency !== 'weekly' && it.frequency !== 'monthly' && (
        <div className="br-due">
          {it.dueBy == null ? (
            <button type="button" className="br-due-add" onClick={() => onChange({ dueBy: 720 })}>
              + Add a time
            </button>
          ) : (
            <>
              <label>Do it by</label>
              <input type="time" className="br-due-in" value={toClock(it.dueBy)}
                onChange={(e) => onChange({ dueBy: fromClock(e.target.value) })} />
              <span className="br-due-say">{clockLabel(it.dueBy)}</span>
              <button type="button" className="br-due-x" onClick={() => onChange({ dueBy: null })} aria-label="Remove the time">
                <Icon name="x" size={12} />
              </button>
            </>
          )}
        </div>
      )}
      <div className="br-cadence">
        <div className="freq-toggle">
          <button type="button" className={!wk && !mo ? 'on' : ''}
            onClick={() => onChange({ frequency: 'daily', timesPerWeek: null, timesPerMonth: null })}>
            {!wk && !mo && perDay > 1 ? `${perDay}× a day` : 'Every day'}
          </button>
          <button type="button" className={wk ? 'on' : ''}
            onClick={() => onChange({ frequency: 'weekly', timesPerWeek: it.timesPerWeek || 2, timesPerMonth: null, timesPerDay: null })}>
            {wk ? `${it.timesPerWeek || 2}× a week` : 'Weekly'}
          </button>
          <button type="button" className={mo ? 'on' : ''}
            onClick={() => onChange({ frequency: 'monthly', timesPerMonth: it.timesPerMonth || 1, timesPerWeek: null, timesPerDay: null })}>
            {mo ? `${it.timesPerMonth || 1}× a month` : 'Monthly'}
          </button>
        </div>
        {wk && (
          <div className="freq-times">
            <button type="button" aria-label="Fewer times" onClick={() => onChange({ timesPerWeek: Math.max(1, (it.timesPerWeek || 2) - 1) })}><Icon name="minus" size={14} /></button>
            <span>{it.timesPerWeek || 2}× / week</span>
            <button type="button" aria-label="More times" onClick={() => onChange({ timesPerWeek: Math.min(6, (it.timesPerWeek || 2) + 1) })}><Icon name="plus" size={14} /></button>
          </div>
        )}
        {mo && (
          <div className="freq-times">
            <button type="button" aria-label="Fewer times" onClick={() => onChange({ timesPerMonth: Math.max(1, (it.timesPerMonth || 1) - 1) })}><Icon name="minus" size={14} /></button>
            <span>{it.timesPerMonth || 1}× / month</span>
            <button type="button" aria-label="More times" onClick={() => onChange({ timesPerMonth: Math.min(10, (it.timesPerMonth || 1) + 1) })}><Icon name="plus" size={14} /></button>
          </div>
        )}
        {!wk && !mo && it.kind === 'check' && (
          <div className="freq-times">
            <button type="button" aria-label="Fewer times a day" onClick={() => onChange({ timesPerDay: Math.max(1, perDay - 1) })}><Icon name="minus" size={14} /></button>
            <span>{perDay === 1 ? 'once a day' : `${perDay}× a day`}</span>
            <button type="button" aria-label="More times a day" onClick={() => onChange({ timesPerDay: Math.min(6, perDay + 1) })}><Icon name="plus" size={14} /></button>
          </div>
        )}
      </div>
      {it.kind === 'timer' && (
        // The built-in countdown: finish it and the item checks itself.
        <div className="br-cadence">
          <div className="freq-times">
            <button type="button" aria-label="Fewer minutes" onClick={() => onChange({ minMinutes: Math.max(1, (Number(it.minMinutes) || 10) - 5) })}><Icon name="minus" size={14} /></button>
            <span>{Number(it.minMinutes) || 10} min timer</span>
            <button type="button" aria-label="More minutes" onClick={() => onChange({ minMinutes: Math.min(180, (Number(it.minMinutes) || 10) + 5) })}><Icon name="plus" size={14} /></button>
          </div>
        </div>
      )}
      {it.kind === 'photo' && (
        // Where the photo can come from: uploads welcome (Oura screenshots,
        // saved pics) or camera-only for keep-yourself-honest live proof.
        <div className="br-cadence">
          <div className="freq-toggle">
            <button type="button" className={!it.captureOnly ? 'on' : ''}
              onClick={() => onChange({ captureOnly: false })}>Camera or upload</button>
            <button type="button" className={it.captureOnly ? 'on' : ''}
              onClick={() => onChange({ captureOnly: true })}>Camera only</button>
          </div>
        </div>
      )}
    </div>
  )
}
