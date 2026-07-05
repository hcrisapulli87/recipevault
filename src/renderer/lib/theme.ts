export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'rv-theme'
const META_COLOR = { light: '#f2f4f7', dark: '#101216' } as const

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  // Old WebViews without matchMedia fall back to light.
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function apply(): void {
  const theme = resolve(getThemePref())
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme])
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref)
  apply()
}

export function initTheme(): void {
  apply()
  if (typeof matchMedia === 'function') {
    // Live-update while in system mode (apply() re-checks the pref itself).
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
}
