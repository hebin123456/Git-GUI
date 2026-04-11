import { getPersistentStorageItem, setPersistentStorageItem } from './persistentStorage.ts'

export const APP_SETTINGS_STORAGE_KEY = 'git-fork-like.app-settings.v1'

/** 主窗口与 Git MM 等子窗口间同步设置（Electron 下 storage 事件不可靠时仍可用） */
export const APP_SETTINGS_SYNC_CHANNEL = 'git-fork-like.app-settings.sync'

export type ThemeMode = 'light' | 'dark' | 'system'

/** 界面语言（与 vue-i18n locale 一致） */
export type AppUiLocale = 'zh-CN' | 'en-US'

/** 合并冲突外部工具（传给 `git mergetool -t`） */
export type MergeToolPreset = 'default' | 'bc4' | 'bc3' | 'winmerge'

export type PersistedAppSettingsV1 = {
  v: 1
  theme: ThemeMode
  uiLocale: AppUiLocale
  diffDefaultFormat: 'side-by-side' | 'line-by-line'
  diffDefaultContextLines: number
  diffDefaultIgnoreBlankLines: boolean
  diffDefaultIgnoreWhitespace: boolean
  diffDefaultShowFullFile: boolean
  /** 「所有提交」每次加载的最近提交条数上限（大仓库建议 2000–8000） */
  historyMaxCommits: number
  /** 当当前仓库无已选远程、当前分支也无 upstream 时，优先使用该远程名作为回退。 */
  gitDefaultRemoteName: string
  /** Pull 对话框默认勾选「rebase instead of merge」。 */
  gitPullRebaseDefault: boolean
  /** Pull 对话框默认勾选 autostash。 */
  gitPullAutostashDefault: boolean
  /** Push 对话框默认勾选 set upstream。 */
  gitPushSetUpstreamDefault: boolean
  /**
   * 在仓库/子模块目录打开「Git 命令行」时使用的终端可执行文件绝对路径。
   * 留空则使用内置顺序（Windows：Git Bash → Windows Terminal → cmd）。
   */
  customGitShellPath: string
  /** 合并工具预设；非 default 时等价于 `git -c … mergetool -y -t <tool>` */
  mergeToolPreset: MergeToolPreset
  /**
   * 覆盖 mergetool 可执行文件路径（传给 `git -c mergetool.<tool>.path=…`）。
   * 若已安装到默认目录通常可留空。
   */
  mergeToolExecutablePath: string
}

export const DEFAULT_APP_SETTINGS: PersistedAppSettingsV1 = {
  v: 1,
  theme: 'system',
  uiLocale: 'zh-CN',
  diffDefaultFormat: 'side-by-side',
  diffDefaultContextLines: 3,
  diffDefaultIgnoreBlankLines: false,
  diffDefaultIgnoreWhitespace: false,
  diffDefaultShowFullFile: false,
  historyMaxCommits: 4000,
  gitDefaultRemoteName: '',
  gitPullRebaseDefault: false,
  gitPullAutostashDefault: false,
  gitPushSetUpstreamDefault: true,
  customGitShellPath: '',
  mergeToolPreset: 'default',
  mergeToolExecutablePath: ''
}

function clampContext(n: unknown): number {
  const x = Math.floor(Number(n))
  if (!Number.isFinite(x)) return DEFAULT_APP_SETTINGS.diffDefaultContextLines
  return Math.min(50, Math.max(0, x))
}

function clampHistoryMaxCommits(n: unknown): number {
  const x = Math.floor(Number(n))
  if (!Number.isFinite(x)) return DEFAULT_APP_SETTINGS.historyMaxCommits
  return Math.min(50_000, Math.max(500, x))
}

function sanitizeOptionalPath(s: unknown, maxLen: number): string {
  const t = String(s ?? '').trim()
  if (!t || t.length > maxLen) return ''
  if (/[\n\r\x00]/.test(t)) return ''
  return t
}

function sanitizeOptionalText(s: unknown, maxLen: number): string {
  const t = String(s ?? '').trim()
  if (!t || t.length > maxLen) return ''
  if (/[\n\r\x00]/.test(t)) return ''
  return t
}

function normalizeMergeToolPreset(p: unknown): MergeToolPreset {
  return p === 'bc4' || p === 'bc3' || p === 'winmerge' ? p : 'default'
}

export function normalizeAppSettings(partial: unknown): PersistedAppSettingsV1 {
  const p = partial && typeof partial === 'object' ? (partial as Partial<PersistedAppSettingsV1>) : {}
  const theme: ThemeMode =
    p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : DEFAULT_APP_SETTINGS.theme
  const uiLocale: AppUiLocale = p.uiLocale === 'en-US' ? 'en-US' : 'zh-CN'
  const fmt =
    p.diffDefaultFormat === 'line-by-line' || p.diffDefaultFormat === 'side-by-side'
      ? p.diffDefaultFormat
      : DEFAULT_APP_SETTINGS.diffDefaultFormat
  return {
    v: 1,
    theme,
    uiLocale,
    diffDefaultFormat: fmt,
    diffDefaultContextLines: clampContext(p.diffDefaultContextLines),
    diffDefaultIgnoreBlankLines: !!p.diffDefaultIgnoreBlankLines,
    diffDefaultIgnoreWhitespace: !!p.diffDefaultIgnoreWhitespace,
    diffDefaultShowFullFile: !!p.diffDefaultShowFullFile,
    historyMaxCommits: clampHistoryMaxCommits(p.historyMaxCommits),
    gitDefaultRemoteName: sanitizeOptionalText(p.gitDefaultRemoteName, 120),
    gitPullRebaseDefault: !!p.gitPullRebaseDefault,
    gitPullAutostashDefault: !!p.gitPullAutostashDefault,
    gitPushSetUpstreamDefault:
      typeof p.gitPushSetUpstreamDefault === 'boolean'
        ? p.gitPushSetUpstreamDefault
        : DEFAULT_APP_SETTINGS.gitPushSetUpstreamDefault,
    customGitShellPath: sanitizeOptionalPath(p.customGitShellPath, 500),
    mergeToolPreset: normalizeMergeToolPreset(p.mergeToolPreset),
    mergeToolExecutablePath: sanitizeOptionalPath(p.mergeToolExecutablePath, 500)
  }
}

export function loadAppSettings(): PersistedAppSettingsV1 {
  try {
    const raw = getPersistentStorageItem(APP_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_APP_SETTINGS }
    return normalizeAppSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

let settingsBroadcast: BroadcastChannel | null = null

function notifyOtherWindowsSettingsSaved(): void {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    if (!settingsBroadcast) settingsBroadcast = new BroadcastChannel(APP_SETTINGS_SYNC_CHANNEL)
    settingsBroadcast.postMessage({ type: 'settings' })
  } catch {
    /* ignore */
  }
}

export function saveAppSettings(data: PersistedAppSettingsV1): void {
  try {
    setPersistentStorageItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeAppSettings(data)))
    notifyOtherWindowsSettingsSaved()
  } catch {
    /* quota */
  }
}
