// ─────────────────────────────────────────────────────────────────────────
// theme.js — the colorway system.
// Four themes: Midnight (default, the original), Espresso, Navy, Sand.
// CSS variables live in App.jsx's THEME string (`:root` = Midnight plus
// `:root[data-theme=...]` override blocks); this module owns the metadata,
// the member-accent remaps, and applying/persisting the choice.
// NOTE: index.html has a tiny pre-paint copy of THEME_BG — keep in sync.
// ─────────────────────────────────────────────────────────────────────────

export const THEMES = [
  { key: 'midnight', label: 'Midnight', swatch: { bg: '#08080b', a: '#FF3B30', b: '#30D158' } },
  { key: 'espresso', label: 'Espresso', swatch: { bg: '#120D0A', a: '#FF8A5C', b: '#3FD8C2' } },
  { key: 'navy', label: 'Navy', swatch: { bg: '#070D17', a: '#FF6B8A', b: '#3BD5F5' } },
  { key: 'sand', label: 'Sand', swatch: { bg: '#EAE0CE', a: '#8E3B54', b: '#206B62' } },
]

export const THEME_BG = { midnight: '#08080b', espresso: '#120D0A', navy: '#070D17', sand: '#EAE0CE' }

// Member accents stay canonical in the DB (MEMBER_COLORS); the three new
// themes remap them at render time to psychology-safe hues (no pure
// success-green / fail-red identities). Midnight is identity — untouched.
export const ACCENT_MAPS = {
  midnight: {},
  espresso: { '#FF3B30': '#FF8A5C', '#34C759': '#3FD8C2', '#0A84FF': '#7FA8FF', '#FF9F0A': '#F2789F', '#FFD60A': '#FFCE54' },
  navy: { '#FF3B30': '#FF6B8A', '#34C759': '#3BD5F5', '#0A84FF': '#9D8CFF', '#FF9F0A': '#FFA35C', '#FFD60A': '#FFD34D' },
  sand: { '#FF3B30': '#8E3B54', '#34C759': '#206B62', '#0A84FF': '#3B5B8C', '#FF9F0A': '#74468C', '#FFD60A': '#7A5E0C' },
}

export const mapAccent = (theme, hex) =>
  (hex && ACCENT_MAPS[theme]?.[String(hex).toUpperCase()]) || hex

export const normalizeTheme = (k) => (THEMES.some((t) => t.key === k) ? k : 'midnight')

export function getStoredTheme() {
  try { return normalizeTheme(localStorage.getItem('75hard-theme')) } catch { return 'midnight' }
}

export function applyTheme(key) {
  key = normalizeTheme(key)
  document.documentElement.dataset.theme = key
  document.documentElement.style.background = THEME_BG[key]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[key])
  try { localStorage.setItem('75hard-theme', key) } catch { /* private mode */ }
  return key
}
