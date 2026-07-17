// Unit checks for the two-experience theme system: remaps, mode derivation,
// picker visibility, metadata parity, and index.html boot-script sync.
import { readFileSync } from 'node:fs'
import { THEMES, THEME_REMAP, THEME_BG, ACCENT_MAPS, normalizeTheme, themeMode, pickableThemes } from '../src/theme.js'

let pass = true
const check = (n, ok, extra = '') => { console.log(`${ok ? '✓' : '✗ FAIL'}  ${n}${extra ? '  — ' + extra : ''}`); if (!ok) pass = false }

// normalizeTheme: every legacy, current, and garbage input
check("espresso → navy", normalizeTheme('espresso') === 'navy')
check("sand → linen", normalizeTheme('sand') === 'linen')
check("blush → linen", normalizeTheme('blush') === 'linen')
check("midnight stays midnight", normalizeTheme('midnight') === 'midnight')
check("navy stays navy", normalizeTheme('navy') === 'navy')
check("linen stays linen", normalizeTheme('linen') === 'linen')
check("null → linen (new default)", normalizeTheme(null) === 'linen')
check("garbage → linen", normalizeTheme('zebra') === 'linen')

// themeMode
check("linen is soft", themeMode('linen') === 'soft')
check("navy is dark", themeMode('navy') === 'dark')
check("midnight is dark", themeMode('midnight') === 'dark')
check("blush derives soft (via remap)", themeMode('blush') === 'soft')
check("espresso derives dark (via remap)", themeMode('espresso') === 'dark')

// pickableThemes: legacy hidden unless current
check("linen user sees 2 options", pickableThemes('linen').length === 2)
check("navy user sees 2 options", pickableThemes('navy').length === 2)
check("midnight user sees 3 options", pickableThemes('midnight').length === 3)
check("no legacy key offered to linen user", !pickableThemes('linen').some((t) => t.legacy))

// metadata parity
const keys = THEMES.map((t) => t.key).sort().join(',')
check("THEME_BG keys match THEMES", Object.keys(THEME_BG).sort().join(',') === keys)
check("ACCENT_MAPS keys match THEMES", Object.keys(ACCENT_MAPS).sort().join(',') === keys)
check("every theme has mode + blurb", THEMES.every((t) => ['soft', 'dark'].includes(t.mode) && t.blurb))

// index.html boot script stays in sync
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
for (const [from, to] of Object.entries(THEME_REMAP)) {
  check(`index.html remaps ${from} → ${to}`, new RegExp(`${from}:\\s*'${to}'`).test(html))
}
for (const t of THEMES) {
  check(`index.html knows '${t.key}'`, html.includes(`'${t.key}'`))
  check(`index.html paints ${t.key} bg ${THEME_BG[t.key]}`, html.includes(THEME_BG[t.key]))
}
check("index.html forgot no retired keys in known list", !/known = \[[^\]]*(espresso|sand|blush)/.test(html))

// user-facing copy in new keys carries no em-dashes
const copy = readFileSync(new URL('../src/copy.js', import.meta.url), 'utf8')
const newBlock = copy.slice(copy.indexOf("'today.hero.encourage'"), copy.indexOf("'today.aiflag.fallback'"))
check("new copy keys have no em-dashes", !newBlock.includes('—'))

console.log(pass ? '\n✓ THEME REMAP UNIT CHECKS PASSED' : '\n✗ FAILURES ABOVE')
process.exit(pass ? 0 : 1)
