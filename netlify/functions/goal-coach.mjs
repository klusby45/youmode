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
- Keep replies SHORT (2-4 sentences), friendly, direct. No lectures, no bullet-point essays. Plain text only — no markdown, asterisks, or headers (the chat renders raw text).
- Ask AT MOST one clarifying question per message, and only what you actually need: current weight, height, rough activity level, timeline. If they already gave enough, propose immediately.
- BE HONEST ABOUT FEASIBILITY. Sustainable fat loss ≈ 0.5-1% of bodyweight/week; lean muscle gain ≈ 0.25-0.5 lb/week for most trained people. If their timeline is unrealistic, say so plainly and propose the honest version (right goal, adjusted date or target). Never rubber-stamp an infeasible goal.
- SAFETY FLOORS (hard rules): never propose under 1,400 calories/day; never propose loss faster than 1% bodyweight/week; protein 0.7-1g per lb of target weight. If the request pattern-matches disordered eating, or the user appears to be a minor, or mentions pregnancy, an eating disorder history, diabetes, or medications: do NOT propose a plan — warmly recommend they work with a doctor or registered dietitian instead.
- SCOPE: you only plan body-composition/nutrition goals. The app tracks: daily meal photos with AI macro estimates vs. protein/calorie targets, and weekly weigh-ins with a trend line. You cannot track anything else — if asked for other goal types, say what you can and can't hold them to. For off-topic requests (homework, emails, general chat), politely decline and steer back.
- Plans are estimates, not medical advice; weekly weigh-ins are the truth that corrects the targets.

When you have enough information and the goal is safe and realistic, call the propose_plan tool. Put a one-line human summary in goal_text (e.g. "170 lbs · lean gain by Dec 31"). Alongside the tool call, tell them the reasoning in one or two sentences.`

const TOOL = {
  name: 'propose_plan',
  description: 'Propose the final structured plan. Only call when you have enough info and the plan is safe and realistic. The user must accept it in the app before it takes effect.',
  input_schema: {
    type: 'object',
    required: ['goal_text', 'target_weight', 'protein_min', 'protein_max', 'calorie_target', 'rate_target'],
    properties: {
      goal_text: { type: 'string', description: 'One-line summary, ≤120 chars, e.g. "170 lbs · lean gain by Dec 31"' },
      start_weight: { type: 'number', description: 'Current weight in lbs, if known' },
      target_weight: { type: 'number', description: 'Target weight in lbs' },
      target_date: { type: 'string', description: 'YYYY-MM-DD' },
      protein_min: { type: 'integer', description: 'Daily protein floor, grams' },
      protein_max: { type: 'integer', description: 'Daily protein ceiling, grams' },
      calorie_target: { type: 'integer', description: 'Daily calorie target' },
      rate_target: { type: 'number', description: 'Target lbs per week; negative = loss' },
    },
  },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))

function validateProposal(input, today) {
  const p = {
    goalText: String(input.goal_text || '').slice(0, 200),
    startWeight: input.start_weight ? clamp(input.start_weight, 60, 500) : null,
    targetWeight: clamp(input.target_weight, 70, 400),
    targetDate: null,
    proteinMin: Math.round(clamp(input.protein_min, 50, 300)),
    proteinMax: Math.round(clamp(input.protein_max, 50, 300)),
    calorieTarget: Math.round(clamp(input.calorie_target, 1400, 6000)),
    rateTarget: clamp(input.rate_target, -2, 2),
  }
  if (p.proteinMax < p.proteinMin) p.proteinMax = p.proteinMin
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
    // or rework one — the app asks add-vs-replace when they accept.
    let planContext = ''
    try {
      const pRes = await fetch(`${SUPABASE_URL}/rest/v1/body_plans?user_id=eq.${user.id}&select=*&order=created_at`, {
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      })
      const plans = await pRes.json()
      if (plans.length) {
        const lines = plans.map((p) => `- "${p.goal_text}": target ${p.target_weight} lbs${p.target_date ? ` by ${p.target_date}` : ''}, ${p.protein_min}-${p.protein_max}g protein, ${p.calorie_target} cal/day, ${p.rate_target} lb/wk`).join('\n')
        planContext = `\n\nThis member's current goal plan(s):\n${lines}\nThey can ADD another goal alongside these, or REWORK one (propose the full updated plan). The newest accepted plan's protein/calorie targets drive their daily macro bar — if a new goal implies different daily targets than an existing plan, point out the conflict and recommend which should lead. If they ask what their current plan is, tell them.`
      }
    } catch { /* plan context is optional */ }

    // Bounded input: short conversations only (cost + scope containment).
    const { messages } = await req.json()
    if (!Array.isArray(messages) || !messages.length) return Response.json({ error: 'messages required' }, { status: 400, headers: H })
    if (messages.length > 24) return Response.json({ reply: "Let's start fresh — that conversation got long. Tell me your goal in one message.", proposal: null }, { headers: H })
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
        system: `${SYSTEM}\n\nToday's date: ${today}.${planContext}`,
        tools: [TOOL],
        messages: clean,
      }),
    })
    if (!aRes.ok) {
      const detail = await aRes.text()
      console.error('anthropic error', aRes.status, detail.slice(0, 300))
      return Response.json({ reply: "I'm having trouble thinking right now — try again in a minute.", proposal: null }, { headers: H })
    }
    const ai = await aRes.json()
    if (ai.stop_reason === 'refusal') {
      return Response.json({ reply: "I can't help plan that one — if this is health-related, a doctor or registered dietitian is the right move.", proposal: null }, { headers: H })
    }
    const reply = (ai.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    const toolUse = (ai.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_plan')
    const proposal = toolUse ? validateProposal(toolUse.input, today) : null

    return Response.json({
      reply: reply || (proposal ? "Here's the plan I'd hold you to — review it and accept if it looks right." : '…'),
      proposal,
    }, { headers: H })
  } catch (e) {
    return Response.json({ reply: 'Something went sideways — try again.', proposal: null, error: String(e?.message || e) }, { status: 200, headers: H })
  }
}

export const config = { path: '/api/goal-coach' }
