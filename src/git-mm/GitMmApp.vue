<script setup lang="ts">
import { Plus, Refresh, FolderOpened, Document, Minus, FullScreen, Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale } from '../i18n/index.ts'
import {
  APP_SETTINGS_STORAGE_KEY,
  APP_SETTINGS_SYNC_CHANNEL,
  loadAppSettings,
  normalizeAppSettings,
  saveAppSettings
} from '../utils/appSettingsStorage.ts'
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

const STORAGE_KEY = 'gitforklike-mm-workspaces-v1'
const MM_START_STORAGE_KEY = 'gitforklike-mm-start-v1'
const SYNC_JOBS_STORAGE_KEY = 'gitforklike-mm-sync-jobs-v1'
const MM_OUTPUT_EXPANDED_KEY = 'gitforklike-mm-output-expanded'

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
const activeSubPath = ref<Record<string, string>>({})
const initDialog = ref(false)
const startDialog = ref(false)
const syncBusy = ref(false)
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
const initUrl = ref('')
const initManifest = ref('dependency.xml')
const initBranch = ref('master')
const initGroup = ref('default')
/** Start 弹窗中输入，执行 `git mm start <branch>`；上次输入会记住 */
const mmStartBranch = ref('')

const activeWorkspace = computed(() => workspaces.value.find((w) => w.id === activeWsId.value) ?? null)

const subrepos = computed(() => {
  const w = activeWorkspace.value
  if (!w) return []
  return subPathsByWs.value[w.id] ?? []
})

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces.value))
  } catch {
    /* ignore */
  }
}

function persistMmStart() {
  try {
    const p: MmStartPersist = { branch: mmStartBranch.value }
    localStorage.setItem(MM_START_STORAGE_KEY, JSON.stringify(p))
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
    const raw = localStorage.getItem(SYNC_JOBS_STORAGE_KEY)
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
    localStorage.setItem(SYNC_JOBS_STORAGE_KEY, JSON.stringify(clampSyncJobs(syncParallelJobs.value)))
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

function loadMmOutputExpanded(): boolean {
  try {
    return localStorage.getItem(MM_OUTPUT_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

const mmOutputExpanded = ref(loadMmOutputExpanded())

function persistMmOutputExpanded(v: boolean) {
  try {
    localStorage.setItem(MM_OUTPUT_EXPANDED_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function toggleMmOutputExpanded() {
  mmOutputExpanded.value = !mmOutputExpanded.value
  persistMmOutputExpanded(mmOutputExpanded.value)
}

function shortName(full: string) {
  const parts = full.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || full
}

async function addWorkspace() {
  const p = await window.gitClient.selectDirectory()
  if (!p) return
  const id = `mm-ws-${Date.now()}`
  const label = p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || p
  workspaces.value = [...workspaces.value, { id, rootPath: p, label }]
  activeWsId.value = id
  persist()
  await scanSubrepos()
}

function removeWorkspace(id: string) {
  if (syncBusy.value) return
  workspaces.value = workspaces.value.filter((w) => w.id !== id)
  const next = { ...subPathsByWs.value }
  delete next[id]
  subPathsByWs.value = next
  const sp = { ...activeSubPath.value }
  delete sp[id]
  activeSubPath.value = sp
  if (activeWsId.value === id) {
    activeWsId.value = workspaces.value[0]?.id ?? ''
  }
  persist()
}

async function scanSubrepos() {
  const w = activeWorkspace.value
  if (!w) return
  const r = await window.gitMm.listSubrepos(w.rootPath, 4)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  subPathsByWs.value = { ...subPathsByWs.value, [w.id]: r.paths }
  if (r.paths.length && !r.paths.includes(currentSubPath.value)) {
    currentSubPath.value = r.paths[0]!
  }
}

async function runMm(args: string[]) {
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
  const t0 = performance.now()
  const r = await window.gitMm.exec({ cwd, args })
  const ms = Math.round(performance.now() - t0)
  syncBusy.value = false
  mmPendingArgs.value = null
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

  let r: Awaited<ReturnType<typeof window.gitMm.execInteractive>>
  try {
    r = await window.gitMm.execInteractive({ cwd, args })
  } finally {
    un()
  }

  const ms = Math.round(performance.now() - t0)
  syncBusy.value = false
  mmPendingArgs.value = null
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
  if (syncBusy.value || !activeWorkspace.value) return
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
  void scanSubrepos()
})

onMounted(() => {
  window.addEventListener('storage', onAppSettingsStorage)
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
    const startRaw = localStorage.getItem(MM_START_STORAGE_KEY)
    if (startRaw) {
      const p = JSON.parse(startRaw) as MmStartPersist
      if (p && typeof p.branch === 'string') mmStartBranch.value = p.branch
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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
  if (activeWorkspace.value) void scanSubrepos()
  syncParallelJobs.value = loadSyncParallelJobs()
})

onUnmounted(() => {
  window.removeEventListener('storage', onAppSettingsStorage)
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
    <header class="git-mm-head">
      <p class="git-mm-lead">{{ t('gitMm.lead') }}</p>
      <p class="git-mm-timeout-hint">{{ t('gitMm.mmTimeoutHint') }}</p>
      <div class="git-mm-toolbar">
        <el-button type="primary" size="small" :disabled="syncBusy" @click="addWorkspace">
          <el-icon class="el-icon--left"><Plus /></el-icon>
          {{ t('gitMm.addWorkspace') }}
        </el-button>
        <el-button size="small" :disabled="syncBusy || !activeWorkspace" @click="openWorkspaceFolder">
          <el-icon class="el-icon--left"><FolderOpened /></el-icon>
          {{ t('gitMm.openFolder') }}
        </el-button>
        <el-button size="small" :disabled="syncBusy || !activeWorkspace" @click="initDialog = true">
          {{ t('gitMm.initMm') }}
        </el-button>
        <div class="git-mm-sync-row" :title="t('gitMm.syncParallelHint')">
          <el-button
            size="small"
            type="primary"
            plain
            :loading="syncBusy"
            :disabled="!activeWorkspace"
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
            :disabled="syncBusy"
            controls-position="right"
            class="git-mm-sync-jobs-input"
          />
        </div>
        <el-button
          size="small"
          type="success"
          plain
          :loading="syncBusy"
          :disabled="syncBusy || !activeWorkspace"
          @click="openStartDialog"
        >
          {{ t('gitMm.startMm') }}
        </el-button>
        <el-button
          size="small"
          type="warning"
          plain
          :loading="syncBusy"
          :disabled="syncBusy || !activeWorkspace"
          :title="t('gitMm.uploadHint')"
          @click="runUpload"
        >
          {{ t('gitMm.upload') }}
        </el-button>
        <el-button size="small" :disabled="syncBusy || !activeWorkspace" @click="scanSubrepos">
          <el-icon class="el-icon--left"><Refresh /></el-icon>
          {{ t('gitMm.refreshChildren') }}
        </el-button>
      </div>
    </header>

    <div class="git-mm-body">
      <div
        class="git-mm-work-area"
        v-loading.lock="syncBusy"
        :element-loading-text="t('gitMm.mmBlockingWork')"
      >
      <template v-if="workspaces.length">
        <el-tabs
          v-model="activeWsId"
          type="card"
          class="git-mm-ws-tabs"
          :closable="!syncBusy"
          @tab-remove="(name: string) => removeWorkspace(name)"
        >
          <el-tab-pane v-for="w in workspaces" :key="w.id" :label="w.label" :name="w.id">
            <div class="git-mm-ws-pane">
              <div class="git-mm-ws-path mono" :title="w.rootPath">{{ w.rootPath }}</div>
              <template v-if="subrepos.length">
                <el-tabs v-model="currentSubPath" type="border-card" class="git-mm-sub-tabs">
                  <el-tab-pane
                    v-for="p in subrepos"
                    :key="p"
                    :label="shortName(p)"
                    :name="p"
                  >
                    <MmSubRepoPanel v-if="currentSubPath === p" :repo-path="p" />
                  </el-tab-pane>
                </el-tabs>
              </template>
              <el-empty v-else :description="t('gitMm.noSubrepos')" />
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
      <el-empty v-else :description="t('gitMm.emptyWorkspaces')" />
      </div>

      <div v-if="syncBusy || mmLastRun" class="git-mm-output-dock">
        <button
          v-show="!mmOutputExpanded"
          type="button"
          class="git-mm-output-bar"
          @click="toggleMmOutputExpanded"
        >
          <span class="git-mm-output-bar-title mono">{{ mmOutputCollapseTitle }}</span>
          <el-tag v-if="syncBusy" size="small" type="warning" effect="plain">{{ t('common.loading') }}</el-tag>
          <span class="git-mm-output-bar-action">{{ t('gitMm.mmOutputExpand') }}</span>
        </button>
        <div v-show="mmOutputExpanded" class="git-mm-output-expanded">
          <div class="git-mm-output-expanded-head">
            <span class="git-mm-output-expanded-title mono">{{ mmOutputCollapseTitle }}</span>
            <el-button size="small" text type="primary" @click="toggleMmOutputExpanded">
              {{ t('gitMm.mmOutputCollapse') }}
            </el-button>
          </div>
          <div v-if="syncBusy && mmPendingArgs" class="git-mm-run-block">
            <pre class="git-mm-output-pre mono">{{ formatMmCmd(mmPendingArgs) }}</pre>
            <p class="git-mm-run-meta mono">{{ activeWorkspace?.rootPath }}</p>
            <p class="git-mm-running-hint">{{ t('gitMm.mmRunningHint') }}</p>
          </div>
          <div v-else-if="mmLastRun?.kind === 'spawn_error'" class="git-mm-run-block">
            <pre class="git-mm-output-pre mono">{{ mmLastRun.message }}</pre>
            <p class="git-mm-run-meta mono">{{ mmLastRun.cwd }}</p>
          </div>
          <div v-else-if="mmLastRun?.kind === 'finished'" class="git-mm-run-block">
            <p class="git-mm-run-meta mono">{{ mmLastRun.cmd }}</p>
            <p class="git-mm-run-meta mono">{{ mmLastRun.cwd }}</p>
            <p v-if="mmLastRun.code !== 0" class="git-mm-error-lines-hint">{{ t('gitMm.mmErrorLinesHint') }}</p>
            <p v-if="!mmStreamText" class="git-mm-no-output">{{ t('gitMm.mmNoOutput') }}</p>
            <pre v-else class="git-mm-output-pre mono">{{ mmStreamText }}</pre>
          </div>
        </div>
      </div>
    </div>

    </div>

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
  </div>
</template>

<style scoped>
.git-mm-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color-page);
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
  padding: 12px 14px;
  overflow: hidden;
  box-sizing: border-box;
}
.git-mm-head {
  flex-shrink: 0;
  margin-bottom: 10px;
}
.git-mm-lead {
  margin: 6px 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
.git-mm-timeout-hint {
  margin: -4px 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}
.git-mm-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
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
.git-mm-ws-tabs :deep(.el-tab-pane) {
  height: 100%;
}
.git-mm-ws-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.git-mm-ws-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-mm-sub-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.git-mm-sub-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.git-mm-sub-tabs :deep(.el-tab-pane) {
  height: 100%;
}
.git-mm-output-dock {
  flex-shrink: 0;
  margin-top: 6px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
  border-radius: 0 0 6px 6px;
}
.git-mm-output-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  margin: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--el-text-color-primary);
  box-sizing: border-box;
}
.git-mm-output-bar:hover {
  background: var(--el-fill-color-light);
}
.git-mm-output-bar-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-mm-output-bar-action {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-color-primary);
}
.git-mm-output-expanded {
  padding: 0 12px 10px;
  max-height: min(38vh, 360px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.git-mm-output-expanded-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  position: sticky;
  top: 0;
  background: var(--el-fill-color-blank);
  z-index: 1;
}
.git-mm-output-expanded-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.git-mm-output-pre {
  margin: 0;
  max-height: min(32vh, 280px);
  overflow: auto;
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
.mono {
  font-family: ui-monospace, monospace;
}
</style>
