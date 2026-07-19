import { useState } from 'react'
import Sheet from './Sheet.jsx'
import Icon from './Icons.jsx'
import ItemRowEditor from './ItemRowEditor.jsx'
import { slugify } from '../config.js'
import * as api from '../data.js'

// Post-create checklist editing (Mayssa: "i wish i could just change a check
// task to a photo task" — after the challenge exists). Same ItemRowEditor as
// the builders, so kind, cadence, and per-day counts stay editable for life.
// Only YOUR items; body-plan extra meal slots are handled upstream in App.
export default function EditChecklistSheet({ reqs, onSave, onClose }) {
  const [items, setItems] = useState(reqs.map((r) => ({ ...r })))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const updateItem = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const removeItem = (i) => setItems((xs) => xs.filter((_, j) => j !== i))
  const addItem = (kind) => setItems((xs) => [...xs, { key: '', label: '', hint: '', group: 'Custom', icon: kind === 'photo' ? 'camera' : kind === 'timer' ? 'clock' : 'bolt', kind, ...(kind === 'timer' ? { minMinutes: 10 } : {}) }])

  // Talk-to-edit (Miska): describe changes in plain words; the setup guide
  // proposes the full revised list, which lands back in these same editors for
  // review. Matching by label keeps existing items' ids (and their history).
  const [aiText, setAiText] = useState('')
  const [aiMsgs, setAiMsgs] = useState([]) // running conversation for follow-ups
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState(null)

  async function askGuide() {
    const want = aiText.trim()
    if (!want || aiBusy) return
    setAiBusy(true); setAiNote(null)
    try {
      const current = items.filter((it) => (it.label || '').trim()).map((it) => ({
        label: it.label, kind: it.kind, hint: it.hint || undefined,
        frequency: it.frequency || 'daily',
        times_per_week: it.timesPerWeek || undefined, times_per_day: it.timesPerDay || undefined,
        times_per_month: it.timesPerMonth || undefined, min_minutes: it.minMinutes || undefined,
      }))
      const ask = `I already have a challenge running. Here is my CURRENT checklist as JSON: ${JSON.stringify(current)}. I want these changes: ${want}. Propose the FULL updated checklist with propose_challenge — keep every item I did not mention exactly as it is (same label, kind, cadence), and do not change the challenge concept.`
      const next = [...aiMsgs, { role: 'user', content: aiMsgs.length ? want : ask }]
      const { reply, proposal } = await api.onboardChat(next)
      setAiMsgs([...next, { role: 'assistant', content: reply || '(updated)' }])
      if (proposal?.items?.length) {
        setItems(proposal.items.map((p) => {
          const slug = slugify(p.label || '')
          const old = items.find((x) => x.key === slug || slugify(x.label || '') === slug)
          return {
            ...(old || {}), label: p.label, kind: p.kind, hint: p.hint || '',
            group: old?.group || p.group || 'Custom', icon: p.icon || old?.icon || (p.kind === 'photo' ? 'camera' : p.kind === 'timer' ? 'clock' : 'bolt'),
            frequency: p.frequency || 'daily', timesPerWeek: p.timesPerWeek ?? null,
            timesPerDay: p.timesPerDay ?? null, timesPerMonth: p.timesPerMonth ?? null,
            minMinutes: p.minMinutes ?? old?.minMinutes ?? null,
          }
        }))
        setAiNote("Here's the updated list — look it over, tweak anything, then save.")
        setAiText('')
      } else {
        setAiNote(reply || 'The guide needs a bit more detail — try describing the change differently.')
      }
    } catch {
      setAiNote("Couldn't reach the guide — check your connection and try again.")
    } finally {
      setAiBusy(false)
    }
  }

  async function save() {
    setBusy(true); setErr(null)
    try {
      const seen = new Set(), out = []
      for (const it of items) {
        const label = (it.label || '').trim()
        if (!label) continue
        let key = it.key || slugify(label)
        while (seen.has(key)) key += '_2'
        seen.add(key)
        out.push({ ...it, label, key })
      }
      if (!out.length) throw new Error('Keep at least one item')
      await onSave(out)
      onClose()
    } catch (e) {
      setErr(e?.message || 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Sheet onClose={onClose}>
      <div className="screen-title" style={{ fontSize: 20, marginBottom: 4 }}>Your checklist</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 14px' }}>
        Changes apply from today forward. Removing an item deletes its logged history.
      </p>
      {items.map((it, i) => (
        <ItemRowEditor key={it.id || 'new-' + i} it={it}
          onChange={(patch) => updateItem(i, patch)}
          onRemove={() => removeItem(i)} />
      ))}
      <div className="row-split" style={{ marginTop: 4 }}>
        <button className="btn btn-sm" onClick={() => addItem('photo')}><Icon name="camera" size={14} />Add photo item</button>
        <button className="btn btn-sm" onClick={() => addItem('check')}><Icon name="check" size={14} />Add checkmark</button>
        <button className="btn btn-sm" onClick={() => addItem('timer')}><Icon name="clock" size={14} />Add timer</button>
      </div>

      <div className="section-label" style={{ marginTop: 16 }}>Or just tell the guide</div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
        Describe the change in your own words and it updates the list above for you to review.
      </p>
      <div className="field">
        <textarea value={aiText} rows={2} placeholder={'e.g. "make reading a timer instead" or "add stretching every morning"'}
          disabled={aiBusy} onChange={(e) => setAiText(e.target.value)} />
      </div>
      {aiNote && <p className="muted" style={{ fontSize: 12, margin: '2px 2px 8px' }}>{aiNote}</p>}
      <button className="btn btn-sm" disabled={aiBusy || !aiText.trim()} onClick={askGuide}>
        <Icon name="sparkle" size={14} />{aiBusy ? 'Thinking…' : 'Update my list'}
      </button>

      {err && <div className="login-err">{err}</div>}
      <button className="btn btn-accent btn-block" style={{ marginTop: 14 }} disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save my checklist'}
      </button>
      <button className="auth-flip" onClick={onClose}>Cancel</button>
    </Sheet>
  )
}
