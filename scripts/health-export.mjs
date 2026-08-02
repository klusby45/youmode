// ─────────────────────────────────────────────────────────────────────────
// health-export.mjs — turn a member's challenge history into a document you
// can hand to a lab/health AI (Superpower, Function) or your doctor.
//
//   node scripts/health-export.mjs <username> [days] [--json]
//
// Design notes, because the format IS the product here:
//  • Markdown, not PDF. An LLM parses it losslessly and a human still reads
//    it. PDFs lose structure; raw JSON loses the doctor.
//  • Frequencies over totals. The useful signal for a lipid panel was "red
//    meat 21 times, eggs 68 across 12 days", NOT "3408 kcal". Calorie
//    estimates carry big error bars; counting how often a food appears does
//    not.
//  • Provenance stated up front. These are AI estimates from photos and
//    captions, not weighed food. A receiving model that treats them as
//    measured will over-conclude, so the header says so explicitly.
//  • No photos, no identifiers beyond a display name. The user decides where
//    this file goes.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REF = 'aqaubrbssnbtomykexgr'
let SERVICE = process.env.SUPABASE_SERVICE_KEY
if (!SERVICE) {
  SERVICE = JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).find((k) => k.name === 'service_role').api_key
}
const sb = createClient(`https://${REF}.supabase.co`, SERVICE, { auth: { persistSession: false } })

const username = process.argv[2]
const windowDays = Number(process.argv[3]) || 45
const wantJson = process.argv.includes('--json')
if (!username) { console.error('usage: node scripts/health-export.mjs <username> [days] [--json]'); process.exit(1) }

// Food taxonomy. Deliberately about DIETARY PATTERNS a blood panel can speak
// to: saturated-fat load, fiber, omega-3, added sugar, alcohol.
// NOTE: no trailing \b on stems — an earlier version used \b(oat)\b and
// \b(bean)\b, which silently failed to match "oats" and "beans" and
// under-reported fiber. In a document a clinician may read, a false low is
// worse than a false high, so stems match plurals deliberately.
const FOOD = {
  'Eggs (whole)':        /\begg/i,
  'Red / processed meat':/\b(lamb|beef|steak|burger|barbacoa|kefta|bacon|sausage|brat|salami|pepperoni|carne|birria|angus|chop)/i,
  'Poultry':             /\b(chicken|turkey(?! bacon))/i,
  'Fish / seafood':      /\b(salmon|tuna|shrimp|cod\b|sardine|mackerel|seafood|mussel|muscles|clam|halibut|anchov)/i,
  'Cheese / dairy fat':  /\b(cheese|parm|feta|mozzarella|cheddar|queso|butter|cream|whole milk|halva)/i,
  'Fried / chips':       /\b(fried|fries|chips|popcorn|tempura|nugget)/i,
  'Oats / whole grain':  /\b(oat|quinoa|barley|whole wheat|brown rice|sourdough|pita)/i,
  'Legumes':             /\b(bean|lentil|chickpea|hummus)/i,
  'Nuts / seeds':        /\b(almond|walnut|peanut|cashew|chia|flax|pistachio|avocado)/i,
  'Vegetables':          /\b(spinach|broccoli|kale|salad|vegetable|greens|asparagus|brussel|zucchini|cauliflower|tomato|romesco)/i,
  'Fruit':               /\b(apple|banana|berry|berries|strawberr|blueberr|orange|mango|grape|peach|melon)/i,
  'Dessert / added sugar':/\b(ice cream|mochi|cookie|cake|donut|candy|chocolate|dessert|pastry|muffin|maple syrup|honey)/i,
  'Alcohol':             /\b(beer|wine|tequila|whiskey|vodka|cocktail|margarita|\bipa\b|seltzer)/i,
  'Protein supplement':  /\b(protein powder|whey|shake|scoop of protein|equip|creatine|protein oats)/i,
}

const iso = (d) => d.toISOString().slice(0, 10)
const round = (n) => Math.round(n)
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

async function main() {
  const { data: prof, error: pe } = await sb.from('profiles')
    .select('id, username, display_name').eq('username', username).single()
  if (pe || !prof) { console.error(`no such user: ${username}`); process.exit(1) }

  const today = iso(new Date())
  const from = iso(new Date(Date.now() - windowDays * 864e5))

  const { data: mems } = await sb.from('members')
    .select('challenge_id, total_days, challenges(name, start_date, total_days, format)')
    .eq('user_id', prof.id)
  if (!mems?.length) { console.error('no challenges'); process.exit(1) }

  const rows = []          // { date, kind, label, done, caption, protein, calories }
  const challengeMeta = []
  for (const m of mems) {
    const ch = m.challenges
    const { data: reqs } = await sb.from('requirements')
      .select('id, key, label, kind, optional, group_label')
      .eq('challenge_id', m.challenge_id).eq('user_id', prof.id)
    const byId = Object.fromEntries((reqs || []).map((r) => [r.id, r]))
    const { data: days } = await sb.from('day_logs')
      .select('id, log_date, status').eq('challenge_id', m.challenge_id).eq('user_id', prof.id)
      .gte('log_date', from).order('log_date')
    if (!days?.length) continue
    challengeMeta.push({ name: ch.name, start: ch.start_date, total: m.total_days || ch.total_days, format: ch.format, days: days.length })
    for (const d of days) {
      const { data: es } = await sb.from('log_entries')
        .select('requirement_id, photo_path, photo_paths, checked, caption, est_protein, est_calories, updated_at')
        .eq('day_log_id', d.id)
      for (const e of es || []) {
        const r = byId[e.requirement_id]; if (!r) continue
        rows.push({
          date: d.log_date, status: d.status, kind: r.kind, label: r.label, group: r.group_label,
          optional: r.optional,
          done: !!(e.photo_paths?.length || e.photo_path || e.checked),
          caption: e.caption || null, protein: e.est_protein ?? null, calories: e.est_calories ?? null, updated: e.updated_at || null,
        })
      }
    }
  }
  if (!rows.length) { console.error('no logged data in window'); process.exit(1) }

  const dates = [...new Set(rows.map((r) => r.date))].sort()
  const meals = rows.filter((r) => r.caption)

  // ── nutrition ──────────────────────────────────────────────────────────
  const kcalByDay = {}, protByDay = {}
  for (const m of meals) {
    if (m.calories) kcalByDay[m.date] = (kcalByDay[m.date] || 0) + m.calories
    if (m.protein) protByDay[m.date] = (protByDay[m.date] || 0) + m.protein
  }
  const kcalDays = Object.values(kcalByDay), protDays = Object.values(protByDay)

  // ── food patterns ──────────────────────────────────────────────────────
  const pattern = {}
  for (const [name, re] of Object.entries(FOOD)) {
    const hits = meals.filter((m) => re.test(m.caption))
    if (!hits.length) continue
    pattern[name] = { meals: hits.length, days: new Set(hits.map((h) => h.date)).size }
  }
  // eggs get a count, because quantity is the whole story there
  let eggUnits = 0
  const numWord = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  for (const m of meals) {
    const mm = m.caption.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:whole\s+|scrambled\s+|fried\s+|poached\s+|boiled\s+)*eggs?/i)
    if (mm) eggUnits += Number(mm[1]) || numWord[mm[1].toLowerCase()] || 0
  }

  // ── training ───────────────────────────────────────────────────────────
  const training = {}
  for (const r of rows) {
    if (/train|workout|run|walk|move|lift|gym|cardio|yoga|stretch/i.test(r.label + ' ' + (r.group || ''))) {
      training[r.label] = training[r.label] || { done: 0, days: new Set() }
      if (r.done) { training[r.label].done++; training[r.label].days.add(r.date) }
    }
  }

  // ── adherence ──────────────────────────────────────────────────────────
  const required = rows.filter((r) => !r.optional)
  const byDay = {}
  for (const r of required) {
    byDay[r.date] = byDay[r.date] || { total: 0, done: 0 }
    byDay[r.date].total++; if (r.done) byDay[r.date].done++
  }
  const fullDays = Object.values(byDay).filter((d) => d.total && d.done === d.total).length

  // ── weigh-ins (optional table) ─────────────────────────────────────────
  let weighIns = []
  try {
    const { data } = await sb.from('weigh_ins').select('logged_on, weight')
      .eq('user_id', prof.id).gte('logged_on', from).order('logged_on')
    weighIns = data || []
  } catch { /* feature not in use */ }

  // ── render ─────────────────────────────────────────────────────────────
  const name = prof.display_name || prof.username
  const L = []
  L.push(`# Behavioral health export — ${name}`)
  L.push('')
  L.push(`**Window:** ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days with logged activity)`)
  L.push(`**Generated:** ${today} · **Source:** You Mode (self-logged daily challenge tracking)`)
  L.push('')
  L.push('> **How to read this.** Nutrition figures are AI estimates generated from user-submitted meal')
  L.push('> photos and written descriptions. They are NOT weighed or measured food. Treat absolute')
  L.push('> calorie and macro numbers as approximate (assume ±20–30%), and treat **frequencies and')
  L.push('> patterns as the more reliable signal**. Days with no entry mean nothing was logged, which')
  L.push('> is not the same as nothing being eaten. No medication, supplement, sleep, or alcohol data')
  L.push('> is captured unless it appears in a meal description.')
  L.push('')

  L.push('## Adherence')
  L.push('')
  for (const c of challengeMeta) {
    L.push(`- **${c.name}** (${c.format}, ${c.total}-day run, started ${c.start}) — ${c.days} days logged in this window`)
  }
  L.push(`- **Fully completed days:** ${fullDays} of ${dates.length} logged (${round((fullDays / dates.length) * 100)}%)`)
  L.push('')

  if (Object.keys(training).length) {
    L.push('## Training')
    L.push('')
    L.push('| Activity | Days completed | Frequency |')
    L.push('|---|---|---|')
    for (const [label, t] of Object.entries(training).sort((a, b) => b[1].days.size - a[1].days.size)) {
      L.push(`| ${label} | ${t.days.size} | ${(t.days.size / dates.length * 7).toFixed(1)}×/week |`)
    }
    L.push('')
  }

  L.push('## Nutrition')
  L.push('')
  L.push(`- **Meals logged with a description:** ${meals.length} across ${new Set(meals.map((m) => m.date)).size} days`)
  if (kcalDays.length) L.push(`- **Estimated intake:** ~${round(avg(kcalDays))} kcal/day (range ${round(Math.min(...kcalDays))}–${round(Math.max(...kcalDays))}, n=${kcalDays.length} days)`)
  if (protDays.length) L.push(`- **Estimated protein:** ~${round(avg(protDays))} g/day`)
  L.push('')
  L.push('### Dietary pattern frequency')
  L.push('')
  L.push('How often each category appears in described meals. This is the most reliable part of this export.')
  L.push('')
  L.push('| Category | Meals | Days | Per week |')
  L.push('|---|---|---|---|')
  for (const [k, v] of Object.entries(pattern).sort((a, b) => b[1].meals - a[1].meals)) {
    L.push(`| ${k} | ${v.meals} | ${v.days} | ${(v.days / dates.length * 7).toFixed(1)} |`)
  }
  L.push('')
  if (eggUnits) {
    const eggDays = pattern['Eggs (whole)']?.days || 0
    L.push(`> **Whole eggs:** approximately **${eggUnits} eggs across ${eggDays} days** (~${(eggUnits / Math.max(1, eggDays)).toFixed(1)} per egg-day).`)
    L.push('> Relevant to dietary cholesterol load if lipids are in question.')
    L.push('')
  }

  if (weighIns.length) {
    L.push('## Body weight')
    L.push('')
    L.push(`- ${weighIns.length} weigh-ins: ${weighIns[0].weight} → ${weighIns[weighIns.length - 1].weight} (${weighIns[0].logged_on} → ${weighIns[weighIns.length - 1].logged_on})`)
    L.push('')
  }

  L.push('## Representative meal descriptions')
  L.push('')
  L.push('Verbatim, most recent last. Included so a reviewer can judge the estimates rather than trust them.')
  L.push('')
  for (const m of meals.slice(-25)) {
    L.push(`- \`${m.date}\` ${m.caption}${m.protein ? ` *(est. ${m.protein}g protein, ${m.calories} kcal)*` : ''}`)
  }
  L.push('')
  L.push('---')
  L.push('')
  L.push('*Self-reported behavioral data. Not a medical record and not clinical advice.*')

  const md = L.join('\n')
  const outMd = `/tmp/youmode-health-export-${username}-${today}.md`
  writeFileSync(outMd, md)
  console.log(outMd)

  // ── daily + per-meal tables, in the schema a lab AI asked for ──────────
  // One row per day is what a reasoning model wants: it can line intake up
  // against workout load and a draw date. Columns we do not yet capture are
  // written as `not_tracked` rather than guessed — a fabricated saturated-fat
  // number is worse than an honest blank, because the model will act on it.
  const tz = 'America/Los_Angeles'
  const localTime = (iso8601) => new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso8601))

  const isMealRow = (r) => /meal|shake|breakfast|lunch|dinner|snack|fuel/i.test(`${r.label} ${r.group || ''}`) || r.caption
  const isWorkoutRow = (r) => /workout|run|lift|gym|cardio|train/i.test(`${r.label} ${r.group || ''}`)
  const isWaterRow = (r) => /water|hydrat/i.test(r.label)

  const dayRows = dates.map((d) => {
    const onDay = rows.filter((r) => r.date === d)
    const dayMeals = onDay.filter((r) => r.caption)
    const kcal = dayMeals.reduce((a, m) => a + (m.calories || 0), 0)
    const prot = dayMeals.reduce((a, m) => a + (m.protein || 0), 0)
    // Timestamps record when an entry was WRITTEN. If every entry on a day
    // shares the same minute it was a bulk backfill, not a lived timeline —
    // emitting those as meal/workout times would invent a schedule that never
    // happened, so blank them instead.
    const stamps = onDay.map((r) => r.updated).filter(Boolean)
    const minutes = new Set(stamps.map((s) => s.slice(0, 16)))
    const timingReliable = stamps.length > 1 && minutes.size > 1
    const mealTimes = timingReliable ? dayMeals.map((m) => m.updated).filter(Boolean).sort() : []
    const workouts = timingReliable
      ? onDay.filter((r) => isWorkoutRow(r) && r.done).map((r) => r.updated).filter(Boolean).sort() : []
    const water = onDay.find((r) => isWaterRow(r))
    return {
      date: d,
      calories: kcal || '',
      protein_g: prot || '',
      carbs_g: 'not_tracked', total_fat_g: 'not_tracked',
      saturated_fat_g: 'not_tracked', fiber_g: 'not_tracked', sodium_mg: 'not_tracked',
      alcohol_units: 0,
      water_target_met: water ? (water.done ? 'yes' : 'no') : 'not_tracked',
      meals_logged: dayMeals.length,
      first_meal_local: mealTimes.length ? localTime(mealTimes[0]) : '',
      last_meal_local: mealTimes.length ? localTime(mealTimes[mealTimes.length - 1]) : '',
      workout_times_local: workouts.map(localTime).join(' '),
    }
  })
  const dcols = Object.keys(dayRows[0])
  const csv = [dcols.join(','), ...dayRows.map((r) => dcols.map((c) => String(r[c] ?? '')).join(','))].join('\n')
  const outCsv = `/tmp/youmode-daily-${username}-${today}.csv`
  writeFileSync(outCsv, csv)
  console.log(outCsv)

  const mealRows = meals.map((m) => ({
    date: m.date, time_local: m.updated ? localTime(m.updated) : '',
    calories: m.calories ?? '', protein_g: m.protein ?? '',
    saturated_fat_g: 'not_tracked', fiber_g: 'not_tracked',
    description: `"${m.caption.replace(/"/g, "'")}"`,
  }))
  const mcols = Object.keys(mealRows[0])
  const mcsv = [mcols.join(','), ...mealRows.map((r) => mcols.map((c) => String(r[c] ?? '')).join(','))].join('\n')
  const outMeals = `/tmp/youmode-meals-${username}-${today}.csv`
  writeFileSync(outMeals, mcsv)
  console.log(outMeals)

  if (wantJson) {
    const outJson = outMd.replace(/\.md$/, '.json')
    writeFileSync(outJson, JSON.stringify({
      subject: name, window: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
      generated: today, source: 'You Mode',
      provenance: 'AI estimates from user-submitted meal photos and descriptions; not weighed food',
      adherence: { loggedDays: dates.length, fullyCompletedDays: fullDays },
      challenges: challengeMeta,
      nutrition: {
        describedMeals: meals.length,
        estKcalPerDay: kcalDays.length ? round(avg(kcalDays)) : null,
        estProteinPerDay: protDays.length ? round(avg(protDays)) : null,
        patternFrequency: pattern, wholeEggsCounted: eggUnits || null,
      },
      training: Object.fromEntries(Object.entries(training).map(([k, v]) => [k, v.days.size])),
      weighIns,
    }, null, 2))
    console.log(outJson)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
