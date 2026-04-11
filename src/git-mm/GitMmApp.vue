<script setup lang="ts">
import { Plus, Refresh, FolderOpened, Document, Minus, FullScreen, Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale } from '../i18n/index.ts'
import {
  APP_SETTINGS_STORAGE_KEY,
  APP_SETTINGS_SYNC_CHANNEL,
  loadAppSettings,
  normalizeAppSettings,
  saveAppSettings
} from '../utils/appSettingsStorage.ts'
import { getPersistentStorageItem, setPersistentStorageItem } from '../utils/persistentStorage.ts'
import { applyAppTheme, onThemeEffectiveChange } from '../utils/appTheme.ts'
import MmSubRepoPanel from './MmSubRepoPanel.vue'

const headerAppearanceDark = ref(false)

function syncHeaderAppearanceDark() {
  headerAppearanceDark.value = document.documentElement.classList.contains('dark')
}

/** 与主窗口一致：顶栏切换浅色/深色并写入 app 设置 */
function setHeaderThemeDark(dark: boolean) {
  const cur = loadAppSettings()
  const next = normalizeAppSettings({ ...cur, theme: dark ? 'dark' : 'light' })
  saveAppSettings(next)
  applyAppTheme(next.theme)
}

let themeEffectiveUnsub: (() => void) | null = null

/** 与主窗口共用 localStorage 中的外观设置（含暗黑模式），并在首帧前挂上 html.dark */
function syncGitMmAppearanceFromSettings() {
  const s = loadAppSettings()
  applyAppTheme(s.theme)
  setAppLocale(s.uiLocale === 'en-US' ? 'en-US' : 'zh-CN')
}

syncGitMmAppearanceFromSettings()
syncHeaderAppearanceDark()

function onAppSettingsSyncedFromOtherWindow() {
  syncGitMmAppearanceFromSettings()
  syncHeaderAppearanceDark()
}

function onAppSettingsStorage(e: StorageEvent) {
  if (e.key !== APP_SETTINGS_STORAGE_KEY || e.storageArea !== localStorage) return
  onAppSettingsSyncedFromOtherWindow()
}

let settingsSyncChannel: BroadcastChannel | null = null
let gitMmOutputUnsub: (() => void) | null = null

const STORAGE_KEY = 'gitforklike-mm-workspaces-v1'
const MM_START_STORAGE_KEY = 'gitforklike-mm-start-v1'
const SYNC_JOBS_STORAGE_KEY = 'gitforklike-mm-sync-jobs-v1'
const SUBREPO_ORDER_STORAGE_KEY = 'gitforklike-mm-subrepo-order-v1'

type MmWorkspace = { id: string; rootPath: string; label: string }
type MmStartPersist = { branch: string }

const { t } = useI18n()

const canControlWindow = typeof window !== 'undefined' && typeof window.electronWindow !== 'undefined'

function winMinimize() {
  void window.electronWindow?.minimize()
}
function winMaximize() {
  void window.electronWindow?.maximize()
}
function winClose() {
  void window.electronWindow?.close()
}

const workspaces = ref<MmWorkspace[]>([])
const activeWsId = ref('')
const subPathsByWs = ref<Record<string, string[]>>({})
const subrepoOrderByWs = ref<Record<string, string[]>>({})
const activeSubPath = ref<Record<string, string>>({})
const initDialog = ref(false)
const startDialog = ref(false)
const syncBusy = ref(false)
const workspaceBusyDepth = ref(0)
const workspaceBusyText = ref('')
/** `git mm sync -j <n>` 并行任务数（与 `git mm sync -j4` 中 4 含义一致） */
const syncParallelJobs = ref(8)
/** 正在执行的参数（用于展示） */
const mmPendingArgs = ref<string[] | null>(null)
type MmLastRun =
  | {
      kind: 'finished'
      cmd: string
      cwd: string
      ms: number
      code: number
      stdout: string
      stderr: string
    }
  | { kind: 'spawn_error'; cmd: string; cwd: string; ms: number; message: string }
const mmLastRun = ref<MmLastRun | null>(null)
const mmOutputDialogOpen = ref(false)
const mmOutputLiveText = ref('')
const mmOutputBodyRef = ref<HTMLDivElement | null>(null)
const workspaceDragFromIndex = ref<number | null>(null)
const subrepoDragFromIndex = ref<number | null>(null)
const suppressWorkspaceTabSwitch = ref(false)
const suppressSubrepoTabSwitch = ref(false)
const subrepoCtxMenu = ref<{
  visible: boolean
  x: number
  y: number
  repoPath: string
}>({
  visible: false,
  x: 0,
  y: 0,
  repoPath: ''
})
const initUrl = ref('')
const initManifest = ref('dependency.xml')
const initBranch = ref('master')
const initGroup = ref('default')
/** Start 弹窗中输入，执行 `git mm start <branch>`；上次输入会记住 */
const mmStartBranch = ref('')

const activeWorkspace = computed(() => workspaces.value.find((w) => w.id === activeWsId.value) ?? null)
const workspaceBusy = computed(() => workspaceBusyDepth.value > 0)
const workAreaBusy = computed(() => syncBusy.value || workspaceBusy.value)
const workAreaBusyText = computed(() =>
  syncBusy.value ? t('gitMm.mmBlockingWork') : workspaceBusyText.value || t('common.loading')
)

function beginWorkspaceBusy(text: string): () => void {
  workspaceBusyDepth.value += 1
  workspaceBusyText.value = text
  let ended = false
  return () => {
    if (ended) return
    ended = true
    workspaceBusyDepth.value = Math.max(0, workspaceBusyDepth.value - 1)
    if (!workspaceBusyDepth.value) workspaceBusyText.value = ''
  }
}

async function runWorkspaceBusy<T>(text: string, task: () => Promise<T>): Promise<T> {
  const endBusy = beginWorkspaceBusy(text)
  try {
    return await task()
  } finally {
    endBusy()
  }
}

const subrepos = computed(() => {
  const w = activeWorkspace.value
  if (!w) return []
  return subPathsByWs.value[w.id] ?? []
})

function moveListItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return [...list]
  next.splice(to, 0, item)
  return next
}

function withSuppressedTabSwitch(flag: { value: boolean }) {
  flag.value = true
  window.setTimeout(() => {
    flag.value = false
  }, 80)
}

function mergeSubrepoOrder(wsId: string, scannedPaths: string[]): string[] {
  const saved = subrepoOrderByWs.value[wsId] ?? []
  if (!saved.length) return [...scannedPaths]
  const scannedSet = new Set(scannedPaths)
  const ordered = saved.filter((p) => scannedSet.has(p))
  const used = new Set(ordered)
  const rest = scannedPaths.filter((p) => !used.has(p))
  return [...ordered, ...rest]
}

const currentSubPath = computed({
  get: () => {
    const w = activeWorkspace.value
    if (!w) return ''
    return activeSubPath.value[w.id] ?? ''
  },
  set: (v: string) => {
    const w = activeWorkspace.value
    if (!w) return
    activeSubPath.value = { ...activeSubPath.value, [w.id]: v }
  }
})

function persist() {
  try {
    setPersistentStorageItem(STORAGE_KEY, JSON.stringify(workspaces.value))
  } catch {
    /* ignore */
  }
}

function persistSubrepoOrder() {
  try {
    setPersistentStorageItem(SUBREPO_ORDER_STORAGE_KEY, JSON.stringify(subrepoOrderByWs.value))
  } catch {
    /* ignore */
  }
}

function persistMmStart() {
  try {
    const p: MmStartPersist = { branch: mmStartBranch.value }
    setPersistentStorageItem(MM_START_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

function clampSyncJobs(n: number): number {
  if (!Number.isFinite(n)) return 4
  return Math.min(32, Math.max(1, Math.round(n)))
}

function loadSyncParallelJobs(): number {
  try {
    const raw = getPersistentStorageItem(SYNC_JOBS_STORAGE_KEY)
    if (raw) {
      const n = Number(JSON.parse(raw))
      if (Number.isFinite(n)) return clampSyncJobs(n)
    }
  } catch {
    /* ignore */
  }
  return 4
}

function persistSyncParallelJobs() {
  try {
    setPersistentStorageItem(SYNC_JOBS_STORAGE_KEY, JSON.stringify(clampSyncJobs(syncParallelJobs.value)))
  } catch {
    /* ignore */
  }
}

function formatMmCmd(args: string[]) {
  return `git mm ${args
    .map((a) => (/\s/.test(a) ? `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : a))
    .join(' ')}`
}

const mmOutputCollapseTitle = computed(() => {
  if (syncBusy.value) return t('gitMm.mmRunningTitle')
  const r = mmLastRun.value
  if (!r) return t('gitMm.mmOutput')
  if (r.kind === 'spawn_error') return t('gitMm.mmSpawnErrorTitle')
  return t('gitMm.mmRunSummary', { code: r.code, ms: r.ms })
})

const mmStreamText = computed(() => {
  const r = mmLastRun.value
  if (!r || r.kind !== 'finished') return ''
  return [r.stdout, r.stderr].filter(Boolean).join('\n---\n')
})

const mmOutputText = computed(() => mmOutputLiveText.value || mmStreamText.value)
const mmCopyableText = computed(() => {
  const r = mmLastRun.value
  if (r?.kind === 'spawn_error') return r.message
  return mmOutputText.value
})

function scrollMmOutputToBottom() {
  const el = mmOutputBodyRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function appendMmOutput(text: string) {
  if (!text) return
  mmOutputLiveText.value += text
  if (mmOutputLiveText.value.length > 2_800_000) {
    mmOutputLiveText.value = mmOutputLiveText.value.slice(-2_800_000)
  }
  if (mmOutputDialogOpen.value) {
    void nextTick(() => scrollMmOutputToBottom())
  }
}

function openMmOutputDialog() {
  mmOutputDialogOpen.value = true
}

async function copyMmOutput() {
  const text = mmCopyableText.value
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('common.copied'))
  } catch {
    ElMessage.error(t('common.copyFailed'))
  }
}

function shortName(full: string) {
  const parts = full.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || full
}

function closeSubrepoCtxMenu() {
  subrepoCtxMenu.value.visible = false
}

function beforeWorkspaceTabLeave() {
  return !suppressWorkspaceTabSwitch.value
}

function beforeSubrepoTabLeave() {
  return !suppressSubrepoTabSwitch.value
}

function onWorkspaceDragStart(e: DragEvent, index: number) {
  if (workAreaBusy.value) return
  workspaceDragFromIndex.value = index
  e.dataTransfer?.setData('text/plain', `mm-workspace:${index}`)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  closeSubrepoCtxMenu()
}

function onWorkspaceDragEnd() {
  workspaceDragFromIndex.value = null
  withSuppressedTabSwitch(suppressWorkspaceTabSwitch)
}

function onWorkspaceDragOver(e: DragEvent) {
  if (workAreaBusy.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onWorkspaceDrop(e: DragEvent, toIndex: number) {
  if (workAreaBusy.value) return
  e.preventDefault()
  e.stopPropagation()
  const from = workspaceDragFromIndex.value
  if (from === null || from === toIndex) return
  workspaces.value = moveListItem(workspaces.value, from, toIndex)
  workspaceDragFromIndex.value = null
  persist()
}

function onSubrepoDragStart(e: DragEvent, index: number) {
  if (workAreaBusy.value) return
  subrepoDragFromIndex.value = index
  e.dataTransfer?.setData('text/plain', `mm-subrepo:${index}`)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  closeSubrepoCtxMenu()
}

function onSubrepoDragEnd() {
  subrepoDragFromIndex.value = null
  withSuppressedTabSwitch(suppressSubrepoTabSwitch)
}

function onSubrepoDragOver(e: DragEvent) {
  if (workAreaBusy.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onSubrepoDrop(e: DragEvent, toIndex: number) {
  if (workAreaBusy.value) return
  e.preventDefault()
  e.stopPropagation()
  const from = subrepoDragFromIndex.value
  const w = activeWorkspace.value
  if (!w || from === null || from === toIndex) return
  const current = subPathsByWs.value[w.id] ?? []
  const next = moveListItem(current, from, toIndex)
  subPathsByWs.value = { ...subPathsByWs.value, [w.id]: next }
  subrepoOrderByWs.value = { ...subrepoOrderByWs.value, [w.id]: [...next] }
  subrepoDragFromIndex.value = null
  persistSubrepoOrder()
}

function clampCtxMenuPos(x: number, y: number) {
  const pad = 8
  const w = 260
  const h = 120
  return {
    x: Math.min(x, window.innerWidth - w - pad),
    y: Math.min(y, window.innerHeight - h - pad)
  }
}

function openSubrepoCtxMenu(e: MouseEvent, repoPath: string) {
  if (!repoPath || workAreaBusy.value) return
  e.preventDefault()
  e.stopPropagation()
  const p = clampCtxMenuPos(e.clientX, e.clientY)
  subrepoCtxMenu.value = {
    visible: true,
    x: p.x,
    y: p.y,
    repoPath
  }
}

async function openSubrepoInMain(repoPath: string) {
  const target = String(repoPath ?? '').trim()
  closeSubrepoCtxMenu()
  if (!target) return
  const r = await window.gitClient.focusMainWithRepo(target)
  if (!r.ok) ElMessage.error(r.error)
  else ElMessage.info(t('gitMm.openInMainForAdvancedFeatures'))
}

function onGlobalPointerDown(e: MouseEvent) {
  const t = e.target as Node
  if (t instanceof Element && t.closest('.fork-native-ctx-menu')) return
  closeSubrepoCtxMenu()
}

async function addWorkspace() {
  if (syncBusy.value || workspaceBusy.value) return
  const p = await window.gitClient.selectDirectory()
  if (!p) return
  const id = `mm-ws-${Date.now()}`
  const label = p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p
  await runWorkspaceBusy(t('gitMm.loadingWorkspace', { name: label }), async () => {
    workspaces.value = [...workspaces.value, { id, rootPath: p, label }]
    activeWsId.value = id
    persist()
    await scanSubrepos({ skipBusy: true })
  })
}

function removeWorkspace(id: string) {
  if (syncBusy.value || workspaceBusy.value) return
  workspaces.value = workspaces.value.filter((w) => w.id !== id)
  const next = { ...subPathsByWs.value }
  delete next[id]
  subPathsByWs.value = next
  const nextOrder = { ...subrepoOrderByWs.value }
  delete nextOrder[id]
  subrepoOrderByWs.value = nextOrder
  const sp = { ...activeSubPath.value }
  delete sp[id]
  activeSubPath.value = sp
  if (activeWsId.value === id) {
    activeWsId.value = workspaces.value[0]?.id ?? ''
  }
  persist()
  persistSubrepoOrder()
}

async function scanSubrepos(opts?: { skipBusy?: boolean }) {
  const w = activeWorkspace.value
  if (!w) return
  if (workspaceBusy.value && !opts?.skipBusy) return
  const run = async () => {
    const r = await window.gitMm.listSubrepos(w.rootPath, 4)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    const ordered = mergeSubrepoOrder(w.id, r.paths)
    subPathsByWs.value = { ...subPathsByWs.value, [w.id]: ordered }
    subrepoOrderByWs.value = { ...subrepoOrderByWs.value, [w.id]: [...ordered] }
    persistSubrepoOrder()
    if (ordered.length && !ordered.includes(currentSubPath.value)) {
      currentSubPath.value = ordered[0]!
    }
  }
  if (opts?.skipBusy) return run()
  await runWorkspaceBusy(t('gitMm.loadingSubrepos', { name: w.label }), run)
}

async function runMm(args: string[]) {
  if (workspaceBusy.value) return
  const w = activeWorkspace.value
  if (!w) {
    ElMessage.warning(t('gitMm.needWorkspace'))
    return
  }
  const cwd = w.rootPath
  const cmd = formatMmCmd(args)
  syncBusy.value = true
  mmPendingArgs.value = args
  mmLastRun.value = null
  mmOutputLiveText.value = ''
  mmOutputDialogOpen.value = true
  const t0 = performance.now()
  let r: Awaited<ReturnType<typeof window.gitMm.exec>> | undefined
  try {
    r = await window.gitMm.exec({ cwd, args })
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    const message = e instanceof Error ? e.message : String(e)
    mmLastRun.value = { kind: 'spawn_error', cmd, cwd, ms, message }
    ElMessage.error(message)
    await scanSubrepos()
    return
  } finally {
    syncBusy.value = false
    mmPendingArgs.value = null
  }
  const ms = Math.round(performance.now() - t0)
  if (!r) return
  if ('error' in r) {
    mmLastRun.value = { kind: 'spawn_error', cmd, cwd, ms, message: r.error }
    ElMessage.error(r.error)
    await scanSubrepos()
    return
  }
  mmLastRun.value = {
    kind: 'finished',
    cmd,
    cwd,
    ms,
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr
  }
  if (r.code !== 0) {
    // sync/init 常在 stderr 打印 ERROR xxx，属 git mm/清单脚本输出，非本工具故障；用 info 避免误报成「失败」
    ElMessage.info({ message: t('gitMm.mmFinishedNonZero', { code: r.code }), duration: 5200 })
  } else {
    ElMessage.success({ message: t('gitMm.mmOk'), duration: 4500 })
  }
  await scanSubrepos()
}

async function runSync() {
  const j = clampSyncJobs(Number(syncParallelJobs.value) || 4)
  syncParallelJobs.value = j
  persistSyncParallelJobs()
  await runMm(['sync', '-j', String(j)])
}

/** `git mm upload` 等需在终端确认 [Y/n] 的命令 */
async function runMmInteractive(args: string[]) {
  if (workspaceBusy.value) return
  const w = activeWorkspace.value
  if (!w) {
    ElMessage.warning(t('gitMm.needWorkspace'))
    return
  }
  const cwd = w.rootPath
  const cmd = formatMmCmd(args)
  syncBusy.value = true
  mmPendingArgs.value = args
  mmLastRun.value = null
  mmOutputLiveText.value = ''
  mmOutputDialogOpen.value = true
  const t0 = performance.now()

  const un = window.gitMm.onPrompt(async (p) => {
    try {
      await ElMessageBox.confirm(
        p.promptText || t('gitMm.uploadPromptFallback'),
        t('gitMm.uploadConfirmTitle'),
        {
          confirmButtonText: 'Y',
          cancelButtonText: 'N',
          type: 'warning',
          distinguishCancelAndClose: true
        }
      )
      window.gitMm.answerPrompt(p.id, 'y')
    } catch {
      window.gitMm.answerPrompt(p.id, 'n')
    }
  })

  let r: Awaited<ReturnType<typeof window.gitMm.execInteractive>> | undefined
  try {
    r = await window.gitMm.execInteractive({ cwd, args })
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    const message = e instanceof Error ? e.message : String(e)
    mmLastRun.value = { kind: 'spawn_error', cmd, cwd, ms, message }
    ElMessage.error(message)
    await scanSubrepos()
    return
  } finally {
    un()
    syncBusy.value = false
    mmPendingArgs.value = null
  }

  const ms = Math.round(performance.now() - t0)
  if (!r) return
  if ('error' in r) {
    mmLastRun.value = { kind: 'spawn_error', cmd, cwd, ms, message: r.error }
    ElMessage.error(r.error)
    await scanSubrepos()
    return
  }
  mmLastRun.value = {
    kind: 'finished',
    cmd,
    cwd,
    ms,
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr
  }
  if (r.code !== 0) {
    ElMessage.info({ message: t('gitMm.mmFinishedNonZero', { code: r.code }), duration: 5200 })
  } else {
    ElMessage.success({ message: t('gitMm.mmOk'), duration: 4500 })
  }
  await scanSubrepos()
}

async function runUpload() {
  await runMmInteractive(['upload'])
}

async function onInitSubmit() {
  const u = initUrl.value.trim()
  if (!u) {
    ElMessage.warning(t('gitMm.initUrlRequired'))
    return
  }
  const m = initManifest.value.trim() || 'dependency.xml'
  const b = initBranch.value.trim() || 'master'
  const g = initGroup.value.trim() || 'default'
  initDialog.value = false
  await runMm(['init', '-u', u, '-m', m, '-b', b, '-g', g])
}

function openStartDialog() {
  if (workAreaBusy.value || !activeWorkspace.value) return
  startDialog.value = true
}

async function onStartSubmit() {
  const branch = mmStartBranch.value.trim()
  if (!branch) {
    ElMessage.warning(t('gitMm.needStartBranch'))
    return
  }
  persistMmStart()
  startDialog.value = false
  await runMm(['start', branch])
}

function openWorkspaceFolder() {
  const w = activeWorkspace.value
  if (!w) return
  void window.gitMm.openAbsolutePath(w.rootPath)
}

watch(activeWsId, () => {
  closeSubrepoCtxMenu()
  workspaceDragFromIndex.value = null
  subrepoDragFromIndex.value = null
  void scanSubrepos()
})

watch([currentSubPath, workAreaBusy], () => {
  closeSubrepoCtxMenu()
})

onMounted(() => {
  window.addEventListener('storage', onAppSettingsStorage)
  document.addEventListener('mousedown', onGlobalPointerDown, true)
  gitMmOutputUnsub = window.gitMm.onOutput((payload) => {
    appendMmOutput(payload.text)
  })
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      settingsSyncChannel = new BroadcastChannel(APP_SETTINGS_SYNC_CHANNEL)
      settingsSyncChannel.onmessage = () => onAppSettingsSyncedFromOtherWindow()
    } catch {
      settingsSyncChannel = null
    }
  }
  themeEffectiveUnsub = onThemeEffectiveChange(syncHeaderAppearanceDark)
  try {
    const startRaw = getPersistentStorageItem(MM_START_STORAGE_KEY)
    if (startRaw) {
      const p = JSON.parse(startRaw) as MmStartPersist
      if (p && typeof p.branch === 'string') mmStartBranch.value = p.branch
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = getPersistentStorageItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as MmWorkspace[]
      if (Array.isArray(arr) && arr.length) {
        workspaces.value = arr.filter((x) => x?.id && x?.rootPath)
        activeWsId.value = workspaces.value[0]?.id ?? ''
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = getPersistentStorageItem(SUBREPO_ORDER_STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Record<string, string[]>
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        subrepoOrderByWs.value = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => String(x)) : []])
        )
      }
    }
  } catch {
    /* ignore */
  }
  if (activeWorkspace.value) void scanSubrepos()
  syncParallelJobs.value = loadSyncParallelJobs()
})

onUnmounted(() => {
  window.removeEventListener('storage', onAppSettingsStorage)
  document.removeEventListener('mousedown', onGlobalPointerDown, true)
  gitMmOutputUnsub?.()
  gitMmOutputUnsub = null
  if (settingsSyncChannel) {
    settingsSyncChannel.close()
    settingsSyncChannel = null
  }
  themeEffectiveUnsub?.()
  themeEffectiveUnsub = null
})

watch(syncParallelJobs, (v) => {
  const c = clampSyncJobs(Number(v) || 4)
  if (c !== v) syncParallelJobs.value = c
  persistSyncParallelJobs()
})

watch(mmOutputDialogOpen, (open) => {
  if (open) void nextTick(() => scrollMmOutputToBottom())
})
</script>

<template>
  <div class="git-mm-app">
    <div class="git-mm-titlebar">
      <div class="git-mm-titlebar-brand no-drag">
        <el-icon :size="18"><Document /></el-icon>
        <span class="git-mm-titlebar-title">{{ t('gitMm.windowTitle') }}</span>
        <el-tag type="warning" size="small" effect="plain">{{ t('gitMm.beta') }}</el-tag>
      </div>
      <div v-if="canControlWindow" class="git-mm-titlebar-drag drag-region" aria-hidden="true" />
      <div v-else class="git-mm-titlebar-drag-spacer" aria-hidden="true" />
      <div class="git-mm-titlebar-trailing no-drag">
        <div class="git-mm-theme-wrap" :title="t('app.themeSwitchTitle')">
          <el-switch
            :model-value="headerAppearanceDark"
            size="small"
            inline-prompt
            :active-text="t('app.themeDark')"
            :inactive-text="t('app.themeLight')"
            @change="setHeaderThemeDark"
          />
        </div>
        <div v-if="canControlWindow" class="git-mm-titlebar-win">
          <el-button text class="win-btn" :title="t('app.winMin')" @click="winMinimize">
            <el-icon :size="12"><Minus /></el-icon>
          </el-button>
          <el-button text class="win-btn" :title="t('app.winMax')" @click="winMaximize">
            <el-icon :size="12"><FullScreen /></el-icon>
          </el-button>
          <el-button text class="win-btn git-mm-win-close" :title="t('app.winClose')" @click="winClose">
            <el-icon :size="12"><Close /></el-icon>
          </el-button>
        </div>
      </div>
    </div>
    <div class="git-mm-app-body">
      <header class="git-mm-head fork-header-wrap no-drag">
        <div class="git-mm-toolbar fork-toolbar">
          <div class="tb-tools git-mm-toolbar-actions">
            <el-button type="primary" size="small" :disabled="workAreaBusy" @click="addWorkspace">
              <el-icon class="el-icon--left"><Plus /></el-icon>
              {{ t('gitMm.addWorkspace') }}
            </el-button>
            <el-button size="small" :disabled="workAreaBusy || !activeWorkspace" @click="openWorkspaceFolder">
              <el-icon class="el-icon--left"><FolderOpened /></el-icon>
              {{ t('gitMm.openFolder') }}
            </el-button>
            <el-button size="small" :disabled="workAreaBusy || !activeWorkspace" @click="initDialog = true">
              {{ t('gitMm.initMm') }}
            </el-button>
            <div class="git-mm-sync-row" :title="t('gitMm.syncParallelHint')">
              <el-button
                size="small"
                type="primary"
                plain
                :loading="syncBusy"
                :disabled="workAreaBusy || !activeWorkspace"
                @click="runSync"
              >
                {{ t('gitMm.sync') }}
              </el-button>
              <span class="git-mm-sync-jobs-label">{{ t('gitMm.syncParallelJobs') }}</span>
              <el-input-number
                v-model="syncParallelJobs"
                size="small"
                :min="1"
                :max="32"
                :step="1"
                :disabled="workAreaBusy"
                controls-position="right"
                class="git-mm-sync-jobs-input"
              />
            </div>
            <el-button
              size="small"
              type="success"
              plain
              :loading="syncBusy"
              :disabled="workAreaBusy || !activeWorkspace"
              @click="openStartDialog"
            >
              {{ t('gitMm.startMm') }}
            </el-button>
            <el-button
              size="small"
              type="warning"
              plain
              :loading="syncBusy"
              :disabled="workAreaBusy || !activeWorkspace"
              :title="t('gitMm.uploadHint')"
              @click="runUpload"
            >
              {{ t('gitMm.upload') }}
            </el-button>
            <el-button size="small" :disabled="workAreaBusy || !activeWorkspace" @click="scanSubrepos">
              <el-icon class="el-icon--left"><Refresh /></el-icon>
              {{ t('gitMm.refreshChildren') }}
            </el-button>
          </div>
          <div class="tb-center tb-center-compact git-mm-toolbar-hint">
            <el-text
              v-if="activeWorkspace"
              truncated
              type="info"
              size="small"
              class="repo-path-hint git-mm-active-path"
              :title="activeWorkspace.rootPath"
            >
              {{ activeWorkspace.rootPath }}
            </el-text>
            <span v-else class="repo-title-muted git-mm-toolbar-empty-hint" :title="t('gitMm.emptyWorkspaces')">
              {{ t('gitMm.needWorkspace') }}
            </span>
          </div>
          <div class="tb-right git-mm-toolbar-trailing">
            <el-button
              v-if="syncBusy || mmLastRun"
              size="small"
              plain
              :type="syncBusy ? 'warning' : mmLastRun?.kind === 'spawn_error' ? 'danger' : 'info'"
              @click="openMmOutputDialog"
            >
              {{ t('gitMm.mmOutput') }}
            </el-button>
          </div>
        </div>
      </header>

      <div class="git-mm-body">
        <div
          class="git-mm-work-area fork-main"
          v-loading.lock="workAreaBusy"
          :element-loading-text="workAreaBusyText"
        >
          <template v-if="workspaces.length">
            <el-tabs
              v-model="activeWsId"
              type="card"
              class="git-mm-ws-tabs"
              :closable="!workAreaBusy"
              :before-leave="beforeWorkspaceTabLeave"
              @tab-remove="(name: string) => removeWorkspace(name)"
            >
              <el-tab-pane v-for="(w, index) in workspaces" :key="w.id" :name="w.id">
                <template #label>
                  <div
                    class="git-mm-ws-tab-label"
                    :title="w.rootPath"
                    :draggable="!workAreaBusy"
                    @dragstart="onWorkspaceDragStart($event, index)"
                    @dragend="onWorkspaceDragEnd"
                    @dragenter.prevent="onWorkspaceDragOver"
                    @dragover="onWorkspaceDragOver"
                    @drop="onWorkspaceDrop($event, index)"
                  >
                    {{ w.label }}
                  </div>
                </template>
                <div class="git-mm-ws-pane">
                  <template v-if="subrepos.length">
                    <el-tabs
                      v-model="currentSubPath"
                      type="border-card"
                      class="git-mm-sub-tabs"
                      :before-leave="beforeSubrepoTabLeave"
                    >
                      <el-tab-pane
                        v-for="(p, index) in subrepos"
                        :key="p"
                        :name="p"
                      >
                        <template #label>
                          <div
                            class="git-mm-sub-tab-label"
                            :title="p"
                            :draggable="!workAreaBusy"
                            @dragstart="onSubrepoDragStart($event, index)"
                            @dragend="onSubrepoDragEnd"
                            @dragenter.prevent="onSubrepoDragOver"
                            @dragover="onSubrepoDragOver"
                            @drop="onSubrepoDrop($event, index)"
                            @contextmenu.prevent.stop="(e: MouseEvent) => openSubrepoCtxMenu(e, p)"
                          >
                            {{ shortName(p) }}
                          </div>
                        </template>
                        <MmSubRepoPanel v-if="currentSubPath === p" :repo-path="p" />
                      </el-tab-pane>
                    </el-tabs>
                  </template>
                  <el-empty v-else :description="t('gitMm.noSubrepos')" />
                </div>
              </el-tab-pane>
            </el-tabs>
          </template>
          <el-empty v-else class="git-mm-empty-state" :description="t('gitMm.emptyWorkspaces')" />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="mmOutputDialogOpen"
      :title="mmOutputCollapseTitle"
      width="78vw"
      top="6vh"
      append-to-body
      :close-on-click-modal="false"
      class="git-mm-output-dialog"
    >
      <div class="git-mm-output-dialog-toolbar">
        <div class="git-mm-run-block">
          <p v-if="syncBusy && mmPendingArgs" class="git-mm-run-meta mono">{{ formatMmCmd(mmPendingArgs) }}</p>
          <p v-else-if="mmLastRun" class="git-mm-run-meta mono">{{ mmLastRun.cmd }}</p>
          <p
            v-if="syncBusy && activeWorkspace?.rootPath"
            class="git-mm-run-meta mono"
          >
            {{ activeWorkspace.rootPath }}
          </p>
          <p v-else-if="mmLastRun" class="git-mm-run-meta mono">{{ mmLastRun.cwd }}</p>
        </div>
        <div class="git-mm-output-dialog-actions">
          <el-tag v-if="syncBusy" size="small" type="warning" effect="plain">{{ t('common.loading') }}</el-tag>
          <el-button size="small" text :disabled="!mmCopyableText.trim()" @click="copyMmOutput">
            {{ t('common.copy') }}
          </el-button>
        </div>
      </div>
      <p v-if="mmLastRun?.kind === 'finished' && mmLastRun.code !== 0" class="git-mm-error-lines-hint">
        {{ t('gitMm.mmErrorLinesHint') }}
      </p>
      <div ref="mmOutputBodyRef" class="git-mm-output-dialog-body">
        <div v-if="mmLastRun?.kind === 'spawn_error'" class="git-mm-run-block">
          <pre class="git-mm-output-pre mono">{{ mmLastRun.message }}</pre>
        </div>
        <div v-else-if="mmOutputText" class="git-mm-run-block">
          <pre class="git-mm-output-pre mono">{{ mmOutputText }}</pre>
        </div>
        <p v-else-if="syncBusy" class="git-mm-running-hint">{{ t('gitMm.mmRunningHint') }}</p>
        <p v-else class="git-mm-no-output">{{ t('gitMm.mmNoOutput') }}</p>
      </div>
    </el-dialog>

    <el-dialog v-model="startDialog" :title="t('gitMm.startDialogTitle')" width="480px" destroy-on-close>
      <p class="git-mm-start-dialog-hint">{{ t('gitMm.startDialogHint') }}</p>
      <el-form label-position="top">
        <el-form-item :label="t('gitMm.startBranch')">
          <el-input
            v-model="mmStartBranch"
            clearable
            :placeholder="t('gitMm.startBranchPh')"
            @keydown.enter.prevent="onStartSubmit"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="startDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="onStartSubmit">{{ t('gitMm.runStart') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="initDialog" :title="t('gitMm.initTitle')" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item :label="t('gitMm.initUrl')">
          <el-input v-model="initUrl" :placeholder="t('gitMm.initUrlPh')" />
        </el-form-item>
        <el-form-item :label="t('gitMm.initManifest')">
          <el-input v-model="initManifest" />
        </el-form-item>
        <el-form-item :label="t('gitMm.initBranch')">
          <el-input v-model="initBranch" />
        </el-form-item>
        <el-form-item :label="t('gitMm.initGroup')">
          <el-input v-model="initGroup" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="initDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="onInitSubmit">{{ t('gitMm.runInit') }}</el-button>
      </template>
    </el-dialog>
    <Teleport to="body">
      <div
        v-if="subrepoCtxMenu.visible"
        class="fork-native-ctx-menu git-mm-subrepo-ctx-menu"
        :style="{ left: subrepoCtxMenu.x + 'px', top: subrepoCtxMenu.y + 'px' }"
        @contextmenu.prevent
      >
        <button type="button" class="fork-native-ctx-item git-mm-subrepo-ctx-item" @click="openSubrepoInMain(subrepoCtxMenu.repoPath)">
          <span class="git-mm-subrepo-ctx-title">{{ t('gitMm.subrepoCtxOpenInMain') }}</span>
          <span class="git-mm-subrepo-ctx-hint">{{ t('gitMm.subrepoCtxOpenInMainHint') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.git-mm-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color-page, var(--el-bg-color));
}
.git-mm-titlebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 36px;
  padding: 0 6px 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
.git-mm-titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.git-mm-titlebar-title {
  white-space: nowrap;
}
.git-mm-titlebar-drag {
  flex: 1;
  min-width: 0;
  min-height: 28px;
  align-self: stretch;
}
.git-mm-titlebar-drag-spacer {
  flex: 1;
  min-width: 0;
  min-height: 8px;
}
.git-mm-titlebar-trailing {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  align-self: stretch;
}
.git-mm-theme-wrap {
  display: flex;
  align-items: center;
  padding: 0 10px 0 12px;
  border-left: 1px solid var(--el-border-color-lighter);
}
.git-mm-theme-wrap :deep(.el-switch) {
  --el-switch-on-color: var(--el-color-primary);
  --el-switch-off-color: var(--el-border-color);
}
.git-mm-titlebar-win {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--el-border-color-lighter);
}
.git-mm-win-close:hover {
  color: var(--el-color-danger);
}
.git-mm-app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  overflow: hidden;
  box-sizing: border-box;
}
.git-mm-head {
  flex-shrink: 0;
  margin-bottom: 8px;
}
.git-mm-toolbar {
  gap: 10px;
}
.git-mm-toolbar-actions {
  flex-wrap: wrap;
  min-width: 0;
}
.git-mm-toolbar-hint {
  min-width: 0;
}
.git-mm-toolbar-empty-hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.git-mm-active-path {
  max-width: 100%;
}
.git-mm-toolbar-trailing {
  flex-shrink: 0;
}
.git-mm-sync-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
}
.git-mm-sync-jobs-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.git-mm-sync-jobs-input {
  width: 112px;
}
.git-mm-start-dialog-hint {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
.git-mm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-work-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.git-mm-empty-state {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 24px 16px;
  box-sizing: border-box;
}
.git-mm-empty-state :deep(.el-empty) {
  max-width: min(100%, 560px);
  padding: 0 8px;
  box-sizing: border-box;
}
.git-mm-empty-state :deep(.el-empty__description) {
  max-width: 100%;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
  text-align: center;
}
.git-mm-ws-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-ws-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.git-mm-ws-tab-label {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  cursor: grab;
}
.git-mm-ws-tab-label:active {
  cursor: grabbing;
}
.git-mm-ws-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-ws-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.git-mm-sub-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-sub-tab-label {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  cursor: grab;
}
.git-mm-sub-tab-label:active {
  cursor: grabbing;
}
.git-mm-sub-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.git-mm-sub-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-output-dialog :deep(.el-dialog) {
  max-width: 1120px;
}
.git-mm-output-dialog-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.git-mm-output-dialog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.git-mm-output-dialog-body {
  max-height: min(68vh, 640px);
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  box-sizing: border-box;
}
.git-mm-output-pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.git-mm-run-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.git-mm-run-meta {
  margin: 0;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.git-mm-running-hint,
.git-mm-no-output {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.git-mm-error-lines-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.git-mm-subrepo-ctx-menu {
  min-width: 260px;
}
.git-mm-subrepo-ctx-item {
  padding-top: 10px;
  padding-bottom: 10px;
}
.git-mm-subrepo-ctx-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.git-mm-subrepo-ctx-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}
.mono {
  font-family: ui-monospace, monospace;
}
</style>
