// Read a sleep screenshot (Oura, Whoop, Apple Health, a watch face) and check
// the times against what the member committed to.
//
// This is the first thing in the app that is genuinely VERIFIABLE rather than
// self-reported. A checkbox that says "in bed by 1am" is a promise; a
// screenshot from a ring that was on your finger is evidence. So the bar for
// what counts is high: if the times cannot be read clearly, this says so and
// flags nothing, because a wrong "you missed it" is worse than no check.
//
// One screenshot answers both halves of the night: last night's bedtime and
// this morning's wake time.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via the Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const clock = (m) => {
  if (m == null) return null
  const h = Math.floor(m / 60), mm = m % 60
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(mm).padStart(2, '0')}${ampm}`
}

// "1:42am" -> 102. Night-time hours stay small so they compare cleanly against
// a target like 1:00am; an 11pm bedtime becomes negative-ish (1380) and is
// handled by the comparison below rather than here.
const toMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(String(s || '').trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = (m[3] || '').toLowerCase()
  if (ap === 'pm' && h !== 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// A bedtime before midnight beats any small-hours target, so fold the evening
// onto the same line as the morning: 11:20pm reads as "before 1:00am".
const bedtimeOk = (bed, target) => (bed >= 12 * 60 ? true : bed <= target)

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const res = await handle(req)
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v)
  return res
}

async function handle(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_KEY
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY
  if (!SUPABASE_URL || !SERVICE || !ANTHROPIC) return Response.json({ skipped: 'not configured' }, { status: 200 })

  try {
    const { entryId } = await req.json()
    if (!entryId) return Response.json({ error: 'entryId required' }, { status: 400 })

    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` } })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401 })
    const user = await uRes.json()

    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
    const eRes = await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}&select=*,requirements(*)`, { headers: svc })
    const [entry] = await eRes.json()
    if (!entry) return Response.json({ error: 'entry not found' }, { status: 404 })
    if (entry.user_id !== user.id) return Response.json({ error: 'not your entry' }, { status: 403 })

    const req_ = entry.requirements || {}
    if (req_.sleep_by == null || req_.wake_by == null) return Response.json({ skipped: 'not a sleep item' }, { status: 200 })
    const path = entry.photo_paths?.[0] || entry.photo_path
    if (!path) return Response.json({ skipped: 'no photo' }, { status: 200 })

    const sRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/proof/${path}`, {
      method: 'POST', headers: { ...svc, ...JSON_HEADERS }, body: JSON.stringify({ expiresIn: 300 }),
    })
    const signed = await sRes.json()
    if (!signed?.signedURL) return Response.json({ skipped: 'photo unavailable' }, { status: 200 })

    const ctl = new AbortController()
    const deadline = setTimeout(() => ctl.abort(), 22000)
    let ai = null
    try {
      const aRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 400,
          system:
            'You read sleep summaries from screenshots: Oura, Whoop, Apple Health, Garmin, a phone bedtime screen. ' +
            'Find the time the person FELL ASLEEP or went to bed, and the time they WOKE UP or got up, for the single night the screenshot shows. ' +
            'Report them exactly as printed, as h:mm with am or pm. ' +
            'NEVER guess. If the screenshot does not clearly show both times, or it is not a sleep screenshot at all, say so instead: a wrong reading here tells someone they broke a streak they did not break. ' +
            'Sleep duration alone is not a bedtime. A bar chart with no labelled times is not a reading. ' +
            'Return ONLY strict JSON on the final line: {"readable": true|false, "bedtime": "h:mmam or null", "wake": "h:mmam or null", "source": "what app or screen this looks like", "why": "if unreadable, one short reason"}',
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: `${SUPABASE_URL}/storage/v1${signed.signedURL}` } },
              { type: 'text', text: 'Read the bedtime and the wake time from this sleep screenshot.' },
            ],
          }],
        }),
      })
      if (aRes.ok) ai = await aRes.json()
    } catch { /* aborted or network */ } finally { clearTimeout(deadline) }

    const text = ai?.content?.find((b) => b.type === 'text')?.text || ''
    let out = null
    for (const m of (text.match(/\{[\s\S]*\}/g) || []).reverse()) {
      try { out = JSON.parse(m); break } catch { /* keep looking */ }
    }
    if (!out) return Response.json({ skipped: 'could not read the screenshot' }, { status: 200 })

    const bed = toMinutes(out.bedtime)
    const wake = toMinutes(out.wake)
    const readable = out.readable !== false && bed != null && wake != null

    // Unreadable is NOT a failure. Say what happened and flag nothing: this is
    // evidence, and the app should never call someone a liar on a blurry photo.
    let note, flag
    if (!readable) {
      flag = false
      note = `Couldn't read the times off this one${out.why ? ` (${String(out.why).slice(0, 80)})` : ''}. It still counts as logged.`
    } else {
      const bedOk = bedtimeOk(bed, req_.sleep_by)
      const wakeOk = wake <= req_.wake_by
      const bedTxt = `in bed ${clock(bed)}`
      const wakeTxt = `up ${clock(wake)}`
      flag = !(bedOk && wakeOk)
      note = bedOk && wakeOk
        ? `${bedTxt}, ${wakeTxt}. Both on target.`
        : `${bedTxt}${bedOk ? '' : ` (target ${clock(req_.sleep_by)})`}, ${wakeTxt}${wakeOk ? '' : ` (target ${clock(req_.wake_by)})`}.`
    }

    await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}`, {
      method: 'PATCH',
      headers: { ...svc, ...JSON_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ ai_flag: flag, ai_note: note, ai_dismissed: false }),
    })

    return Response.json({ ok: true, readable, bedtime: out.bedtime || null, wake: out.wake || null, onTarget: !flag, note })
  } catch (e) {
    return Response.json({ skipped: String(e?.message || e) }, { status: 200 })
  }
}
