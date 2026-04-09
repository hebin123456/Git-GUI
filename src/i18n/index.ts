import { createI18n } from 'vue-i18n'
import { loadAppSettings, type AppUiLocale } from '../utils/appSettingsStorage.ts'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import extraZhCN from './locales/extra.zh-CN.json'
import extraEnUS from './locales/extra.en-US.json'
import dialogsSidebarZhCN from './locales/dialogs-sidebar.zh-CN.json'
import dialogsSidebarEnUS from './locales/dialogs-sidebar.en-US.json'

function mergeLocale(
  base: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    const b = base[k]
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      b &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      out[k] = mergeLocale(b as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

const initial = loadAppSettings()
const locale: AppUiLocale = initial.uiLocale === 'en-US' ? 'en-US' : 'zh-CN'

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': mergeLocale(
      mergeLocale(zhCN as Record<string, unknown>, extraZhCN as Record<string, unknown>),
      dialogsSidebarZhCN as Record<string, unknown>
    ) as typeof zhCN,
    'en-US': mergeLocale(
      mergeLocale(enUS as Record<string, unknown>, extraEnUS as Record<string, unknown>),
      dialogsSidebarEnUS as Record<string, unknown>
    ) as typeof enUS
  }
})

export function setAppLocale(tag: AppUiLocale): void {
  i18n.global.locale.value = tag
}
