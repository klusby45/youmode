// Voice system: every tone-laden string routes through here. Three voices —
// hardcore is the app's original copy VERBATIM (existing users see zero
// change); coach and monk soften it. A voice missing a key falls back to
// hardcore, so partial coverage never breaks a screen.
export const VOICES = [
  // Previews explain what each voice MEANS for how the app holds you
  // accountable (Miska: "idk what this even means, let's explain that").
  { key: 'monk', label: 'Monk', preview: 'Calm and gentle. Quiet encouragement, never pressure.' },
  { key: 'coach', label: 'Coach', preview: 'Supportive but honest, like a trainer who wants you to win.' },
  { key: 'hardcore', label: 'Hard Core', preview: 'Blunt and demanding. No excuses, no sugarcoating.' },
]

const TONE_KEY = '75hard-tone'
export const normalizeTone = (k) => (VOICES.some((v) => v.key === k) ? k : 'hardcore')
export function getStoredTone() {
  try { return normalizeTone(localStorage.getItem(TONE_KEY)) } catch { return 'hardcore' }
}
export function storeTone(k) {
  try { localStorage.setItem(TONE_KEY, k) } catch { /* private mode */ }
}

// Entries: plain string, or (vars) => string for interpolated copy.
// (Logged-out surfaces, landing, auth, guided start, use fixed brand copy
// in their components; voices apply in-app only, after the user picks one.)
const C = {
  // ── onboarding ──
  'onboard.hello.sub': {
    hardcore: "75 days. Your rules. Let's set it up.",
    coach: "Your challenge, your rules. Let's set it up.",
    monk: "Your path, your pace. Let's begin.",
  },
  'onboard.start.sub': {
    hardcore: 'Build your own daily checklist, set the stakes, get a code to invite up to 3 friends and a referee.',
    coach: 'Build your own daily checklist, set the stakes, get a code to invite friends and a referee.',
    monk: 'Choose your daily practices, invite your people, and begin.',
  },
  'onboard.join.sub': {
    hardcore: 'Got an invite code from a friend? Jump into their challenge as a competitor, or as the referee.',
    coach: 'Got an invite code from a friend? Jump into their challenge, or join as the referee.',
    monk: 'Someone shared a code? Join them on the path, or watch over the days as referee.',
  },
  'onboard.stake.label': {
    hardcore: 'On the line (optional)',
    coach: 'Your stake (optional)',
    monk: 'Your promise (optional)',
  },
  'onboard.stake.ph': {
    hardcore: 'If you fail… e.g. bright red mohawk',
    coach: 'If you miss… e.g. buy the coffees for a month',
    monk: "If you fall short… a promise you'll keep",
  },
  'onboard.join.stake.ph': {
    hardcore: "If you fail… what's on the line?",
    coach: "If you miss… what's your stake?",
    monk: 'If you fall short… what will you owe?',
  },
  'onboard.done.title': {
    hardcore: "You're in. 🔥",
    coach: "You're set. Let's go.",
    monk: 'It begins. 🌱',
  },
  'onboard.done.sub': {
    hardcore: 'Share this code so friends can join, up to 3 more doing the challenge, plus one referee to judge the days.',
    coach: 'Share this code so friends can join, teammates doing the challenge, plus one referee to make the calls.',
    monk: 'Share this code with your people, companions for the road, and one referee to witness the days.',
  },
  'onboard.done.honor': {
    hardcore: 'No referee? No problem. Finished days count automatically, with AI spot-checks keeping the photos honest.',
    coach: 'No referee? No problem. Finished days count automatically, with AI spot-checks keeping photos honest.',
    monk: "No referee? That's okay. Finished days count on their own, with a gentle AI eye on the photos.",
  },

  // ── today ──
  'today.notstarted.sub': {
    hardcore: ({ name, start }) => `${name} begins on ${start}. Rest up.`,
    coach: ({ name, start }) => `${name} begins on ${start}. Rest up and be ready.`,
    monk: ({ name, start }) => `${name} begins on ${start}. Rest well.`,
  },
  'today.finished.title': {
    hardcore: ({ n }) => `${n} days done`,
  },
  'today.finished.sub': {
    hardcore: "It's over. Check the standings for the verdict.",
    coach: "That's the full run. Go see how you finished.",
    monk: 'The mountain is climbed. Look back at how far you came.',
  },
  'today.banner.approved.title': {
    hardcore: '✓ Day approved',
    monk: '✓ Day complete',
  },
  'today.banner.approved.sub': {
    hardcore: ({ note }) => `Locked in. ${note ? `“${note}”` : 'Streak protected.'}`,
    coach: ({ note }) => `In the books. ${note ? `“${note}”` : 'Streak alive.'}`,
    monk: ({ note }) => (note ? `Done and witnessed. “${note}”` : 'Done. Another stone laid.'),
  },
  'today.banner.rejected.title': {
    hardcore: '✕ Day rejected',
    coach: 'Day not approved',
    monk: 'Not this day',
  },
  'today.banner.rejected.sub': {
    hardcore: ({ note }) => (note ? `“${note}”` : 'This counts as a fail.'),
    coach: ({ note }) => (note ? `“${note}”` : "It counts as a miss. Tomorrow's a clean slate, take it."),
    monk: ({ note }) => (note ? `“${note}”` : "It didn't count. The next one can."),
  },
  'today.banner.review.title': {
    hardcore: 'Sent to the referee',
    monk: 'With the referee now',
  },
  'today.banner.review.sub': {
    hardcore: 'All proof in, awaiting the verdict.',
    coach: 'All proof in, waiting on the call.',
    monk: 'Everything is in. Now we wait.',
  },
  'today.banner.done.title': {
    hardcore: '✓ Day complete',
  },
  'today.banner.done.sub': {
    hardcore: "Everything's in. See you tomorrow.",
    coach: "Everything's in. Nice work, see you tomorrow.",
    monk: 'Everything is in. Rest now.',
  },
  'today.banner.togo.title': {
    hardcore: ({ k }) => `${k} to go`,
  },
  'today.banner.togo.sub': {
    hardcore: ({ total }) => `Finish all ${total} before midnight or it's a fail.`,
    coach: ({ total }) => `All ${total} in before midnight, you've got this.`,
    monk: ({ total }) => `${total} pieces of today remain. There is still time.`,
  },
  // Soft-mode hero (Linen layout): the line under the big progress ring.
  'today.hero.encourage': {
    hardcore: ({ k }) => (k === 1 ? 'One left. Close it out.' : `${k} left. Keep it moving.`),
    coach: ({ k }) => (k === 1 ? 'One to go. The day is almost yours.' : `${k} to go. You are closer than you think.`),
    monk: ({ k }) => (k === 1 ? 'One remains. Finish gently.' : `${k} remain. One thing at a time.`),
  },
  'today.hero.done': {
    hardcore: 'All in. Day secured.',
    coach: 'Everything is in. Be proud of today.',
    monk: 'The day is whole. Rest now.',
  },

  // ── day complete celebration (both modes) ──
  'daycomplete.title': {
    hardcore: ({ n }) => `Day ${n} done`,
  },
  'daycomplete.sub': {
    hardcore: 'Every box checked. No excuses needed.',
    coach: 'You showed up for yourself today. See you tomorrow.',
    monk: 'Another stone laid on the path.',
  },
  'daycomplete.streak': {
    hardcore: ({ n }) => `${n} day streak`,
  },

  'today.aiflag.fallback': {
    hardcore: "this photo doesn't look like it matches the requirement.",
  },
  'today.aiflag.dismiss': {
    hardcore: "It's legit",
  },

  // ── standings ──
  'standings.title.solo': {
    hardcore: 'The Mission',
    monk: 'The Practice',
  },
  'standings.title.group': {
    hardcore: 'The Standings',
    coach: 'The Scoreboard',
    monk: 'The Circle',
  },
  'standings.title.accountability': {
    hardcore: 'Side by Side',
  },
  'standings.status.approved': {
    hardcore: 'Locked in',
    coach: 'In the books',
    monk: 'Complete',
  },
  'standings.status.pending': { hardcore: 'Awaiting referee' },
  'standings.status.active': { hardcore: 'In progress' },
  'standings.status.fail': {
    hardcore: 'Rejected',
    coach: 'Not approved',
    monk: "Didn't count",
  },
  'standings.ref.name': {
    hardcore: ({ name }) => `${name} is officiating`,
  },
  'standings.ref.sub': {
    hardcore: 'Every day is their call. Pass or fail, no appeals.',
    coach: 'They review every day. Honest calls keep this fair for everyone.',
    monk: 'Each day passes through their hands. Trust the process.',
  },
  'standings.honor.title': { hardcore: 'Honor system · AI spot checks' },
  'standings.honor.sub': { hardcore: 'Finished days count automatically. Photos get a quiet AI once-over.' },
  'standings.section.stakes': {
    hardcore: 'On the line',
    coach: 'Stakes',
    monk: 'Promises',
  },
  'stake.stamp': {
    hardcore: 'Forfeit',
    coach: 'Due',
    monk: 'Owed',
  },
  'stake.tag': {
    hardcore: 'on the line',
    coach: 'at stake',
    monk: 'promised',
  },
  'stake.if': {
    hardcore: ({ name }) => `If ${name} fails:`,
    coach: ({ name }) => `If ${name} misses:`,
    monk: ({ name }) => `If ${name} falls short:`,
  },
  'stake.due': {
    hardcore: ({ n }) => `Forfeit due · ${n} fail${n > 1 ? 's' : ''}`,
    coach: ({ n }) => `Stake due · ${n} miss${n > 1 ? 'es' : ''}`,
    monk: () => 'The promise comes due',
  },
  'stake.safe': {
    hardcore: 'Safe · on track',
    monk: 'Steady · on the path',
  },

  // ── day proof ──
  'proof.status.approved': { hardcore: 'Approved' },
  'proof.status.pending': { hardcore: 'Awaiting referee' },
  'proof.status.fail': {
    hardcore: 'Failed',
    coach: 'Not approved',
    monk: "Didn't count",
  },
  'proof.status.active': { hardcore: 'In progress' },
  'proof.status.upcoming': { hardcore: 'Upcoming' },
  'proof.refnote': {
    hardcore: ({ note }) => `Referee's note: “${note}”`,
  },

  // ── history ──
  'history.title': {
    hardcore: 'The Grind',
    coach: 'The Work',
    monk: 'The Path',
  },
  'history.extend.sub': {
    hardcore: "Adding days only makes the mountain taller, extensions can't be undone below your current day.",
    coach: 'Extensions are one-way. You can add days, not remove them.',
    monk: 'The path only grows longer, added days cannot be taken back.',
  },

  // ── goals ──
  'goals.title': {
    hardcore: 'The Build',
    coach: 'The Goals',
    monk: 'The Growth',
  },
  'goals.sub': {
    hardcore: 'optional goals · tracked daily, settled by the calendar',
    monk: 'optional goals · tended daily, harvested in time',
  },
  'coach.greeting.new': {
    hardcore: "What are you trying to achieve? Tell me like you'd tell a friend, the goal, where you're at now, and your deadline. I'll push back if the math doesn't work, then we lock in a plan.",
    coach: "What are you trying to achieve? Tell me the goal, where you're at now, and your deadline. I'll be straight with you about the math, then we set a plan.",
    monk: "What are you working toward? Tell me the goal, where you are today, and when you hope to arrive. We'll shape a plan that honors both ambition and patience.",
  },
  'coach.greeting.more': {
    hardcore: "What's next? You can add another goal alongside what you've got, or rework an existing one, tell me what you're after.",
    monk: "What's next on the path? We can add another goal or reshape one you have, tell me where you want to go.",
  },

  // ── referee ──
  'judge.title': {
    hardcore: "Referee's Bench",
    monk: "The Referee's Seat",
  },
  'judge.sub.queue': {
    hardcore: ({ n }) => `${n} day${n > 1 ? 's' : ''} to rule on`,
    coach: ({ n }) => `${n} day${n > 1 ? 's' : ''} waiting on you`,
    monk: ({ n }) => `${n} day${n > 1 ? 's' : ''} await your eyes`,
  },
  'judge.sub.clear': { hardcore: 'All caught up' },
  'judge.empty.title': { hardcore: 'Nothing to review' },
  'judge.empty.sub': {
    hardcore: ({ names }) => `When ${names} finishes a full day, it lands here for your verdict.`,
    coach: ({ names }) => `When ${names} finishes a full day, it lands here for your call.`,
    monk: ({ names }) => `When ${names} finishes a full day, it comes here to be witnessed.`,
  },
  'judge.recent': {
    hardcore: 'Recently ruled',
    coach: 'Recent calls',
    monk: 'Days witnessed',
  },

  // ── challenge formats (creation picker + framing) ──
  'format.solo.blurb': {
    hardcore: 'Just you against the calendar.',
    coach: 'Just you and the calendar.',
    monk: 'A path walked alone.',
  },
  'format.versus.blurb': {
    hardcore: 'Head-to-head. Shared fire, real stakes.',
    coach: 'Head-to-head with a friend, scored side by side.',
    monk: 'Two paths, one start line.',
  },
  'format.accountability.blurb': {
    hardcore: 'Different goals, same commitment, you keep each other honest.',
    monk: 'Different goals, walked together, you keep each other going.',
  },
  'format.community.blurb': {
    hardcore: 'A crew of up to 12, everyone running their own checklist.',
    monk: 'A circle of up to 12, each tending their own practice.',
  },
}

export function copyFor(tone) {
  const k = normalizeTone(tone)
  return (key, vars) => {
    const e = C[key]
    if (!e) return key
    const v = e[k] ?? e.hardcore
    return typeof v === 'function' ? v(vars || {}) : v
  }
}
