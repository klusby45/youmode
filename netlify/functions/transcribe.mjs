// Speech-to-text for the voice-first onboarding. The client records a short
// ramble with MediaRecorder, base64-encodes it, and posts it here; we hand it
// to OpenAI Whisper and return the transcript. It's a throwaway blob — nothing
// is stored. The user edits the transcript before it ever reaches the coach.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via the Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// mime type → filename extension, so Whisper detects the container. Whisper
// keys off the extension: AAC audio (what iOS Safari's audio/mp4 MediaRecorder
// produces) must be sent as ".m4a" — as ".mp4" Whisper 400s on audio-only files.
const EXT = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/wave': 'wav',
}

// Handle preflight + stamp CORS on every response (this function returns early
// a lot; the wrapper keeps CORS on all of them).
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
  const OPENAI = process.env.OPENAI_API_KEY
  if (!SUPABASE_URL || !SERVICE || !OPENAI) return Response.json({ error: 'not configured' }, { status: 503 })

  try {
    // 1. Verify the caller is a real signed-in user.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401 })

    // 2. Decode the base64 clip. A 90s recording is well under Netlify's ~6 MB
    //    body cap; reject anything larger as insurance.
    const { audio, mimeType } = await req.json()
    if (!audio || typeof audio !== 'string') return Response.json({ error: 'audio required' }, { status: 400 })
    // Netlify caps a function's request body around 6 MB, so this is a wall we
    // cannot lift from here, only report honestly. The client segments long
    // recordings so it should not be reached; if it is, say what to do instead
    // of failing with a shrug after someone has talked for ten minutes.
    if (audio.length > 5_600_000) {
      return Response.json({
        error: 'That take is too long to send in one piece. Stop it and record again in a few shorter takes, and they will be joined together.',
      }, { status: 413 })
    }
    // Browsers append ";codecs=..." to the mime; strip it before lookup.
    const base = String(mimeType || '').split(';')[0].trim().toLowerCase()
    const ext = EXT[base] || 'webm'
    const bytes = Buffer.from(audio, 'base64')

    // 3. Whisper multipart transcription.
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: base || 'application/octet-stream' }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('response_format', 'json')
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI}` }, body: form,
    })
    if (!r.ok) {
      const raw = await r.text()
      console.error('whisper', r.status, raw.slice(0, 300))
      let code = ''
      try { const j = JSON.parse(raw); code = j?.error?.code || j?.error?.type || '' } catch { /* non-JSON */ }
      const msg = r.status === 401 ? 'transcription auth failed — check OPENAI_API_KEY'
        : r.status === 429 ? 'transcription unavailable — OpenAI quota or rate limit'
        : 'transcription failed'
      return Response.json({ error: msg, upstreamStatus: r.status, code }, { status: 502 })
    }
    const out = await r.json()
    return Response.json({ text: String(out.text || '').trim() })
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

export const config = { path: '/api/transcribe' }
