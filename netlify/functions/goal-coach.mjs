// Goal coach: a scoped chat that interviews the user about a body/nutrition
// goal, negotiates realistic targets, and proposes a structured plan.
// The chat NEVER writes to the database — its only side-effecting output is a
// validated plan proposal the user must explicitly accept in the app.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SYSTEM = `You are the goal coach inside a 75-Hard-style accountability app. Members describe a body/nutrition goal; you interview briefly, negotiate honestly, then propose a structured plan.

How to behave:
- Keep replies SHORT (2-4 sentences), friendly, direct. No lectures, no bullet-point essays. Plain text only, no markdown, asterisks, or headers (the chat renders raw text).
- Ask AT MOST one clarifying question per message, and only what you actually need: current weight, height, rough activity level, timeline. If they already gave enough, propose immediately.
- BE HONEST ABOUT FEASIBILITY. Sustainable fat loss ≈ 0.5-1% of bodyweight/week; lean muscle gain ≈ 0.25-0.5 lb/week for most trained people. If their timeline is unrealistic, say so plainly and propose the honest version (right goal, adjusted date or target). Never rubber-stamp an infeasible goal.
- SAFETY FLOORS (hard rules): never propose under 1,400 calories/day; never propose loss faster than 1% bodyweight/week; protein 0.7-1g per lb of target weight. If the request pattern-matches disordered eating, or the user appears to be a minor, or mentions pregnancy, an eating disorder history, diabetes, or medications: do NOT propose a plan. Warmly recommend they work with a doctor or registered dietitian instead.
- YOU CAN SEE THEIR FOOD LOG. If a NUTRITION LOG block appears below it holds their real logged meals with this app's photo estimates. Answer questions about what they ate from those rows, by name and by number. "I can't see your meals" is never true when that block is present.
- A QUESTION IS NOT A GOAL REQUEST. "How could I have cut saturated fat today" wants an answer about today's food, not a new plan. Answer it with specific swaps for the specific meals they logged, and stop. Only reach for the tool when a target genuinely should change, and when you do, say which number is moving and why.
- SCOPE: you only plan body-composition and nutrition goals. The app tracks daily meal photos with AI estimates of calories, protein, carbs, total fat, SATURATED FAT, FIBER, SODIUM and SUGAR, plus optional weekly weigh-ins with a trend line. You cannot track anything else. If asked for other goal types, say what you can and can't hold them to. For off-topic requests (homework, emails, general chat), politely decline and steer back.
- A NUTRITION GOAL DOES NOT REQUIRE A WEIGHT GOAL. Plenty of people want to raise fiber, cut saturated fat, or lower sodium with no interest in the scale. When that is what they want, set mode 'targets', fill only the nutrient fields that matter, and leave every weight field out. Never invent a target weight to make a plan look complete.
- Never use em dashes. Use a comma, a period, or a colon.
- BLOOD WORK. If a BLOOD WORK block appears below, you already have their results: never ask them to read you a number that is sitting right there, and never mention files, PDFs, or uploads, because you are handed text and never a document. Only ask for numbers when there is no block and they have told you none.
- Say what a marker means FOR THE TARGET. A high ApoB or LDL is precisely why you would put saturated fat near 6 percent of calories instead of 10, and saying so is the insight they came for. What you do not do: diagnose, name a condition, estimate their risk, discuss medication, or second-guess their doctor. Keep it on the plate, and tell them to take the numbers themselves to their doctor.
- BE HONEST ABOUT WHAT FOOD CAN MOVE, the same way you are honest about an impossible deadline. Some markers barely respond to diet. Lipoprotein(a) is the clearest case: it is largely genetic, roughly fixed for life, and no fiber or saturated fat target will meaningfully lower it. If someone asks for a goal aimed at a marker like that, say so plainly in one sentence, then point at what they CAN move (ApoB, LDL and non-HDL all respond to saturated fat and fiber) and propose that instead. Never accept a goal aimed at a number the plan cannot change.
- When they ask what you suggest and you already have what you need, CALL THE TOOL IN THAT SAME TURN. Do not answer a request for a recommendation with a question, and do not ask "want me to add that as a goal?": the proposal card IS that question, and it carries accept and keep-tweaking buttons. Asking first just costs them a round trip. Common anchors: fiber 25-38g/day; saturated fat under 10 percent of calories, or under about 6 percent when cholesterol or ApoB is high; sodium under 2300mg; added sugar under about 10 percent of calories.
- Plans are estimates, not medical advice; weekly weigh-ins are the truth that corrects the targets.

When you have enough information and the goal is safe and realistic, call the propose_plan tool. Put a one-line human summary in goal_text (e.g. "170 lbs, lean gain by Dec 31" or "more fiber, less saturated fat"). Alongside the tool call, tell them the reasoning in one or two sentences.`

const TOOL = {
  name: 'propose_plan',
  description: 'Propose the final structured plan. Only call when you have enough info and the plan is safe and realistic. The user must accept it in the app before it takes effect.',
  input_schema: {
    type: 'object',
    required: ['goal_text', 'mode'],
    properties: {
      goal_text: { type: 'string', description: 'One-line summary, <=120 chars, e.g. "170 lbs, lean gain by Dec 31" or "more fiber, less saturated fat"' },
      mode: { type: 'string', enum: ['aware', 'targets'], description: '"targets" whenever you are proposing numbers to aim at. "aware" only if they want the figures shown with nothing to hit.' },
      fiber_target: { type: 'integer', description: 'Daily fiber floor in grams, typically 25-38.' },
      sat_fat_max: { type: 'integer', description: 'Daily saturated fat ceiling in grams.' },
      sodium_max: { type: 'integer', description: 'Daily sodium ceiling in mg, usually 2300.' },
      sugar_max: { type: 'integer', description: 'Daily added sugar ceiling in grams.' },
      start_weight: { type: 'number', description: 'Current weight in lbs, if known' },
      target_weight: { type: 'number', description: 'Target weight in lbs. OMIT for a nutrition-only goal.' },
      target_date: { type: 'string', description: 'YYYY-MM-DD' },
      protein_min: { type: 'integer', description: 'Daily protein floor, grams' },
      protein_max: { type: 'integer', description: 'Daily protein ceiling, grams' },
      calorie_target: { type: 'integer', description: 'Daily calorie target' },
      rate_target: { type: 'number', description: 'Target lbs per week; negative = loss' },
    },
  },
}

// ── the food log ─────────────────────────────────────────────────────────
// Detail decays with age, because that is how the questions decay: today gets
// every meal and every macro, the past week gets a line a day, the rest of the
// month gets totals worth trending against.
const DETAIL_DAYS = 7
const WINDOW_DAYS = 30

const ymd = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000))

function macroLine(e) {
  const bits = [
    e.est_protein != null && `${e.est_protein}g protein`,
    e.est_calories != null && `${e.est_calories} cal`,
    e.est_sat_fat != null && `${e.est_sat_fat}g sat fat`,
    e.est_fiber != null && `${e.est_fiber}g fiber`,
    e.est_sodium != null && `${e.est_sodium}mg sodium`,
    e.est_sugar != null && `${e.est_sugar}g sugar`,
  ].filter(Boolean)
  return bits.join(', ')
}

const sum = (rows, k) => {
  const vals = rows.map((r) => r[k]).filter((v) => v != null)
  return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null
}
const totalLine = (rows) => macroLine({
  est_protein: sum(rows, 'est_protein'), est_calories: sum(rows, 'est_calories'),
  est_sat_fat: sum(rows, 'est_sat_fat'), est_fiber: sum(rows, 'est_fiber'),
})

async function mealBlock(SUPABASE_URL, SERVICE, userId) {
  const q = `${SUPABASE_URL}/rest/v1/day_logs?user_id=eq.${userId}&log_date=gte.${daysAgo(WINDOW_DAYS)}`
    + '&select=log_date,log_entries(requirement_id,caption,est_protein,est_calories,est_sat_fat,est_fiber,est_sodium,est_sugar)'
    + '&order=log_date.desc'
  const [logsRes, reqsRes] = await Promise.all([
    fetch(q, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }),
    fetch(`${SUPABASE_URL}/rest/v1/requirements?user_id=eq.${userId}&select=id,label,kind&order=sort`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }),
  ])
  const days = await logsRes.json()
  const labels = Object.fromEntries((await reqsRes.json()).map((r) => [r.id, r.label]))
  if (!Array.isArray(days) || !days.length) return ''

  // Only entries carrying an estimate are food; a checked-off workout is not.
  const eaten = (d) => (d.log_entries || []).filter((e) => e.caption || e.est_calories != null)
  const withFood = days.filter((d) => eaten(d).length)
  if (!withFood.length) return ''

  const out = []
  withFood.slice(0, DETAIL_DAYS).forEach((d, i) => {
    const rows = eaten(d)
    out.push(`${i === 0 ? 'MOST RECENT DAY, ' : ''}${d.log_date}:`)
    for (const e of rows) {
      const what = (e.caption || '').trim().slice(0, 160) || 'no description'
      out.push(`  ${labels[e.requirement_id] || 'Meal'}: "${what}" ${macroLine(e) || 'no estimate'}`)
    }
    out.push(`  day total: ${totalLine(rows) || 'nothing estimated'}`)
  })

  const older = withFood.slice(DETAIL_DAYS)
  if (older.length) {
    out.push(`\nEarlier days (totals only):`)
    for (const d of older) out.push(`  ${d.log_date}: ${totalLine(eaten(d)) || 'nothing estimated'}`)
  }

  // Averages across the window, so "am I usually over" has an answer.
  const all = withFood.flatMap(eaten)
  const n = withFood.length
  const avg = (k) => { const t = sum(all, k); return t == null ? null : Math.round(t / n) }
  out.push(`\nAverage per day over ${n} logged day${n === 1 ? '' : 's'}: `
    + macroLine({ est_protein: avg('est_protein'), est_calories: avg('est_calories'), est_sat_fat: avg('est_sat_fat'), est_fiber: avg('est_fiber') }))

  const body = out.join('\n').slice(0, 12000)
  return `\n\nNUTRITION LOG (their own logged meals, with this app's photo estimates):\n${body}\n`
    // Superhuman repeats its critical instruction after the data as well as
    // before it. The failure this fixes was the model claiming blindness while
    // the answer sat in its context, so the reminder goes where it will be
    // read last.
    + `\nYou CAN see the meals above. When they ask what they ate, how a day went, or how they could have hit a target, answer from these rows: name the actual meals, use the actual numbers, and suggest swaps for the specific foods they actually ate. Never say you cannot see their meals or their log. If they ask about a day older than this window, say which dates you can see.`
}

// Their own results, already read by the app. Bounded and stringified here so
// a malformed client can't reshape the system prompt.
function labBlock(note) {
  const s = String(note || '').trim().slice(0, 2500)
  return s ? `\n\nBLOOD WORK (their own results, already read into the app). Use these. Do not ask them to repeat any number below:\n${s}` : ''
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))

// Every field except the summary is optional. Requiring a target weight here
// meant "I want more fiber" could not be expressed as a plan at all.
function validateProposal(input, today) {
  const opt = (v, lo, hi) => (v == null || !Number.isFinite(+v) ? null : Math.round(clamp(+v, lo, hi)))
  const p = {
    goalText: String(input.goal_text || '').slice(0, 200),
    mode: input.mode === 'aware' ? 'aware' : 'targets',
    startWeight: input.start_weight ? clamp(input.start_weight, 60, 500) : null,
    targetWeight: input.target_weight != null ? clamp(input.target_weight, 70, 400) : null,
    targetDate: null,
    proteinMin: opt(input.protein_min, 50, 300),
    proteinMax: opt(input.protein_max, 50, 300),
    calorieTarget: opt(input.calorie_target, 1400, 6000),
    fiberTarget: opt(input.fiber_target, 5, 100),
    satFatMax: opt(input.sat_fat_max, 5, 100),
    sodiumMax: opt(input.sodium_max, 500, 10000),
    sugarMax: opt(input.sugar_max, 5, 200),
    rateTarget: input.rate_target != null ? clamp(input.rate_target, -2, 2) : null,
  }
  if (p.proteinMin != null && p.proteinMax != null && p.proteinMax < p.proteinMin) p.proteinMax = p.proteinMin
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.target_date || '')) {
    const t = Date.parse(input.target_date)
    const min = Date.parse(today) + 7 * 864e5
    const max = Date.parse(today) + 3 * 365 * 864e5
    if (t >= min && t <= max) p.targetDate = input.target_date
  }
  return p
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE = process.env.SUPABASE_SERVICE_KEY
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY
  const H = { ...JSON_HEADERS, ...CORS }
  if (!SUPABASE_URL || !SERVICE || !ANTHROPIC) {
    return Response.json({ error: 'not configured' }, { status: 503, headers: H })
  }

  try {
    // Auth: any signed-in member.
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401, headers: H })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401, headers: H })
    const user = await uRes.json()

    // Existing plans (if any) become coach context: members can stack goals
    // or rework one; the app asks add-vs-replace when they accept.
    let planContext = ''
    try {
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/body_plans?user_id=eq.${user.id}&select=*&order=created_at`, {
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      })
      const plans = await pRes.json()
      if (plans.length) {
        const lines = plans.map((p) => `- "${p.goal_text}": target ${p.target_weight} lbs${p.target_date ? ` by ${p.target_date}` : ''}, ${p.protein_min}-${p.protein_max}g protein, ${p.calorie_target} cal/day, ${p.rate_target} lb/wk`).join('\n')
        planContext = `\n\nThis member's current goal plan(s):\n${lines}\nThey can ADD another goal alongside these, or REWORK one (propose the full updated plan). Daily targets merge across their plans field by field: the newest plan that sets a field owns it, and fields you leave out keep whatever an earlier plan set. So a goal about saturated fat alone will NOT disturb their protein or calorie targets. If you do intend to change a number they are already aiming at, set it explicitly and say so. If they ask what their current plan is, tell them.`
      }
    } catch { /* plan context is optional */ }

    // Their actual food log. "I can't see individual meals" was a true
    // statement about a coach that had never been handed the data, and it is
    // the wrong answer to "look at my meals today": the app knows exactly what
    // they ate. Superhuman's Ask AI grounds every answer in the user's real
    // mail rather than deflecting, and needs hybrid search over five years to
    // do it. A month of meals is small enough to simply hand over.
    let mealContext = ''
    try {
      mealContext = await mealBlock(SUPABASE_URL, SERVICE, user.id)
    } catch { /* the coach still works without it */ }

    // Bounded input: short conversations only (cost + scope containment).
    const { messages, labNote } = await req.json()
    if (!Array.isArray(messages) || !messages.length) return Response.json({ error: 'messages required' }, { status: 400, headers: H })
    if (messages.length > 24) return Response.json({ reply: "Let's start fresh. That conversation got long, so tell me your goal in one message.", proposal: null }, { headers: H })
    const clean = messages.slice(-24).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 1200),
    }))

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 700,
        // Lab results ride in the SYSTEM prompt, not as a chat message. As a
        // message they sat at position 0, lost weight as the thread grew, and
        // fell off entirely once slice(-24) kicked in, which is how the coach
        // ended up asking someone to recite numbers it had already read.
        system: `${SYSTEM}\n\nToday's date: ${today}.${planContext}${labBlock(labNote)}${mealContext}`,
        tools: [TOOL],
        messages: clean,
      }),
    })
    if (!aRes.ok) {
      const detail = await aRes.text()
      console.error('anthropic error', aRes.status, detail.slice(0, 300))
      return Response.json({ reply: "I'm having trouble thinking right now. Try again in a minute.", proposal: null }, { headers: H })
    }
    const ai = await aRes.json()
    if (ai.stop_reason === 'refusal') {
      return Response.json({ reply: "I can't help plan that one. If this is health-related, a doctor or registered dietitian is the right move.", proposal: null }, { headers: H })
    }
    const reply = (ai.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    const toolUse = (ai.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_plan')
    const proposal = toolUse ? validateProposal(toolUse.input, today) : null

    return Response.json({
      reply: reply || (proposal ? "Here's the plan I'd hold you to. Review it and accept if it looks right." : '…'),
      proposal,
    }, { headers: H })
  } catch (e) {
    return Response.json({ reply: 'Something went sideways. Try again.', proposal: null, error: String(e?.message || e) }, { status: 200, headers: H })
  }
}

export const config = { path: '/api/goal-coach' }
