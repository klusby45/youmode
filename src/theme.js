// ─────────────────────────────────────────────────────────────────────────
// theme.js — the two-experience system.
// Two modes users pick from: Linen (soft — cream/sage/clay, serif, its own
// layout on key screens) and Navy (dark, the competitive look). Midnight is
// a hidden legacy theme kept for the original accounts; retired colorways
// (espresso/sand/blush) remap on read. CSS variables live in App.jsx's THEME
// string (`:root` = Midnight plus `:root[data-theme=...]` blocks); this
// module owns the metadata, the member-accent remaps, mode derivation, and
// applying/persisting the choice.
// NOTE: index.html has a tiny pre-paint copy of THEME_REMAP + THEME_BG —
// keep in sync.
// ─────────────────────────────────────────────────────────────────────────

export const THEMES = [
  { key: 'linen', label: 'Paper', mode: 'soft',
    blurb: 'Cream, soft, and warm.',
    swatch: { bg: '#F2ECDF', a: '#C15A34', b: '#8A7360', text: '#1E1810' } },
  { key: 'navy', label: 'Noir', mode: 'dark',
    blurb: 'Black, sharp, and focused.',
    swatch: { bg: '#14110D', a: '#D2794A', b: '#8FB073', text: '#EFE7D8' } },
  { key: 'midnight', label: 'Midnight', mode: 'dark', legacy: true,
    blurb: 'The original. Yours stays as is.',
    swatch: { bg: '#08080b', a: '#FF3B30', b: '#30D158', text: '#f5f5f7' } },
]

// Retired colorways land on the nearest surviving experience.
export const THEME_REMAP = { espresso: 'navy', sand: 'linen', blush: 'linen' }

export const THEME_BG = { midnight: '#08080b', navy: '#14110D', linen: '#F2ECDF' }

// Member accents stay canonical in the DB (MEMBER_COLORS) and remap at render
// time. Midnight is identity — untouched. Paper/Ink pull them into one warm
// earth family (terracotta, olive, ochre, clay) so nothing screams off-palette.
export const ACCENT_MAPS = {
  midnight: {},
  navy: { '#FF3B30': '#D2794A', '#34C759': '#8FB073', '#0A84FF': '#C9A24A', '#FF9F0A': '#D98A4A', '#FFD60A': '#E0C060' },
  linen: { '#FF3B30': '#C15A34', '#34C759': '#5E7449', '#0A84FF': '#A5772E', '#FF9F0A': '#B06A3E', '#FFD60A': '#9A7A28' },
}

export const mapAccent = (theme, hex) =>
  (hex && ACCENT_MAPS[theme]?.[String(hex).toUpperCase()]) || hex

export const normalizeTheme = (k) => {
  k = THEME_REMAP[k] || k
  return THEMES.some((t) => t.key === k) ? k : 'linen'
}

export const themeMode = (k) => THEMES.find((t) => t.key === normalizeTheme(k))?.mode || 'dark'

// What the pickers offer: the two modes, plus Midnight only for accounts
// already on it (legacy — never offered to new users).
export const pickableThemes = (current) => THEMES.filter((t) => !t.legacy || t.key === current)

export function getStoredTheme() {
  try { return normalizeTheme(localStorage.getItem('75hard-theme')) } catch { return 'linen' }
}

// Pin the status-bar color + html canvas for logged-out/first-run surfaces
// (no data-theme dependence; applyTheme owns chrome once signed in).
export function pinChrome(bg) {
  document.documentElement.style.background = bg
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}

export function applyTheme(key) {
  key = normalizeTheme(key)
  document.documentElement.dataset.theme = key
  document.documentElement.style.background = THEME_BG[key]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[key])
  try { localStorage.setItem('75hard-theme', key) } catch { /* private mode */ }
  return key
}
