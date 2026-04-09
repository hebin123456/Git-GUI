import type { ThemeMode } from './appSettingsStorage.ts'

let currentMode: ThemeMode = 'system'
let mediaQuery: MediaQueryList | null = null
let onMediaChange: (() => void) | null = null

const effectiveThemeListeners = new Set<() => void>()

/** 在 html.dark 实际变化后调用（含跟随系统时媒体查询变化） */
export function onThemeEffectiveChange(cb: () => void): () => void {
  effectiveThemeListeners.add(cb)
  return () => {
    effectiveThemeListeners.delete(cb)
  }
}

function fireEffectiveThemeChange() {
  for (const cb of effectiveThemeListeners) {
    try {
      cb()
    } catch {
      /* ignore */
    }
  }
}

function setDarkClass(on: boolean) {
  document.documentElement.classList.toggle('dark', on)
  fireEffectiveThemeChange()
}

function syncFromMode(mode: ThemeMode) {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  setDarkClass(dark)
}

/** 应用主题并（在 system 模式下）监听系统配色变化 */
export function applyAppTheme(mode: ThemeMode) {
  currentMode = mode
  if (mediaQuery && onMediaChange) {
    mediaQuery.removeEventListener('change', onMediaChange)
    mediaQuery = null
    onMediaChange = null
  }
  syncFromMode(mode)
  if (mode === 'system' && typeof window !== 'undefined') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    onMediaChange = () => {
      if (currentMode !== 'system') return
      setDarkClass(mediaQuery!.matches)
    }
    mediaQuery.addEventListener('change', onMediaChange)
  }
}
