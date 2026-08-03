import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import * as api from '../data.js'
import Icon from './Icons.jsx'
import Sheet from './Sheet.jsx'

// Blood work in, so the coach can anchor targets to real numbers instead of
// whatever you remembered to type.
//
// Nothing saves until the member has seen what was read. A silently misread
// ApoB would set a wrong nutrition target and there would be no way to trace
// it back, so extraction and saving are deliberately two separate steps with
// the numbers on screen in between.
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function LabSheet({ onClose }) {
  const { me, cfg } = useApp()
  const [stage, setStage] = useState('pick') // pick | reading | review | saved
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState(null) // { drawnOn, panelName, markers }
  const [saved, setSaved] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.listLabResults(me.id).then(setSaved).catch(() => {}) }, [me.id])

  async function onPick(file) {
    if (!file) return
    setErr(null); setStage('reading')
    try {
      const b64 = await toBase64(file)
      const out = await api.extractLabs(b64, file.type, cfg.todayStr)
      setDraft({ ...out, drawnOn: out.drawnOn || cfg.todayStr })
      setStage('review')
    } catch (e) {
      setErr(e.message || 'Could not read that file.')
      setStage('pick')
    }
  }

  async function confirm() {
    setBusy(true); setErr(null)
    try {
      await api.saveLabResult(me.id, draft)
      setSaved(await api.listLabResults(me.id))
      setStage('saved')
    } catch (e) {
      setErr(/relation|does not exist/i.test(e.message || '')
        ? "Results aren't switched on yet. Try again once the update lands."
        : e.message)
      setBusy(false)
    }
  }

  const drop = (i) => setDraft((d) => ({ ...d, markers: d.markers.filter((_, j) => j !== i) }))
  const flagged = draft?.markers.filter((m) => m.flag !== 'normal').length || 0

  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Add blood work</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
        So your goals can use real numbers.
      </p>

      {stage === 'pick' && (
        <>
          <label className="lab-drop">
            <Icon name="upload" size={22} />
            <span className="ld-title">Photo, screenshot, or PDF</span>
            <span className="ld-sub">Your results page, however you have it</span>
            <input type="file" accept="image/*,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />
          </label>
          {err && <div className="login-err" style={{ textAlign: 'left', marginTop: 10 }}>{err}</div>}
          <p className="muted" style={{ fontSize: 12, margin: '12px 2px 0', lineHeight: 1.5 }}>
            The file is read once and never stored. Only the numbers you confirm are saved, and only you can see them.
          </p>
        </>
      )}

      {stage === 'reading' && (
        <div className="card center" style={{ padding: 22 }}>
          <div className="muted" style={{ fontSize: 13 }}>Reading your results…</div>
        </div>
      )}

      {stage === 'review' && draft && (
        <>
          <div className="row-split" style={{ gap: 8, marginBottom: 12 }}>
            <label className="field" style={{ flex: 1 }}>
              <span className="f-label">Drawn on</span>
              <input className="fr-input" type="date" value={draft.drawnOn}
                onChange={(e) => setDraft((d) => ({ ...d, drawnOn: e.target.value }))} />
            </label>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            Check these against your report. Remove anything that reads wrong.
            {draft.partial && ' Long panel, so this is the out-of-range results plus the main ones.'}
          </p>
          <div className="lab-list">
            {draft.markers.map((m, i) => (
              <div key={i} className={'lab-row' + (m.flag !== 'normal' ? ' flag' : '')}>
                <span className="lr-name">{m.name}</span>
                <span className="lr-val">
                  <b>{m.value}</b>{m.unit ? ` ${m.unit}` : ''}
                  {m.ref ? <small> · ref {m.ref}</small> : null}
                </span>
                <button className="lr-x" onClick={() => drop(i)} aria-label={`Remove ${m.name}`}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
          {err && <div className="login-err" style={{ textAlign: 'left', marginTop: 10 }}>{err}</div>}
          <div className="review-actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setDraft(null); setStage('pick') }}>Start over</button>
            <button className="btn btn-accent" disabled={busy || !draft.markers.length} onClick={confirm}>
              {busy ? 'Saving…' : `Save ${draft.markers.length}`}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '12px 2px 0' }}>
            {flagged > 0 ? `${flagged} out of range. ` : ''}These are your numbers, not advice. Talk to your doctor about what they mean.
          </p>
        </>
      )}

      {stage === 'saved' && (
        <div className="card center" style={{ padding: 20 }}>
          <Icon name="check" size={24} />
          <div style={{ marginTop: 8, fontSize: 14 }}>Saved.</div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Ask the coach for a goal and it will use these.
          </p>
        </div>
      )}

      {saved.length > 0 && stage !== 'review' && (
        <>
          <div className="section-label" style={{ marginTop: 18 }}>On file</div>
          {saved.map((l) => (
            <div key={l.id} className="lab-saved">
              <span><b>{l.drawnOn}</b>{l.panelName ? ` · ${l.panelName}` : ''}</span>
              <span className="muted" style={{ fontSize: 12 }}>{l.markers.length} markers</span>
              <button className="lr-x" aria-label="Delete"
                onClick={async () => { await api.deleteLabResult(l.id); setSaved(await api.listLabResults(me.id)) }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </>
      )}

      <button className="auth-flip" onClick={onClose}>Close</button>
    </Sheet>
  )
}
