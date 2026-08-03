import { useMemo, useState } from 'react'
import { useApp } from '../appContext.js'
import { buildExport } from '../lib/healthExport.js'
import Icon from './Icons.jsx'
import Sheet from './Sheet.jsx'

const RANGES = [{ d: 30, label: '30 days' }, { d: 90, label: '90 days' }, { d: 3650, label: 'Everything' }]

// Hand the member their own history as files they can give to a lab AI or a
// doctor. Generated on the device from data already loaded, so nothing is
// uploaded anywhere: the app produces a file and the person decides where it
// goes. That property is the feature, not an implementation detail.
export default function ExportSheet({ onClose }) {
  const { cfg, me, reqsFor, logsFor, myMember } = useApp()
  const [days, setDays] = useState(30)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)

  const out = useMemo(
    () => buildExport({
      name: myMember?.displayName || 'Member',
      cfg, reqs: reqsFor(me.id), logs: logsFor(me.id), days,
    }),
    [cfg, me.id, reqsFor, logsFor, days, myMember],
  )

  const stamp = cfg.todayStr
  const files = () => {
    const f = [new File([out.markdown], `youmode-summary-${stamp}.md`, { type: 'text/markdown' }),
      new File([out.dailyCsv], `youmode-daily-${stamp}.csv`, { type: 'text/csv' })]
    if (out.mealCsv) f.push(new File([out.mealCsv], `youmode-meals-${stamp}.csv`, { type: 'text/csv' }))
    return f
  }

  function download() {
    try {
      for (const f of files()) {
        const url = URL.createObjectURL(f)
        const a = document.createElement('a')
        a.href = url; a.download = f.name
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
      setDone('Saved to your downloads.')
    } catch { setErr("Couldn't save the files. Try Share instead.") }
  }

  async function share() {
    const f = files()
    try {
      if (navigator.canShare?.({ files: f })) {
        await navigator.share({ files: f, title: 'You Mode export' })
        setDone('Shared.')
      } else { download() }
    } catch (e) {
      if (e?.name !== 'AbortError') download()
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Export my data</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        For Superpower, Function Health, or your doctor.
      </p>

      <div className="freq-toggle" style={{ marginBottom: 14 }}>
        {RANGES.map((r) => (
          <button key={r.d} type="button" className={days === r.d ? 'on' : ''} onClick={() => setDays(r.d)}>{r.label}</button>
        ))}
      </div>

      {!out ? (
        <div className="card center muted" style={{ padding: 18, fontSize: 13 }}>Nothing logged in this range yet.</div>
      ) : (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="ex-stats">
              <span><b>{out.stats.days}</b> days</span>
              <span><b>{out.stats.meals}</b> meals</span>
              {out.stats.kcal && <span><b>{out.stats.kcal}</b> kcal/day</span>}
              {out.stats.satFat != null && <span><b>{out.stats.satFat}g</b> sat fat</span>}
              {out.stats.fiber != null && <span><b>{out.stats.fiber}g</b> fiber</span>}
            </div>
          </div>

          {done && <div className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>{done}</div>}
          {err && <div className="login-err" style={{ textAlign: 'left', marginBottom: 10 }}>{err}</div>}

          <div className="review-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-ghost" onClick={download}><Icon name="upload" size={16} />Download</button>
            <button className="btn btn-accent" onClick={share}><Icon name="upload" size={16} />Share</button>
          </div>

          <p className="muted" style={{ fontSize: 12, margin: '14px 2px 0', lineHeight: 1.5 }}>
            Three files: a summary, a day-by-day table, and your meals. Nutrition numbers are
            estimates from your photos and descriptions. Nothing leaves your phone until you send it.
          </p>
        </>
      )}
      <button className="auth-flip" onClick={onClose}>Close</button>
    </Sheet>
  )
}
