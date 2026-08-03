// Read a blood panel (photo, screenshot, or PDF) and return the markers it
// contains. Extraction ONLY — this never writes to the database. The member
// reviews what was read and confirms it in the app before anything is saved,
// because a silently misread ApoB would set a wrong target and nobody would
// ever know why.
//
// The file is held in memory for one request and discarded. Nothing is stored.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via the Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const MAX_BYTES = 8 * 1024 * 1024 // Netlify bodies die well before this
const IMAGE = /^image\/(jpeg|png|gif|webp)$/

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
  if (!SUPABASE_URL || !SERVICE || !ANTHROPIC) {
    return Response.json({ error: 'not configured' }, { status: 500 })
  }

  try {
    const { fileBase64, mime, today } = await req.json()
    if (!fileBase64) return Response.json({ error: 'file required' }, { status: 400 })

    // Signed-in members only. This reads someone's medical document; it is not
    // an anonymous endpoint.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401 })

    const bytes = Math.ceil((fileBase64.length * 3) / 4)
    if (bytes > MAX_BYTES) {
      return Response.json({ error: 'That file is too large. Try a screenshot of the results pages.' }, { status: 413 })
    }

    // Claude reads images natively and text-based PDFs as documents, so a
    // phone photo, a screenshot and a downloaded PDF all work the same way.
    let block
    if (IMAGE.test(mime || '')) {
      block = { type: 'image', source: { type: 'base64', media_type: mime, data: fileBase64 } }
    } else if ((mime || '').includes('pdf')) {
      block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    } else {
      return Response.json({ error: 'Upload a photo, screenshot, or PDF of your results.' }, { status: 400 })
    }

    // Reading a multi-page panel takes the model longer than the gateway will
    // hold a silent response (a real PDF 504'd here). Same fix the coaches
    // use: newline heartbeats keep bytes flowing, the JSON body lands last,
    // and leading whitespace is legal JSON so the client parses it unchanged.
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({
      start(controller) {
        const beat = setInterval(() => {
          try { controller.enqueue(encoder.encode('\n')) } catch { clearInterval(beat) }
        }, 900)
        const send = (obj) => {
          clearInterval(beat)
          try { controller.enqueue(encoder.encode(JSON.stringify(obj))); controller.close() } catch { /* client gone */ }
        }
        ;(async () => {
          try { send(await readPanel({ block, today, ANTHROPIC })) }
          catch (e) { send({ error: String(e?.message || e) }) }
        })()
      },
    }), { headers: JSON_HEADERS })
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

// The function itself is killed a little past 30 seconds. Stop reading before
// that and keep whatever arrived, rather than being cut off holding nothing.
const DEADLINE_MS = 24000

async function readPanel({ block, today, ANTHROPIC }) {
  {
    const ctl = new AbortController()
    const deadline = setTimeout(() => ctl.abort(), DEADLINE_MS)
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
      body: JSON.stringify({
        stream: true, // so a slow read yields partial markers, not a dead request
        // Sonnet, deliberately. This is transcription, not judgment: the model
        // copies printed numbers, it does not interpret them, and the member
        // checks every row on screen before anything saves. Opus was tried and
        // is genuinely better at reasoning, but a full panel took it past the
        // function's execution limit, so it returned nothing at all. A read
        // that finishes beats a read that times out.
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system:
          'You read blood panels and return the results as data. Transcribe only what is printed. ' +
          'NEVER infer, estimate, or fill in a value that is not clearly legible: if a number is cut off, blurry, or ambiguous, omit that marker entirely rather than guessing. A missing marker is fine; a wrong one is not. ' +
          'Do not diagnose, interpret, or comment on the results. You are a transcriber here, not a clinician. ' +
          'Capture the draw date if it is printed, and the panel or lab name if present. ' +
          // A full modern panel runs past 100 markers, which is more output
          // than the function has time to generate. Bounding it is not a
          // shortcut: 90 of those markers are CBC differentials nobody sets a
          // goal against, and the ones that matter are the flagged ones.
          'Return AT MOST 35 markers, most important first. Start with EVERY marker the report flags as out of range, then fill the rest with the ones a person would actually discuss: lipids, metabolic, inflammation, thyroid, kidney, liver, key vitamins and hormones. Skip differential blood counts unless flagged. ' +
          'Slugs, where they apply: apob, lpa, ldl, hdl, triglycerides, total_cholesterol, non_hdl, hba1c, glucose, insulin, crp, tsh, alt, ast, creatinine, egfr, vitamin_d, b12, ferritin, testosterone_total, testosterone_free, psa, sodium, potassium. Otherwise a short lowercase slug of your own.\n' +
          // Positional rows, not named objects: a full panel of named JSON runs
          // long enough that the response outlives the function. Same data,
          // roughly a third of the tokens.
          'Return ONLY strict JSON on the final line, nothing after it. Markers are positional rows of ' +
          '[name exactly as printed, slug, numeric value, unit, printed reference range, flag]. ' +
          'The flag is "H", "L", or "" based ONLY on how the report itself marked it:\n' +
          '{"d":"YYYY-MM-DD or null","p":"panel or lab name or null","m":[["Apolipoprotein B","apob",101,"mg/dL","<90","H"]]}',
        messages: [{
          role: 'user',
          content: [
            block,
            { type: 'text', text: `Transcribe the markers from this blood panel. Today is ${today || 'unknown'}; the draw date must not be in the future. Omit anything you cannot read clearly.` },
          ],
        }],
      }),
    })
    if (!aRes.ok) {
      clearTimeout(deadline)
      const detail = await aRes.text().catch(() => '')
      return { error: 'Could not read that file. Try a clearer photo.', upstreamStatus: aRes.status, detail: detail.slice(0, 300) }
    }

    // Accumulate the text deltas. An abort at the deadline lands in the catch
    // with `text` holding everything read so far, which the salvage below
    // turns into real markers.
    let text = ''
    let stop = null
    try {
      const reader = aRes.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'content_block_delta' && ev.delta?.text) text += ev.delta.text
            if (ev.type === 'message_delta' && ev.delta?.stop_reason) stop = ev.delta.stop_reason
          } catch { /* keepalive or partial frame */ }
        }
      }
    } catch { stop = 'cut_short' } finally { clearTimeout(deadline) }

    // Take the last balanced JSON object in the reply.
    let parsed = null
    const start = text.lastIndexOf('{"d"')
    const candidate = start >= 0 ? text.slice(start) : text
    for (let end = candidate.length; end > 0 && !parsed; end = candidate.lastIndexOf('}', end - 1)) {
      try { parsed = JSON.parse(candidate.slice(0, end + 1)) } catch { /* keep shrinking */ }
    }

    // Salvage a truncated reply. Rows are flat arrays with nothing nested, so
    // every complete [...] before the cut is still a real, whole marker. The
    // model is told to emit out-of-range results first, which means a partial
    // read keeps the numbers that matter and loses the filler. Better than
    // handing back nothing because the last row got clipped.
    if (!Array.isArray(parsed?.m) || !parsed.m.length) {
      const rows = []
      for (const chunk of candidate.slice(candidate.indexOf('"m":[')).match(/\[[^[\]]*\]/g) || []) {
        try { rows.push(JSON.parse(chunk)) } catch { /* clipped row */ }
      }
      if (rows.length) {
        parsed = {
          d: candidate.match(/"d":"(\d{4}-\d{2}-\d{2})"/)?.[1] || null,
          p: candidate.match(/"p":"([^"]*)"/)?.[1] || null,
          m: rows,
        }
      }
    }

    if (!Array.isArray(parsed?.m) || !parsed.m.length) {
      // Truncation reads exactly like a blank panel from here, so say which it
      // was rather than telling someone their clear PDF was unreadable.
      return {
        error: stop === 'max_tokens' || stop === 'cut_short'
          ? 'That panel is longer than we can read in one pass. Try a screenshot of just the results pages.'
          : "Couldn't find any results in that file. Try a clearer photo of the results pages.",
      }
    }

    // Positional rows back into the shape the app stores: [name, slug, value,
    // unit, ref, flag]. Anything without a name and a real number is dropped
    // rather than saved as a hole.
    const clean = parsed.m
      .filter((r) => Array.isArray(r) && r[0] && Number.isFinite(+r[2]))
      .slice(0, 80)
      .map(([name, slug, value, unit, ref, flag]) => ({
        name: String(name).slice(0, 80),
        slug: String(slug || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || null,
        value: +value,
        unit: String(unit || '').slice(0, 20),
        ref: String(ref || '').slice(0, 40),
        flag: { H: 'high', L: 'low' }[String(flag || '').toUpperCase()] || 'normal',
      }))
    if (!clean.length) {
      return { error: "Couldn't find any results in that file. Try a clearer photo of the results pages." }
    }

    const drawn = /^\d{4}-\d{2}-\d{2}$/.test(parsed.d || '') ? parsed.d : null
    return {
      drawnOn: drawn && (!today || drawn <= today) ? drawn : null,
      panelName: parsed.p ? String(parsed.p).slice(0, 80) : null,
      markers: clean,
      // A clipped read still returns markers. Say so, so a short list reads as
      // "we ran out of room" rather than "this is your whole panel".
      partial: stop === 'max_tokens' || stop === 'cut_short',
    }
  }
}
