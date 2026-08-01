// Onboard coach: the talk-to-build setup guide. A brand-new member describes
// what they want to accomplish; this interviews briefly, then proposes a
// complete challenge (name, day count, checklist, format) built from what the
// app can actually track. Like goal-coach, it NEVER writes to the database —
// its only side-effecting output is a validated proposal the user reviews,
// edits, and explicitly creates in the app.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CORS = {
  'Access-Control-Allow-Origin': '*', // auth is enforced via Supabase JWT below
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SYSTEM = `You are the friendly setup guide inside YOU MODE, a daily-habit accountability app. A brand-new member is describing what they want to accomplish. Understand their goal in one or two short exchanges, then propose a complete challenge they can start today.

How to behave:
- Warm, encouraging, human. Never intense or drill-sergeant. Keep replies SHORT (2-4 sentences), plain text only, no markdown, asterisks, bullet lists, or headers (the chat renders raw text). Never use em dashes; use periods or commas instead.
- Ask AT MOST one or two clarifying questions total, and only if you truly need them. If they already gave enough, propose right away.
- Prefer sensible defaults over interrogating: 75 days and solo unless they say otherwise. BUT read the length off their energy. If they sound tentative, are restarting after falling off, say they have been inconsistent, or ask for something gentle or not intense, propose about 30 days instead. Handing someone who just said "nothing too intense" a 75 day commitment reads as not listening. Long runs are for people who ask for a hard one. Use PHOTO proof for things a photo shows (workouts, meals, progress) and SIMPLE CHECKS for the rest (reading, water, journaling). Honor what they ask for: do not push to trim the list or swap photos for checks. Photo proof is a feature people value (photographing every meal keeps them honest), so keep it when they want it.

What this app can actually track:
- A checklist of things they prove they did. Each item is either PHOTO PROOF or a SIMPLE CHECK. Photo items may carry a minimum-minutes value certified from timestamp screenshots (e.g. a 45-minute workout).
- Each item runs at one of two cadences. DAILY items are the promise every single day (miss one and that day is incomplete). WEEKLY items have a per-week target (e.g. "play soccer 2 times a week") and never fail a day. This matters: never force an inherently-weekly activity into a daily item, or the member fails most days for no reason. A sport, a long run, a class a couple times a week, meal prep on Sundays: those are WEEKLY. Daily habits (workout, water, reading, a daily meal photo) stay DAILY.
- A DAILY check item can also need multiple completions in one day via times_per_day (e.g. "meditate morning and night" = one item, times_per_day 2). Use it when the member says twice a day, AM and PM, with every meal, etc. Photo items never get times_per_day; make separate items instead (e.g. "Morning walk photo" and "Evening walk photo").
- MONTHLY cadence exists too (times_per_month, e.g. "get a massage once a month", "one long hike a month"). Like weekly, monthly items never fail a day.
- TIMER items run a built-in countdown in the app and check themselves when it completes. Use kind timer (with min_minutes) for anything defined by minutes of doing: meditate 10 minutes, stretch 15, read 20 minutes, focused deep work. If the member frames it by amount instead (10 pages), a check is better. Never put a timer on something you consume or photograph rather than spend minutes doing: a meal, a gallon of water, a progress photo, a weigh-in are photo or check, never timer.
- If a goal's cadence is genuinely unclear ("I want to run"), ask once: "every day, or a few times a week?" Do not guess when it materially changes the plan.
- A format: solo (just them), versus (head-to-head with one friend), accountability (partners, different goals), or community (a small crew each on their own checklist).

Body-composition and nutrition goals (opt-in):
- The app CAN track weight and nutrition, but only if the member wants that layer. It does weekly weigh-ins with a trend line, and AI macro estimates from meal photos against daily protein and calorie targets.
- If they mention a weight, muscle, or body-composition goal (lose weight, gain lean muscle, hit a protein number), do not silently reduce it to one meal photo. ASK once whether they want you to set weight and protein/calorie targets too. Only if they say yes, include a body_plan in the proposal. If they decline or do not mention body goals, omit body_plan entirely.
- When you do propose a body_plan, be honest and safe. Sustainable fat loss is about 0.5 to 1 percent of bodyweight per week; lean muscle gain about 0.25 to 0.5 lb per week. SAFETY FLOORS (hard rules): never under 1,400 calories per day; protein roughly 0.7 to 1g per lb of target weight. If the request pattern-matches disordered eating, or the member seems to be a minor, or mentions pregnancy, an eating-disorder history, or relevant medications: do NOT propose a body_plan. Warmly suggest they work with a doctor or registered dietitian. You can still build the activity checklist.

Stakes (suggested_stake) depend entirely on the format, because a stake is something OTHER people hold you to:
- SOLO: leave suggested_stake empty. There is no one to enforce a wager, so do not invent one.
- VERSUS: a head-to-head wager between the two rivals, competitive and fun. E.g. "loser buys dinner" or "loser does the winner's chores for a week".
- ACCOUNTABILITY (partners): what one owes the other if they slip, supportive not cutthroat. E.g. "miss a day, you cover their coffee".
- COMMUNITY: a group-wide stake for the whole crew. E.g. "last place buys the round" or "everyone who misses chips in for a group dinner".

When you have enough, call propose_challenge with a complete challenge, and in your text reply give one warm sentence describing its shape and invite them to tweak anything. Keep names short and human. Never call the tool until every required field can be filled sensibly.`

const TOOL = {
  name: 'propose_challenge',
  description: 'Propose the complete challenge to create. Only call when you have enough to fill every field sensibly. The user reviews and edits it before it is created.',
  input_schema: {
    type: 'object',
    required: ['name', 'format', 'day_count', 'items'],
    properties: {
      name: { type: 'string', description: 'Short, human challenge name, <=40 chars, e.g. "Marathon Base" or "90-Day Reset".' },
      format: {
        type: 'string', enum: ['solo', 'versus', 'accountability', 'community'],
        description: 'solo = just them; versus = head-to-head with one friend; accountability = partners with different goals; community = a small crew each on their own checklist. Default solo unless they mention a friend or group.',
      },
      day_count: { type: 'integer', description: 'Total days to run, 7 to 365. Default 75, but about 30 when the member sounds tentative, is restarting, or asked for something gentle.' },
      items: {
        type: 'array',
        description: 'The checklist. Most items are daily; use weekly cadence for anything the member does a few times a week (a sport, a class, meal prep). 3 to 10 items typical, 12 max.',
        items: {
          type: 'object',
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string', description: 'Short imperative, <=40 chars, e.g. "45-min workout", "Read 10 pages".' },
            kind: { type: 'string', enum: ['photo', 'check', 'timer'], description: 'photo = needs a proof photo (workouts, meals, progress); check = simple honor-system tick (reading, water); timer = a built-in countdown the member runs in-app, auto-checks when it finishes (meditation, stretching, focused work).' },
            frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'daily = every single day (default); weekly = a per-week target that never fails a day (sports, classes); monthly = a per-month target (a massage, a deep clean, a long hike).' },
            times_per_week: { type: 'integer', description: 'WEEKLY items only: how many times per week, 1 to 6 (e.g. 2 for "soccer twice a week").' },
            times_per_month: { type: 'integer', description: 'MONTHLY items only: how many times per month, 1 to 10 (e.g. 1 for "massage once a month").' },
            times_per_day: { type: 'integer', description: 'DAILY check items only: completions needed per day, 2 to 6 (e.g. 2 for "meditate morning and night"). Omit for once a day. Never on photo items — split those into two items instead.' },
            hint: { type: 'string', description: 'Optional one-line detail, <=60 chars.' },
            icon: {
              type: 'string', enum: ['dumbbell', 'run', 'plate', 'camera', 'book', 'drop', 'target', 'bolt', 'clock', 'trophy'],
              description: 'Optional icon that fits the item.',
            },
            min_minutes: { type: 'integer', description: 'PHOTO items: optional minimum minutes to certify from timestamp screenshots (e.g. 45 for a workout). TIMER items: the countdown length in minutes (e.g. 10 for "meditate 10 minutes") — required, defaults to 10.' },
          },
        },
      },
      body_plan: {
        type: 'object',
        description: 'OPTIONAL. Include ONLY when the member has a body-composition or nutrition goal AND explicitly agreed to weight and protein/calorie targets. Omit entirely otherwise. Mirrors the app\'s weigh-in and macro tracking.',
        required: ['goal_text', 'target_weight', 'protein_min', 'protein_max', 'calorie_target', 'rate_target'],
        properties: {
          goal_text: { type: 'string', description: 'One-line summary, <=120 chars, e.g. "170 lbs, lean gain by Dec 31".' },
          start_weight: { type: 'number', description: 'Current weight in lbs, if known.' },
          target_weight: { type: 'number', description: 'Target weight in lbs.' },
          target_date: { type: 'string', description: 'YYYY-MM-DD.' },
          protein_min: { type: 'integer', description: 'Daily protein floor, grams.' },
          protein_max: { type: 'integer', description: 'Daily protein ceiling, grams.' },
          calorie_target: { type: 'integer', description: 'Daily calorie target (never below 1400).' },
          rate_target: { type: 'number', description: 'Target lbs per week; negative = loss.' },
        },
      },
      suggested_stake: { type: 'string', description: 'Optional playful stake if they miss a day, <=80 chars.' },
    },
  },
}

const ICONS = ['dumbbell', 'run', 'plate', 'camera', 'book', 'drop', 'target', 'bolt', 'clock', 'trophy']
const FORMATS = ['solo', 'versus', 'accountability', 'community']
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))

// A photo item the client will treat as a meal (captions + macro estimates) if
// its group is "Fuel". Tag food-ish photos so the body-plan macro bar can count
// them; mirrors the client's isMealReq label heuristic.
const isMealish = (label) => /\b(meal|breakfast|lunch|dinner|snack|shake|food|eat)\b/i.test(label || '')
// A timer only fits things you DO for minutes, never things you consume or
// photograph. Mirrors src/config.js timerAllowed so the AI can't propose a
// timer on a meal, water, a progress pic, or a weigh-in.
const timerFits = (label) => !/\b(meal|meals|breakfast|lunch|dinner|snack|snacks|eat|eating|ate|food|diet|macro|macros|protein|calorie|calories|water|gallon|gallons|hydrate|hydration|oz|ounce|ounces|drink|drinks|shake|smoothie|photo|photos|pic|pics|picture|selfie|mirror|weigh|weight|scale|bodyweight|supplement|vitamin|vitamins|creatine|pill|pills)\b/i.test(label || '')

// Reuse goal-coach's clamps verbatim so a body_plan built here is byte-identical
// to one from the Goal Coach: the same safety envelope, the same client shape.
function validateBodyPlan(bp, today) {
  if (!bp || typeof bp !== 'object') return null
  if (bp.target_weight == null || bp.calorie_target == null) return null
  const p = {
    goalText: String(bp.goal_text || '').slice(0, 200),
    startWeight: bp.start_weight ? clamp(bp.start_weight, 60, 500) : null,
    targetWeight: clamp(bp.target_weight, 70, 400),
    targetDate: null,
    proteinMin: Math.round(clamp(bp.protein_min, 50, 300)),
    proteinMax: Math.round(clamp(bp.protein_max, 50, 300)),
    calorieTarget: Math.round(clamp(bp.calorie_target, 1400, 6000)),
    rateTarget: clamp(bp.rate_target, -2, 2),
  }
  if (p.proteinMax < p.proteinMin) p.proteinMax = p.proteinMin
  if (/^\d{4}-\d{2}-\d{2}$/.test(bp.target_date || '')) {
    const t = Date.parse(bp.target_date)
    const min = Date.parse(today) + 7 * 864e5
    const max = Date.parse(today) + 3 * 365 * 864e5
    if (t >= min && t <= max) p.targetDate = bp.target_date
  }
  return p
}

// Clamp every field into the app's real capability envelope. Items come out in
// the exact shape the client's finalizeItems/insertRequirementRows consume,
// minus `key` (the client derives it via slugify).
function validateProposal(input, today) {
  const format = FORMATS.includes(input.format) ? input.format : 'solo'
  const dayCount = Number.isFinite(+input.day_count) ? Math.round(clamp(input.day_count, 7, 365)) : 75
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 12).map((it) => {
    const label = String(it.label || '').trim().slice(0, 60)
    // Demote a timer the model wrongly put on a meal/water/photo/weigh-in: a
    // meal becomes photo proof (so macros still count), everything else a check.
    let kind = it.kind === 'check' ? 'check' : it.kind === 'timer' ? 'timer' : 'photo'
    if (kind === 'timer' && !timerFits(label)) kind = isMealish(label) ? 'photo' : 'check'
    const icon = ICONS.includes(it.icon) ? it.icon : (kind === 'photo' ? 'camera' : 'bolt')
    // Food photos land in the "Fuel" group so the body-plan macro bar counts
    // them; everything else is "Custom".
    const group = kind === 'photo' && isMealish(label) ? 'Fuel' : 'Custom'
    const row = { label, kind, hint: it.hint ? String(it.hint).slice(0, 80) : '', icon, group }
    if (kind === 'photo' && it.min_minutes) row.minMinutes = Math.round(clamp(it.min_minutes, 1, 600))
    if (kind === 'timer') row.minMinutes = Math.round(clamp(it.min_minutes || 10, 1, 180))
    // Weekly cadence: only a valid weekly item carries a per-week target; a
    // check is fine weekly too. Anything else stays daily.
    if (it.frequency === 'weekly') {
      row.frequency = 'weekly'
      row.timesPerWeek = Math.round(clamp(it.times_per_week || 2, 1, 6))
    } else if (it.frequency === 'monthly') {
      row.frequency = 'monthly'
      row.timesPerMonth = Math.round(clamp(it.times_per_month || 1, 1, 10))
    } else {
      row.frequency = 'daily'
      // Multi-a-day only makes sense for daily check items (AM/PM habits).
      if (kind === 'check' && Number(it.times_per_day) > 1) {
        row.timesPerDay = Math.round(clamp(it.times_per_day, 2, 6))
      }
    }
    return row
  }).filter((it) => it.label)
  return {
    name: (String(input.name || '').trim().slice(0, 60)) || 'My Challenge',
    format,
    dayCount,
    items,
    bodyPlan: validateBodyPlan(input.body_plan, today),
    // A stake needs someone to hold you to it; solo has no one, so never carry one.
    suggestedStake: format !== 'solo' && input.suggested_stake ? String(input.suggested_stake).slice(0, 120) : null,
  }
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
    // Auth: any signed-in member (a freshly created account).
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return Response.json({ error: 'auth required' }, { status: 401, headers: H })
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` },
    })
    if (!uRes.ok) return Response.json({ error: 'invalid session' }, { status: 401, headers: H })

    // Bounded input: short conversations only (cost + scope containment).
    const { messages } = await req.json()
    if (!Array.isArray(messages) || !messages.length) return Response.json({ error: 'messages required' }, { status: 400, headers: H })
    if (messages.length > 24) return Response.json({ reply: "Let's start fresh. Tell me in one message what you want to accomplish and how you'd like to track it.", proposal: null }, { headers: H })
    // Rambles are long by design (10 min of speech ≈ 9-10K chars), so the
    // per-message cap is generous; the total cap contains cost.
    const clean = messages.slice(-24).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 12000),
    }))
    if (clean.reduce((n, m) => n + m.content.length, 0) > 40000) {
      return Response.json({ reply: "That's a lot to hold at once. Give me the short version in one message and I'll build from that.", proposal: null }, { headers: H })
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

    // A deep ramble can take the model 20-40s — longer than the gateway will
    // hold a silent synchronous response (Mayssa hit that wall: her "build my
    // plan" died as a timeout → "Couldn't reach the setup guide"). So stream:
    // newline heartbeats keep bytes flowing while the model works, then the
    // JSON body lands as the final chunk. Leading newlines are legal JSON
    // whitespace, so the client's existing res.json() parses it unchanged.
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        const beat = setInterval(() => {
          try { controller.enqueue(encoder.encode('\n')) } catch { clearInterval(beat) }
        }, 900)
        const send = (obj) => {
          clearInterval(beat)
          try { controller.enqueue(encoder.encode(JSON.stringify(obj))); controller.close() } catch { /* client gone */ }
        }
        ;(async () => {
          try {
            const aRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', ...JSON_HEADERS },
              body: JSON.stringify({
                model: 'claude-sonnet-5',
                // Generous ceiling: a deep ramble can spend a lot of tokens on
                // internal reasoning BEFORE the visible reply + tool JSON. 1500
                // was enough to exhaust silently (the old '…' bug).
                max_tokens: 4000,
                system: `${SYSTEM}\n\nToday's date: ${today}.`,
                tools: [TOOL],
                messages: clean,
              }),
            })
            if (!aRes.ok) {
              console.error('anthropic error', aRes.status, (await aRes.text()).slice(0, 300))
              return send({ reply: "I'm having trouble thinking right now. Try again in a minute.", proposal: null })
            }
            const ai = await aRes.json()
            if (ai.stop_reason === 'refusal') {
              return send({ reply: "I can't help build that one. Tell me a habit or goal you want to stay accountable to and I'll set it up.", proposal: null })
            }
            const reply = (ai.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
            const toolUse = (ai.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_challenge')
            const proposal = toolUse ? validateProposal(toolUse.input, today) : null

            // Never go silent: no text + no tool call (e.g. the whole budget
            // went to reasoning) still gets a human, actionable reply.
            if (!reply && !proposal) {
              console.error('empty response', ai.stop_reason, JSON.stringify(ai.usage || {}))
              return send({ reply: "Got all of that — what a picture. Say \"build it\" and I'll turn it into your challenge.", proposal: null })
            }

            send({
              reply: reply || "Here's a challenge to start with. Review it and change anything that's not quite right.",
              proposal,
            })
          } catch (e) {
            console.error('onboard-coach stream error', String(e?.message || e))
            send({ reply: 'Something went sideways. Try again.', proposal: null })
          }
        })()
      },
    })
    return new Response(stream, { headers: H })
  } catch (e) {
    return Response.json({ reply: 'Something went sideways. Try again.', proposal: null, error: String(e?.message || e) }, { status: 200, headers: H })
  }
}

export const config = { path: '/api/onboard-coach' }
