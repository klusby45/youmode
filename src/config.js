// ─────────────────────────────────────────────────────────────────────────
// 75 HARD — product configuration (v2, self-serve).
// Challenges, members, and requirements now live in Supabase; this file only
// holds constants and the classic template used to prefill the builder.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_TOTAL_DAYS = 75

// Logins are usernames mapped to a synthetic auth email; the user's real
// email is stored on their profile.
export const LOGIN_DOMAIN = '75hard.app'
export const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${LOGIN_DOMAIN}`
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// A built-in timer only makes sense for things you DO for a stretch of minutes
// (read, workout, meditate, stretch, walk). It's nonsense on things you consume
// or photograph — a meal, a gallon of water, a progress pic, a weigh-in (Kyle:
// "timer shouldn't be an option on everything"). Blocklist, word-boundaried so
// "sweat" isn't caught by "eat"; a blank/new label is allowed (don't prejudge).
const NO_TIMER_RE = /\b(meal|meals|breakfast|lunch|dinner|snack|snacks|eat|eating|ate|food|diet|macro|macros|protein|calorie|calories|water|gallon|gallons|hydrate|hydration|oz|ounce|ounces|drink|drinks|shake|smoothie|photo|photos|pic|pics|picture|selfie|mirror|weigh|weight|scale|bodyweight|supplement|vitamin|vitamins|creatine|pill|pills)\b/i
export function timerAllowed(label) {
  const s = (label || '').trim()
  return s ? !NO_TIMER_RE.test(s) : true
}

// Food-ish photo requirements get caption inputs + AI macro estimates.
export const isMealReq = (r) =>
  r.kind === 'photo' && (
    /meal|shake|breakfast|lunch|dinner|snack/i.test(r.key || '') ||
    /meal|shake|breakfast|lunch|dinner|snack|food/i.test(r.label || '') ||
    /fuel/i.test(r.group || '')
  )

// Loose phone normalization → E.164-ish. Returns null if it doesn't look
// like a real cell number. 10 digits assumes US (+1).
export function normalizePhone(raw) {
  const d = (raw || '').replace(/[^\d+]/g, '')
  const digits = d.replace(/\D/g, '')
  if (d.startsWith('+') && digits.length >= 10 && digits.length <= 15) return '+' + digits
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return null
}

// Accents assigned to participants by join order; gold is the referee's.
export const MEMBER_COLORS = ['#FF3B30', '#34C759', '#0A84FF', '#FF9F0A']
export const REFEREE_COLOR = '#FFD60A'

// Icon choices offered in the builder.
export const ITEM_ICONS = ['dumbbell', 'run', 'plate', 'camera', 'book', 'drop', 'target', 'bolt', 'clock', 'trophy']

// The classic 75 Hard checklist — prefills the requirements builder.
export const CLASSIC_TEMPLATE = [
  { key: 'workout_indoor',  label: 'Indoor Workout',    hint: '45 min',          group: 'Train',     icon: 'dumbbell', kind: 'photo' },
  { key: 'workout_outdoor', label: 'Outdoor Workout',   hint: '45 min',          group: 'Train',     icon: 'run',      kind: 'photo' },
  { key: 'meal_1',          label: 'Meal 1',            hint: 'On plan',         group: 'Fuel',      icon: 'plate',    kind: 'photo' },
  { key: 'meal_2',          label: 'Meal 2',            hint: 'On plan',         group: 'Fuel',      icon: 'plate',    kind: 'photo' },
  { key: 'meal_3',          label: 'Meal 3',            hint: 'On plan',         group: 'Fuel',      icon: 'plate',    kind: 'photo' },
  { key: 'progress',        label: 'Progress Photo',    hint: 'Mirror shot',     group: 'Progress',  icon: 'camera',   kind: 'photo' },
  { key: 'reading',         label: 'Read 10 Pages',     hint: 'Just check it',   group: 'Check off', icon: 'book',     kind: 'check' },
  { key: 'water',           label: '1 Gallon of Water', hint: 'Just check it',   group: 'Check off', icon: 'drop',     kind: 'check' },
]

// Browser's timezone, used as the default for new challenges.
export function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles' }
  catch { return 'America/Los_Angeles' }
}

export function slugify(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item'
}
