// AI spot check: reviews an uploaded proof photo against its requirement.
// It only ever FLAGS (the member can dismiss, a referee can weigh in) — it
// never fails a day on its own.
//
// Env (set on the Netlify site, server-side only):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via the Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Handle preflight + stamp CORS on every response so the native app (and dev
// preview) can call this cross-origin.
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
    return Response.json({ skipped: 'not configured' }, { status: 200 })
  }

  try {
    const { entryId } = await req.json()
    if (!entryId) return Response.json({ error: 'entryId required' }, { status: 400 })

    // 1. Verify the caller is a real signed-in user.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401 })
    const user = await uRes.json()

    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }

    // 2. Load the entry + its requirement; the caller must own the entry.
    const eRes = await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}&select=*,requirements(*)`, { headers: svc })
    const [entry] = await eRes.json()
    if (!entry) return Response.json({ error: 'entry not found' }, { status: 404 })
    if (entry.user_id !== user.id) return Response.json({ error: 'not your entry' }, { status: 403 })
    const paths = entry.photo_paths?.length ? entry.photo_paths : (entry.photo_path ? [entry.photo_path] : [])
    if (!paths.length) return Response.json({ skipped: 'no photo' }, { status: 200 })
    const reqmt = entry.requirements

    // 3. Signed URLs for the full photo set (multi-photo items send them all).
    const photoUrls = []
    for (const p of paths.slice(0, 4)) {
      const sRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/proof/${p}`, {
        method: 'POST', headers: { ...svc, ...JSON_HEADERS }, body: JSON.stringify({ expiresIn: 300 }),
      })
      const signed = await sRes.json()
      if (signed?.signedURL) photoUrls.push(`${SUPABASE_URL}/storage/v1${signed.signedURL}`)
    }
    if (!photoUrls.length) return Response.json({ skipped: 'could not sign photos' }, { status: 200 })

    // 4. Ask Claude for a plausibility check — plus duration certification
    //    when the requirement carries a minimum (e.g. workouts totaling 45 min).
    const minMin = reqmt?.min_minutes || null
    const durationRule = minMin
      ? ` This requirement also has a MINIMUM TOTAL DURATION of ${minMin} minutes. The photo(s) should be fitness-tracker/Apple Watch style screenshots showing workout durations or start–end times. Read every visible duration (e.g. "0:55:37", "45:12", or start–end times like "4:22PM–5:18PM") across ALL photos and ADD THEM UP. If the combined total is clearly under ${minMin} minutes, or no duration is readable in any photo, set ok=false and say what you could read (e.g. "I can only verify 32 of ${minMin} min across 2 screenshots").`
      : ''
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system:
          'You are a friendly accountability spot-checker for a 75-Hard-style challenge app. ' +
          'Given a daily requirement and the photo(s) a participant uploaded as proof (multiple photos are one combined session), judge whether they PLAUSIBLY satisfy the requirement. ' +
          'Be lenient on subject matching — only flag photos that clearly do not match (wrong subject entirely, unrelated screenshot, blank/black image, obvious stock imagery). ' +
          'Duration minimums, when given, are strict: verify them from what is actually readable.' +
          durationRule +
          ' Respond with ONLY strict JSON: {"ok": true|false, "note": "<one short, friendly sentence, max 140 chars — if a duration was checked, include the total you read>"}',
        messages: [{
          role: 'user',
          content: [
            ...photoUrls.map((u) => ({ type: 'image', source: { type: 'url', url: u } })),
            { type: 'text', text: `Requirement: "${reqmt?.label || 'daily proof'}"${reqmt?.hint ? ` (${reqmt.hint})` : ''}${minMin ? ` — minimum ${minMin} minutes total` : ''}. ${photoUrls.length > 1 ? `These ${photoUrls.length} photos are one combined session.` : ''} Does this proof plausibly satisfy it?` },
          ],
        }],
      }),
    })
    if (!aRes.ok) return Response.json({ skipped: 'ai unavailable' }, { status: 200 })
    const ai = await aRes.json()
    const text = ai?.content?.find((b) => b.type === 'text')?.text || ''
    let verdict = { ok: true, note: '' }
    try { verdict = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}') } catch { /* lenient default */ }
    if (typeof verdict.ok !== 'boolean') verdict.ok = true

    // 5. Store the result (flag only when not ok).
    await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}`, {
      method: 'PATCH',
      headers: { ...svc, ...JSON_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        ai_flag: !verdict.ok,
        ai_note: verdict.ok ? null : String(verdict.note || '').slice(0, 200),
      }),
    })

    return Response.json({ ok: verdict.ok })
  } catch (e) {
    // Spot checks are best-effort; never surface a hard failure to the app.
    return Response.json({ skipped: String(e?.message || e) }, { status: 200 })
  }
}

export const config = { path: '/api/review-photo' }
