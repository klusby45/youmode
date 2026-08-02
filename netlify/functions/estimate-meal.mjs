// Meal macro estimation for body-goal users: reads the meal photo(s) + the
// member's one-line caption and estimates protein + calories. Estimates feed
// the daily rollup — awareness numbers, not gospel; weekly weigh-ins are the
// ground truth that self-corrects the plan.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via the Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Handle the preflight and stamp CORS on every response so the app can call
// this cross-origin (the dev preview points at the deployed function).
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

    // Caller must be a real signed-in user who owns the entry.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401 })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401 })
    const user = await uRes.json()

    const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
    const eRes = await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}&select=*,requirements(*)`, { headers: svc })
    const [entry] = await eRes.json()
    if (!entry) return Response.json({ error: 'entry not found' }, { status: 404 })
    if (entry.user_id !== user.id) return Response.json({ error: 'not your entry' }, { status: 403 })

    // Only for members with a body plan, on photo entries.
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/body_plans?user_id=eq.${entry.user_id}&select=id`, { headers: svc })
    const plans = await pRes.json()
    if (!plans.length) return Response.json({ skipped: 'no body plan' }, { status: 200 })
    const paths = entry.photo_paths?.length ? entry.photo_paths : (entry.photo_path ? [entry.photo_path] : [])
    if (!paths.length && !entry.caption) return Response.json({ skipped: 'nothing to estimate' }, { status: 200 })

    const photoUrls = []
    for (const p of paths.slice(0, 4)) {
      const sRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/proof/${p}`, {
        method: 'POST', headers: { ...svc, ...JSON_HEADERS }, body: JSON.stringify({ expiresIn: 300 }),
      })
      const signed = await sRes.json()
      if (signed?.signedURL) photoUrls.push(`${SUPABASE_URL}/storage/v1${signed.signedURL}`)
    }

    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system:
          'You estimate nutrition from a meal photo and the eater\'s one-line description. ' +
          'The description is AUTHORITATIVE for what the meal is and the quantities. If it says "6 eggs", estimate 6 eggs even if the photo makes portions hard to judge. ' +
          'Use the photo only to fill in items the description omits and to catch wild mismatches (description says steak, photo shows salad, then estimate the photo). ' +
          'Work it out step by step before answering. List every distinct food and ingredient on its own line with its own calories, protein, carbohydrate, total fat, SATURATED fat, and fiber, using realistic standard nutrition values. ' +
          'Reference points: one large egg is about 75 cal, 6g protein, 5g fat, 1.6g saturated, 0g fiber. 1 tbsp butter about 120 cal and 7g saturated. 1 oz hard cheese about 9g fat and 6g saturated. 4 oz cooked chicken breast about 1g saturated. 4 oz fatty red meat (ribeye, lamb, kefta, birria) about 7 to 9g saturated. Dry rolled oats per half cup about 150 cal, 27g carb, 4g fiber. 1 tbsp chia about 5g fiber. Half a cup of cooked beans about 7g fiber. Half an avocado about 5g fiber. Coconut oil and movie-theater popcorn are unusually high in saturated fat. ' +
          'Include the easy-to-miss items so you do not undercount: cooking oil or butter, sauces, dressings, syrups, and nut butters. But keep every line realistic and do not inflate. Add every line up. ' +
          'Saturated fat and fiber matter most here, so reason about them explicitly for each line rather than guessing at the end. Saturated fat can never exceed total fat. ' +
          'After the itemized list, output the totals as strict JSON on the final line, with nothing after it: {"protein_g": <int>, "calories": <int>, "carbs_g": <int>, "fat_g": <int>, "sat_fat_g": <int>, "fiber_g": <int>}',
        messages: [{
          role: 'user',
          content: [
            ...photoUrls.map((u) => ({ type: 'image', source: { type: 'url', url: u } })),
            { type: 'text', text: `Meal: "${entry.requirements?.label || 'meal'}". Description: "${entry.caption || '(none — estimate from photo only)'}". Estimate calories, protein, carbs, total fat, saturated fat, and fiber.` },
          ],
        }],
      }),
    })
    if (!aRes.ok) return Response.json({ skipped: 'ai unavailable' }, { status: 200 })
    const ai = await aRes.json()
    const text = ai?.content?.find((b) => b.type === 'text')?.text || ''
    // The model itemizes each food first, then emits the totals as the final
    // JSON object. Grab the LAST flat {...} so the reasoning can't fool the parse.
    const objs = text.match(/\{[^{}]*\}/g) || []
    let est = {}
    try { est = JSON.parse(objs[objs.length - 1] || '{}') } catch { /* skip */ }
    const clamp = (v, hi) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.round(v))) : null)
    const protein = clamp(est.protein_g, 300)
    const calories = clamp(est.calories, 4000)
    const carbs = clamp(est.carbs_g, 600)
    const fat = clamp(est.fat_g, 300)
    let satFat = clamp(est.sat_fat_g, 200)
    const fiber = clamp(est.fiber_g, 100)
    // Saturated fat is a subset of total fat; a model slip that violates that
    // would quietly corrupt the one number a lipid panel cares most about.
    if (satFat != null && fat != null && satFat > fat) satFat = fat
    if (protein == null && calories == null) return Response.json({ skipped: 'unparseable estimate' }, { status: 200 })

    // New columns land in their own PATCH so a pre-migration database still
    // stores protein and calories instead of failing the whole write.
    await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}`, {
      method: 'PATCH',
      headers: { ...svc, ...JSON_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ est_protein: protein, est_calories: calories }),
    })
    let stored = false
    if (carbs != null || fat != null || satFat != null || fiber != null) {
      const ext = await fetch(`${SUPABASE_URL}/rest/v1/log_entries?id=eq.${entryId}`, {
        method: 'PATCH',
        headers: { ...svc, ...JSON_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ est_carbs: carbs, est_fat: fat, est_sat_fat: satFat, est_fiber: fiber }),
      })
      stored = ext.ok
    }
    return Response.json({ ok: true, protein, calories, carbs, fat, satFat, fiber, extendedStored: stored })
  } catch (e) {
    return Response.json({ skipped: String(e?.message || e) }, { status: 200 })
  }
}

export const config = { path: '/api/estimate-meal' }
