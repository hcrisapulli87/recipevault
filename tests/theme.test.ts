import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getThemePref, setThemePref, initTheme } from '../src/renderer/lib/theme'

function mockMatchMedia(prefersDark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  )
}

describe('theme manager', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#f2f4f7" />'
  })

  it('defaults to system preference', () => {
    mockMatchMedia(true)
    initTheme()
    expect(getThemePref()).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resolves system-light to light', () => {
    mockMatchMedia(false)
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('setThemePref overrides system and persists', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('rv-theme')).toBe('dark')
  })

  it('updates the theme-color meta to match the resolved theme', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    expect(meta?.getAttribute('content')).toBe('#101216')
  })

  it('re-applies system preference when set back to system', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    setThemePref('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('rv-theme')).toBe('system')
  })
})
