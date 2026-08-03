// ─────────────────────────────────────────────────────────────────────────
// healthExport.js — build the files a member hands to a lab AI (Superpower,
// Function) or their doctor, entirely from data the app already has loaded.
//
// Runs in the browser on purpose. The export is just a reshaping of what is
// already in memory, so it needs no endpoint, costs nothing, works offline,
// and the health data never takes an extra trip through a server on its way
// to a file the user is about to hand somewhere themselves.
//
// Two hard rules, both learned the hard way:
//  1. Say where the numbers came from. These are AI estimates from photos and
//     captions, not weighed food. A model given them without that caveat will
//     treat them as measured and over-conclude.
//  2. Never invent a column. A blank is honest; a plausible-looking fabricated
//     saturated-fat number is not, because something will act on it.
// ─────────────────────────────────────────────────────────────────────────
import { dayDate, currentDayNumber } from './challenge.js'

// Dietary categories a blood panel can actually speak to. Stems match plurals
// deliberately: under-reporting fiber is worse than over-reporting it.
const FOOD = {
  'Eggs (whole)': /\begg/i,
  'Red / processed meat': /\b(lamb|beef|steak|burger|barbacoa|kefta|bacon|sausage|brat|salami|pepperoni|carne|birria|angus|chop)/i,
  'Poultry': /\b(chicken|turkey(?! bacon))/i,
  'Fish / seafood': /\b(salmon|tuna|shrimp|cod\b|sardine|mackerel|seafood|mussel|clam|halibut|anchov)/i,
  'Cheese / dairy fat': /\b(cheese|parm|feta|mozzarella|cheddar|queso|butter|cream|whole milk)/i,
  'Fried / chips': /\b(fried|fries|chips|popcorn|tempura|nugget)/i,
  'Whole grains': /\b(oat|quinoa|barley|whole wheat|brown rice|sourdough)/i,
  'Legumes': /\b(bean|lentil|chickpea|hummus)/i,
  'Nuts / seeds': /\b(almond|walnut|peanut|cashew|chia|flax|pistachio|avocado)/i,
  'Vegetables': /\b(spinach|broccoli|kale|salad|vegetable|greens|asparagus|brussel|zucchini|cauliflower)/i,
  'Fruit': /\b(apple|banana|berry|berries|strawberr|blueberr|orange|mango|grape|peach|melon)/i,
  'Dessert / added sugar': /\b(ice cream|mochi|cookie|cake|donut|candy|chocolate|dessert|pastry|muffin)/i,
  'Alcohol': /\b(beer|wine|tequila|whiskey|vodka|cocktail|margarita|seltzer)/i,
}

const isMealish = (r) => /meal|shake|breakfast|lunch|dinner|snack|fuel|extra/i.test(`${r.label} ${r.group || ''}`)
const isWorkoutish = (r) => /workout|run|lift|gym|cardio|train|move|walk/i.test(`${r.label} ${r.group || ''}`)
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const r0 = (n) => Math.round(n)

// Flatten the app's log shape into one row per (day, requirement).
function flatten(reqs, logs) {
  const out = []
  for (const l of logs) {
    for (const r of reqs) {
      const e = l.entriesByReq?.[r.id]
      if (!e) continue
      out.push({
        date: l.logDate, label: r.label, group: r.group, kind: r.kind, optional: r.optional,
        done: !!(e.photoPaths?.length || e.photoPath || e.checked),
        caption: e.caption || null,
        calories: e.estCalories ?? null, protein: e.estProtein ?? null,
        carbs: e.estCarbs ?? null, fat: e.estFat ?? null,
        satFat: e.estSatFat ?? null, fiber: e.estFiber ?? null,
        meal: isMealish(r), workout: isWorkoutish(r),
      })
    }
  }
  return out
}

export function buildExport({ name, cfg, reqs, logs, days = 45 }) {
  const todayNum = currentDayNumber(cfg.startStr, cfg.todayStr)
  const firstDate = dayDate(cfg.startStr, Math.max(1, todayNum - days + 1))
  const rows = flatten(reqs, logs).filter((r) => r.date >= firstDate && r.date <= cfg.todayStr)
  const dates = [...new Set(rows.map((r) => r.date))].sort()
  if (!dates.length) return null

  const meals = rows.filter((r) => r.caption || (r.meal && r.calories != null))
  const byDay = (d, k) => rows.filter((r) => r.date === d && r.meal).reduce((a, r) => a + (r[k] || 0), 0)

  // ── daily table ───────────────────────────────────────────────────────
  const daily = dates.map((d) => {
    const onDay = rows.filter((r) => r.date === d)
    const req = onDay.filter((r) => !r.optional)
    const water = onDay.find((r) => /water|hydrat/i.test(r.label))
    const val = (k) => byDay(d, k) || ''
    return {
      date: d,
      calories: val('calories'), protein_g: val('protein'), carbs_g: val('carbs'),
      total_fat_g: val('fat'), saturated_fat_g: val('satFat'), fiber_g: val('fiber'),
      sodium_mg: 'not_tracked',
      alcohol_units: 0,
      water_target_met: water ? (water.done ? 'yes' : 'no') : 'not_tracked',
      meals_logged: onDay.filter((r) => r.meal && (r.caption || r.done)).length,
      workouts_completed: onDay.filter((r) => r.workout && r.done).length,
      all_items_completed: req.length && req.every((r) => r.done) ? 'yes' : 'no',
    }
  })
  const dcols = Object.keys(daily[0])
  const dailyCsv = [dcols.join(','), ...daily.map((r) => dcols.map((c) => String(r[c] ?? '')).join(','))].join('\n')

  // ── per-meal table ────────────────────────────────────────────────────
  const mealCsv = (() => {
    if (!meals.length) return null
    const cols = ['date', 'calories', 'protein_g', 'carbs_g', 'total_fat_g', 'saturated_fat_g', 'fiber_g', 'description']
    const lines = meals.map((m) => [
      m.date, m.calories ?? '', m.protein ?? '', m.carbs ?? '', m.fat ?? '', m.satFat ?? '', m.fiber ?? '',
      `"${(m.caption || '(photo only, no description)').replace(/"/g, "'")}"`,
    ].join(','))
    return [cols.join(','), ...lines].join('\n')
  })()

  // ── summary numbers ───────────────────────────────────────────────────
  const num = (k) => dates.map((d) => byDay(d, k)).filter((v) => v > 0)
  const kcal = num('calories'), sat = num('satFat'), fib = num('fiber'), prot = num('protein')
  const fullDays = daily.filter((d) => d.all_items_completed === 'yes').length

  const pattern = {}
  for (const [k, re] of Object.entries(FOOD)) {
    const hits = meals.filter((m) => m.caption && re.test(m.caption))
    if (hits.length) pattern[k] = { meals: hits.length, days: new Set(hits.map((h) => h.date)).size }
  }

  const training = {}
  for (const r of rows.filter((x) => x.workout && x.done)) {
    training[r.label] = training[r.label] || new Set()
    training[r.label].add(r.date)
  }

  // ── the readable document ─────────────────────────────────────────────
  const L = []
  L.push(`# Behavioral health export — ${name}`, '')
  L.push(`**Window:** ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days logged)`)
  L.push(`**Generated:** ${cfg.todayStr} · **Source:** You Mode (self-logged daily challenge tracking)`, '')
  L.push('> **How to read this.** Nutrition figures are AI estimates from meal photos and written')
  L.push('> descriptions, not weighed food. Treat absolute values as approximate and frequencies as')
  L.push('> the more reliable signal. A day with no entry means nothing was logged, not that nothing')
  L.push('> was eaten. No medication, supplement, or sleep data is captured.', '')

  L.push('## Adherence', '')
  L.push(`- Days logged: **${dates.length}**`)
  L.push(`- Days with every required item completed: **${fullDays}** (${r0((fullDays / dates.length) * 100)}%)`)
  if (Object.keys(training).length) {
    for (const [label, set] of Object.entries(training).sort((a, b) => b[1].size - a[1].size)) {
      L.push(`- ${label}: ${set.size} days (${(set.size / dates.length * 7).toFixed(1)}×/week)`)
    }
  }
  L.push('')

  if (kcal.length) {
    L.push('## Nutrition', '')
    L.push(`- Calories: **~${r0(avg(kcal))}/day**`)
    if (prot.length) L.push(`- Protein: **~${r0(avg(prot))} g/day**`)
    if (sat.length) {
      const pct = avg(kcal) ? ((avg(sat) * 9) / avg(kcal)) * 100 : 0
      L.push(`- Saturated fat: **~${r0(avg(sat))} g/day** (${pct.toFixed(1)}% of calories, range ${r0(Math.min(...sat))}–${r0(Math.max(...sat))})`)
    }
    if (fib.length) L.push(`- Fiber: **~${r0(avg(fib))} g/day** (range ${r0(Math.min(...fib))}–${r0(Math.max(...fib))})`)
    L.push('')
  }

  if (Object.keys(pattern).length) {
    L.push('### Dietary pattern frequency', '')
    L.push('| Category | Meals | Days | Per week |', '|---|---|---|---|')
    for (const [k, v] of Object.entries(pattern).sort((a, b) => b[1].meals - a[1].meals)) {
      L.push(`| ${k} | ${v.meals} | ${v.days} | ${(v.days / dates.length * 7).toFixed(1)} |`)
    }
    L.push('')
  }

  const described = meals.filter((m) => m.caption).slice(-20)
  if (described.length) {
    L.push('## Recent meal descriptions', '')
    L.push('Verbatim, so a reviewer can judge the estimates rather than trust them.', '')
    for (const m of described) {
      L.push(`- \`${m.date}\` ${m.caption}${m.satFat != null ? ` *(est. ${m.calories} kcal, ${m.protein}g protein, ${m.satFat}g sat fat, ${m.fiber}g fiber)*` : ''}`)
    }
    L.push('')
  }
  L.push('---', '', '*Self-reported behavioral data. Not a medical record and not clinical advice.*')

  return {
    markdown: L.join('\n'),
    dailyCsv,
    mealCsv,
    stats: {
      days: dates.length, fullDays, meals: meals.length,
      kcal: kcal.length ? r0(avg(kcal)) : null,
      satFat: sat.length ? r0(avg(sat)) : null,
      fiber: fib.length ? r0(avg(fib)) : null,
      hasMacros: sat.length > 0,
    },
  }
}
