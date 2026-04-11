import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import {
  Check,
  Clock,
  Close,
  Download,
  EditPen,
  FolderOpened,
  FullScreen,
  Minus,
  Plus,
  RefreshRight,
  Search,
  Upload
} from '@element-plus/icons-vue'
import type {
  CommitDetail,
  GitErr,
  GitLogPayload,
  GitStatusPlain,
  GitgraphImportRow,
  LogEntry,
  PullOpts,
  PushOpts
} from '../types/git-client'
import {
  clearPersistedWorkspace,
  loadPersistedWorkspace,
  savePersistedWorkspace,
  type PersistedWorkspaceV1
} from '../utils/workspaceStorage.ts'
import {
  APP_SETTINGS_STORAGE_KEY,
  APP_SETTINGS_SYNC_CHANNEL,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  normalizeAppSettings,
  saveAppSettings,
  type PersistedAppSettingsV1
} from '../utils/appSettingsStorage.ts'
import { buildHostingCompareUrl } from '../utils/hostingUrls.ts'
import { applyAppTheme, onThemeEffectiveChange } from '../utils/appTheme.ts'
import { deriveCloneFolderFromUrl, joinCloneTargetPath } from '../utils/clonePathUtils.ts'
import { computeStashSidebarAfterRemove } from '../utils/stashSidebarSelection.ts'
import {
  REPO_WORKSPACE_SYNC_CHANNEL,
  type RepoWorkspaceSyncPayload
} from '../constants/repoWorkspaceSync.ts'
import { broadcastRepoWorkspaceChanged } from '../utils/repoWorkspaceBroadcast.ts'
import { extractRecentCommitMessages } from '../utils/recentCommitMessages.ts'
import { html as diff2htmlHtml } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { isBinaryDiffOutput } from '../utils/binaryDiffDetect.ts'
import { extractPartialLinePatchForLineRange } from '../utils/diffLineRangePatch.ts'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { i18n, setAppLocale } from '../i18n/index.ts'

function tr(key: string, params?: Record<string, unknown>): string {
  return String(i18n.global.t(key, (params ?? {}) as Record<string, unknown>))
}

/** 行级补丁：先紧后松——默认 0 上下文只暂存选区（及成对 -/+）；仅在 apply 失败时再加大上下文 */
const LINE_PATCH_CONTEXT_TRY_ORDER = [0, 1, 2, 3, 4, 5, 7] as const

/**
 * 分层尝试 apply：先严格匹配（不传 -b），避免模糊匹配把补丁套到别处，造成「已暂存但未暂存区仍显示同一段」。
 * 失败后再 `recount`（我们手写的 @@ 计数偶发偏差），最后才 `ignore-space-change`。
 */
const PATCH_APPLY_STRATEGIES: readonly { recount?: boolean; ignoreSpaceChange?: boolean }[] = [
  {},
  { recount: true },
  { recount: true, ignoreSpaceChange: true }
]

type MainView = 'changes' | 'history'

type RepoTab = { id: string; path: string; title: string; selectedRemote?: string }

/** 侧栏单击分支/tag/远程分支/贮藏 与提交图选中联动（全局仅一项） */
export type SidebarRefSelection =
  | { kind: 'branch'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'remoteBranch'; remote: string; branch: string }
  | { kind: 'stash'; index: number }

const repoTabs = ref<RepoTab[]>([])
/** 路径 → 显示名；与是否打开标签无关，用于「关掉标签后再打开」仍显示重命名 */
const repoDisplayNames = ref<Record<string, string>>({})
const activeTabId = ref<string | null>(null)
const repoPath = ref<string | null>(null)
const status = ref<GitStatusPlain | null>(null)
const loadError = ref<string | null>(null)
const branches = ref<string[]>([])
const currentBranch = ref('')
/** 本地分支相对上游的领先/落后（`git for-each-ref`） */
const localBranchTracking = ref<Map<string, { ahead: number; behind: number; upstream: string | null }>>(
  new Map()
)
const commitSubject = ref('')
const commitDescription = ref('')
const commitAmend = ref(false)
const commitBusy = ref(false)
/** 勾选「修订上次提交」时，HEAD 提交详情（用于暂存区列表与说明） */
const amendHeadDetail = ref<CommitDetail | null>(null)
const commitFieldsBeforeAmend = ref<{ subject: string; description: string } | null>(null)
let amendLoadSeq = 0
const history = ref<LogEntry[]>([])
const historyGitgraph = ref<GitgraphImportRow[]>([])
/** 提交搜索等临时覆盖提交图数据（为 null 时用全量 log） */
const historyGraphOverride = ref<GitLogPayload | null>(null)
const historySearchLoading = ref(false)
const recentCommitMessages = computed(() => extractRecentCommitMessages(history.value, historyGitgraph.value))
/** 设置中的「提交图单次加载条数」；启动后由 applyAppSettings 同步 */
const persistedHistoryMaxCommits = ref(DEFAULT_APP_SETTINGS.historyMaxCommits)
/** 本次会话内「加载更多」累加条数（刷新全部等不重置，换仓库会清零） */
const historyLogExtra = ref(0)
const selectedPath = ref<string | null>(null)
const selectedDiffScope = ref<'unstaged' | 'staged'>('unstaged')
const diffText = ref('')
/** 由 diff 原始输出判定为二进制时置 true，避免把乱码塞进 diff 文本 / HTML */
const diffLooksBinary = ref(false)
const diffLoading = ref(false)
const diffOutputFormat = ref<'side-by-side' | 'line-by-line'>('side-by-side')
const diffIgnoreBlankLines = ref(false)
const diffIgnoreWhitespace = ref(false)
const diffContextLines = ref(3)
const diffShowFullFile = ref(false)
const lastContextLines = ref(3)
const activeView = ref<MainView>('changes')
const remotes = ref<string[]>([])
const remoteDetails = ref<{ name: string; fetchUrl: string; pushUrl: string }[]>([])
/** 侧栏远程下列出的分支名（不含 remote/ 前缀），按远程名缓存 */
const remoteSidebarBranches = ref<Record<string, string[]>>({})
const remoteSidebarExpanded = reactive<Record<string, boolean>>({})
const remoteSidebarLoadingBranchList = reactive<Record<string, boolean>>({})
const gitTags = ref<string[]>([])
const stashEntries = ref<{ index: number; label: string }[]>([])
const submoduleItems = ref<{ path: string; sha: string; ref?: string }[]>([])
/** 空字符串表示使用 Git 默认远程/上游 */
const selectedRemote = ref('')
const syncBusy = ref<'fetch' | 'pull' | 'push' | null>(null)
const stashBusy = ref(false)

const fetchDialogOpen = ref(false)
const pullDialogOpen = ref(false)
const pushDialogOpen = ref(false)
const stashDialogOpen = ref(false)
const compareDialogOpen = ref(false)
/** 打开比对对话框时预填（由「与 HEAD 比对」等设置） */
const comparePresetFrom = ref('')
const comparePresetTo = ref('')
const rebaseInteractiveStartDialogOpen = ref(false)
const pushDeleteBranchDialogOpen = ref(false)
const reflogDialogOpen = ref(false)
const worktreeDialogOpen = ref(false)
const bisectDialogOpen = ref(false)
const rebaseTodoDialogOpen = ref(false)
const blameDialogOpen = ref(false)
const fileHistoryDialogOpen = ref(false)
const remotePruneDialogOpen = ref(false)
const lfsToolsDialogOpen = ref(false)
const settingsDialogOpen = ref(false)
const stashDetailDialogOpen = ref(false)
/** 与 document.documentElement 是否含 `dark` 同步，供顶栏开关展示 */
const headerAppearanceDark = ref(false)
let themeEffectiveUnsub: (() => void) | null = null
const cloneDialogOpen = ref(false)
const cloneUrlInput = ref('')
const cloneParentDir = ref('')
const cloneFolderName = ref('')
const tagDeleteDialogOpen = ref(false)
const tagDeleteTagName = ref('')
const tagDeleteAlsoRemote = ref(false)
const tagDeleteRemotePick = ref('')
const sidebarSearch = ref('')
/** 变更页左侧文件树筛选（未暂存 + 已暂存） */
const changeFileTreeSearch = ref('')
const selectedHistoryHash = ref<string | null>(null)
const selectedSidebarRef = ref<SidebarRefSelection | null>(null)
const commitDetail = ref<CommitDetail | null>(null)
const commitDetailLoading = ref(false)
const detailTab = ref<'commit' | 'changes' | 'files'>('commit')
const historyCommitDiffText = ref('')
const historyCommitDiffLoading = ref(false)
/** 提交「变更」页：左侧文件树筛选与当前选中文件（与 commitDetail.files[].path 一致） */
const historyChangeFileSearch = ref('')
const selectedCommitDiffPath = ref<string | null>(null)
/** 「提交」标签页：折叠面板当前展开的文件路径（accordion 下单个 name） */
const commitOverviewCollapseName = ref<string | number>('')

const api = window.gitClient

/** 网络/远程类错误仅弹 Message，不占用 App 顶部 loadError 提示条 */
function isLikelyNetworkOrRemoteError(msg: string): boolean {
  const m = String(msg).toLowerCase()
  return (
    m.includes('unable to access') ||
    m.includes('could not connect') ||
    m.includes('failed to connect') ||
    m.includes('connection timed out') ||
    m.includes('could not resolve host') ||
    m.includes('network is unreachable') ||
    m.includes('connection refused') ||
    m.includes('timed out') ||
    m.includes('tls') ||
    m.includes('ssl')
  )
}

const GLOBAL_GIT_LOADING_WINDOW_CLASS = 'fork-git-loading-active'
let globalGitLoadingWindowDepth = 0

function beginGlobalGitLoadingWindowControls() {
  if (typeof document === 'undefined') return
  globalGitLoadingWindowDepth += 1
  if (globalGitLoadingWindowDepth === 1) {
    document.body.classList.add(GLOBAL_GIT_LOADING_WINDOW_CLASS)
  }
}

function endGlobalGitLoadingWindowControls() {
  if (typeof document === 'undefined') return
  globalGitLoadingWindowDepth = Math.max(0, globalGitLoadingWindowDepth - 1)
  if (globalGitLoadingWindowDepth === 0) {
    document.body.classList.remove(GLOBAL_GIT_LOADING_WINDOW_CLASS)
  }
}

function runWithGitLoading<T>(text: string, fn: () => Promise<T>): Promise<T> {
  beginGlobalGitLoadingWindowControls()
  const loading = ElLoading.service({
    lock: true,
    text,
    background: 'rgba(0, 0, 0, 0.22)'
  })
  return fn().finally(() => {
    loading.close()
    endGlobalGitLoadingWindowControls()
  })
}

/**
 * 侧栏 `SidebarCreateDialogs` 在 `onMounted` 中注册具体实现。
 * 分组标题「右击新建」直接调用，避免 el-dropdown(contextmenu) + inject 在部分环境下不触发。
 */
export type ForkRemoteRow = { name: string; fetchUrl: string; pushUrl: string }

export const forkCreateDialogFns = {
  openNewBranch: () => {},
  openAddRemote: () => {},
  openEditRemote: (_rm: ForkRemoteRow) => {},
  openCreateTag: () => {},
  openAddSubmodule: () => {}
} as {
  openNewBranch: () => void
  openAddRemote: () => void
  openEditRemote: (rm: ForkRemoteRow) => void
  openCreateTag: () => void
  openAddSubmodule: () => void
}

export function registerForkCreateDialogs(fns: {
  openNewBranch: () => void
  openAddRemote: () => void
  openEditRemote: (rm: ForkRemoteRow) => void
  openCreateTag: () => void
  openAddSubmodule: () => void
}) {
  forkCreateDialogFns.openNewBranch = fns.openNewBranch
  forkCreateDialogFns.openAddRemote = fns.openAddRemote
  forkCreateDialogFns.openEditRemote = fns.openEditRemote
  forkCreateDialogFns.openCreateTag = fns.openCreateTag
  forkCreateDialogFns.openAddSubmodule = fns.openAddSubmodule
}

function shortSha(s: string): string {
  const t = s.replace(/^[+-]/, '')
  if (/^[0-9a-f]+$/i.test(t) && t.length > 7) return t.slice(0, 7)
  return s
}

function newTabId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function basenameRepo(p: string): string {
  const x = p.replace(/[/\\]+$/, '')
  const i = Math.max(x.lastIndexOf('/'), x.lastIndexOf('\\'))
  return i < 0 ? x : x.slice(i + 1)
}

function normRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** `stash drop` / `stash pop` 后栈索引整体前移，同步侧栏选中项 */
function adjustSidebarStashSelectionAfterRemove(removedIndex: number) {
  const r = computeStashSidebarAfterRemove(selectedSidebarRef.value, removedIndex)
  if (r.type === 'noop') return
  if (r.type === 'clear-linked-detail') {
    selectedSidebarRef.value = null
    selectedHistoryHash.value = null
    commitDetail.value = null
    return
  }
  selectedSidebarRef.value = r.selection
}

/** 当前仓库的远程列表变化后，清除各「仓库标签」上已不存在的 selectedRemote，避免删远程后切回标签仍带旧名 */
function syncTabSelectedRemotesWithCurrentRepoRemotes() {
  const cur = repoPath.value
  if (!cur) return
  const norm = normRepoPath(cur)
  const names = new Set(remotes.value)
  for (const t of repoTabs.value) {
    if (normRepoPath(t.path) !== norm) continue
    const sr = t.selectedRemote?.trim()
    if (sr && !names.has(sr)) {
      t.selectedRemote = ''
    }
  }
  const sel = selectedRemote.value.trim()
  if (sel && !names.has(sel)) {
    selectedRemote.value = ''
  }
}

function resetWorkspaceState() {
  loadError.value = null
  status.value = null
  history.value = []
  historyGitgraph.value = []
  historyGraphOverride.value = null
  historyLogExtra.value = 0
  branches.value = []
  currentBranch.value = ''
  localBranchTracking.value = new Map()
  remotes.value = []
  selectedRemote.value = ''
  remoteDetails.value = []
  remoteSidebarBranches.value = {}
  for (const k of Object.keys(remoteSidebarExpanded)) delete remoteSidebarExpanded[k]
  for (const k of Object.keys(remoteSidebarLoadingBranchList)) delete remoteSidebarLoadingBranchList[k]
  gitTags.value = []
  stashEntries.value = []
  submoduleItems.value = []
  commitSubject.value = ''
  commitDescription.value = ''
  commitFieldsBeforeAmend.value = null
  amendHeadDetail.value = null
  commitAmend.value = false
  selectedPath.value = null
  unstagedSelectedPaths.value = []
  stagedSelectedPaths.value = []
  unstagedRangeAnchorPath.value = null
  stagedRangeAnchorPath.value = null
  diffText.value = ''
  diffLooksBinary.value = false
  selectedHistoryHash.value = null
  selectedSidebarRef.value = null
  commitDetail.value = null
  historyCommitDiffText.value = ''
  historyChangeFileSearch.value = ''
  historySnapshotTreeSearch.value = ''
  selectedCommitDiffPath.value = null
  commitOverviewCollapseName.value = ''
  sidebarSearch.value = ''
  changeFileTreeSearch.value = ''
  activeView.value = 'changes'
  detailTab.value = 'commit'
}

async function switchRepoToTab(tab: RepoTab, opts?: { skipLoading?: boolean }): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const set = await api.setRepo(tab.path)
    if (!set.ok) {
      loadError.value = set.error
      return false
    }
    activeTabId.value = tab.id
    repoPath.value = tab.path
    selectedRemote.value = tab.selectedRemote ?? ''
    clearHistoryCommitDetail()
    loadError.value = null
    persistWorkspaceNow()
    await refreshAll()
    applySelectedRemoteForCurrentRepo(tab.selectedRemote)
    return true
  }
  if (opts?.skipLoading) return run()
  return runWithGitLoading(
    tr('ws.loadingOpenRepo', { name: (tab.title && String(tab.title).trim()) || basenameRepo(tab.path) }),
    run
  )
}

async function activateTab(id: string, opts?: { skipLoading?: boolean }) {
  const tab = repoTabs.value.find((t) => t.id === id)
  if (!tab) return
  if (id === activeTabId.value && repoPath.value === tab.path) return
  await switchRepoToTab(tab, opts)
}

/** el-tabs 在切换前调用：setRepo 失败时阻止切换，避免界面与主进程仓库不一致 */
async function beforeRepoTabLeave(newName: string | number, _oldName: string | number) {
  const id = String(newName)
  const tab = repoTabs.value.find((t) => t.id === id)
  if (!tab) return false
  if (id === activeTabId.value && repoPath.value === tab.path) return true
  return switchRepoToTab(tab)
}

const activeTabModel = computed({
  get: () => activeTabId.value ?? '',
  set: (v: string) => {
    activeTabId.value = v || null
  }
})

async function onTabRemove(name: string | number) {
  const id = String(name)
  const i = repoTabs.value.findIndex((t) => t.id === id)
  if (i === -1) return
  const wasActive = activeTabId.value === id
  repoTabs.value.splice(i, 1)
  if (!wasActive) {
    persistWorkspaceNow()
    return
  }
  if (repoTabs.value.length) {
    const next = repoTabs.value[Math.min(i, repoTabs.value.length - 1)]!
    await activateTab(next.id)
  } else {
    activeTabId.value = null
    repoPath.value = null
    resetWorkspaceState()
    await api.clearRepo()
    persistWorkspaceNow()
  }
}

const filteredBranches = computed(() => {
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return branches.value
  return branches.value.filter((b) => b.toLowerCase().includes(q))
})

/** 与 `filteredBranches` 共用 `sidebarSearch`：匹配分支名、`remote/branch` 全名，或远程名（命中则显示该远程下全部分支） */
const filteredRemoteSidebarBranches = computed((): Record<string, string[]> => {
  const raw = remoteSidebarBranches.value
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return { ...raw }
  const out: Record<string, string[]> = {}
  for (const [remote, branchList] of Object.entries(raw)) {
    const rLower = remote.toLowerCase()
    if (rLower.includes(q)) {
      out[remote] = [...branchList]
      continue
    }
    out[remote] = branchList.filter((br) => {
      const bLower = br.toLowerCase()
      return bLower.includes(q) || `${remote}/${br}`.toLowerCase().includes(q)
    })
  }
  return out
})

const remoteDetailsFiltered = computed(() => {
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return remoteDetails.value
  const fr = filteredRemoteSidebarBranches.value
  return remoteDetails.value.filter((rm) => (fr[rm.name]?.length ?? 0) > 0)
})

const filteredGitTags = computed(() => {
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return gitTags.value
  return gitTags.value.filter((t) => t.toLowerCase().includes(q))
})

const filteredStashEntries = computed(() => {
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return stashEntries.value
  return stashEntries.value.filter((st) => {
    const label = st.label.toLowerCase()
    const ix = String(st.index)
    return label.includes(q) || ix.includes(q) || `#${ix}`.includes(q)
  })
})

const filteredSubmoduleItems = computed(() => {
  const q = sidebarSearch.value.trim().toLowerCase()
  if (!q) return submoduleItems.value
  return submoduleItems.value.filter((sm) => {
    const path = sm.path.toLowerCase()
    const sha = sm.sha.toLowerCase()
    const ref = (sm.ref ?? '').toLowerCase()
    return path.includes(q) || sha.includes(q) || ref.includes(q)
  })
})

const repoTitle = computed(() => {
  const id = activeTabId.value
  if (id) {
    const tab = repoTabs.value.find((t) => t.id === id)
    if (tab?.title) return tab.title
  }
  if (!repoPath.value) return 'git-gui'
  const p = repoPath.value.replace(/[/\\]+$/, '')
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
})

function buildWorkspaceSnapshot(): PersistedWorkspaceV1 {
  return {
    v: 1,
    repoTabs: repoTabs.value.map((t) => ({ ...t })),
    activeTabId: activeTabId.value,
    activeView: activeView.value,
    repoDisplayNames: { ...repoDisplayNames.value }
  }
}

/** 立即写入本地存储（避免仅依赖防抖导致关闭过快时未保存） */
function persistWorkspaceNow() {
  savePersistedWorkspace(buildWorkspaceSnapshot())
}

/** 重命名当前工程标签显示名称（仅界面与持久化，不修改磁盘路径） */
function renameActiveRepoTab(newTitle: string) {
  const id = activeTabId.value
  if (!id) return
  const tab = repoTabs.value.find((t) => t.id === id)
  if (!tab) return
  const t = newTitle.trim()
  tab.title = t || basenameRepo(tab.path)
  repoDisplayNames.value[normRepoPath(tab.path)] = tab.title
  persistWorkspaceNow()
}

const canControlWindow = computed(
  () => typeof window !== 'undefined' && typeof window.electronWindow !== 'undefined'
)

function winMinimize() {
  void window.electronWindow?.minimize()
}

function winMaximize() {
  void window.electronWindow?.maximize()
}

function winClose() {
  void window.electronWindow?.close()
}

/** 顶栏菜单命令（文件 / 编辑 / 视图 / 仓库 / 窗口 / 帮助） */
function onMenuCommand(cmd: string) {
  switch (cmd) {
    case 'file:open':
      void openRepo()
      break
    case 'file:clone':
      openCloneDialog()
      break
    case 'file:refresh':
      void refreshAll()
      break
    case 'file:exit':
      winClose()
      break
    case 'edit:refresh':
      void refreshAll()
      break
    case 'edit:settings':
      openSettingsDialog()
      break
    case 'view:changes':
      activeView.value = 'changes'
      break
    case 'view:history':
      activeView.value = 'history'
      break
    case 'repo:fetch':
      openFetchSyncDialog()
      break
    case 'repo:pull':
      openPullSyncDialog()
      break
    case 'repo:push':
      openPushSyncDialog()
      break
    case 'repo:rebase-interactive-hint':
      void openInteractiveRebaseHint()
      break
    case 'repo:compare':
      openCompareDialog()
      break
    case 'repo:reflog':
      openReflogDialog()
      break
    case 'repo:worktree':
      openWorktreeDialog()
      break
    case 'repo:bisect':
      openBisectDialog()
      break
    case 'repo:rebase-todo':
      openRebaseTodoDialog()
      break
    case 'repo:remote-prune':
      openRemotePruneDialog()
      break
    case 'repo:add-partial-hint':
      void openAddPartialStashHint()
      break
    case 'repo:blame':
      openBlameDialog()
      break
    case 'repo:file-history':
      openFileHistoryDialog()
      break
    case 'repo:apply-patch':
      void applyPatchFromFile()
      break
    case 'repo:rebase-interactive-start':
      openRebaseInteractiveStartDialog()
      break
    case 'repo:push-delete':
      openPushDeleteBranchDialog()
      break
    case 'repo:lfs-install':
      void runLfsInstall()
      break
    case 'repo:lfs-pull':
      void runLfsPull()
      break
    case 'repo:lfs-tools':
      openLfsToolsDialog()
      break
    case 'repo:hosting-compare':
      void openHostingCompareInBrowser()
      break
    case 'repo:stash-detail':
      openStashDetailDialog()
      break
    case 'repo:stash-push-patch':
      void openPartialStashPushInTerminal()
      break
    case 'win:min':
      winMinimize()
      break
    case 'win:max':
      winMaximize()
      break
    case 'win:close':
      winClose()
      break
    case 'help:about':
      ElMessage.info(tr('ws.about'))
      break
    default:
      break
  }
}

function formatDiff(d: string | { error: string }): string {
  return typeof d === 'string' ? d || EMPTY_DIFF_SENTINEL : d.error
}

/** 整文件 diff 行数多，并列（side-by-side）会占满左右两栏；整文件模式下固定用单列便于阅读 */
function diff2htmlOutputFormatForView(): 'side-by-side' | 'line-by-line' {
  return diffShowFullFile.value ? 'line-by-line' : diffOutputFormat.value
}

const diffHtml = computed(() => {
  const t = diffText.value
  if (!selectedPath.value || !t.trim() || t === EMPTY_DIFF_SENTINEL) return ''
  try {
    const out = diff2htmlHtml(t, {
      outputFormat: diff2htmlOutputFormatForView(),
      drawFileList: false,
      matching: 'lines',
      colorScheme: headerAppearanceDark.value ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
    })
    return out?.trim() ? out : ''
  } catch {
    return ''
  }
})

/** 历史「提交 / 变更 / 文件树」中的 diff：与变更视图相同，随 diffOutputFormat 切换并列/单列 */
const historyCommitDiffHtml = computed(() => {
  const t = historyCommitDiffText.value
  if (!selectedHistoryHash.value || !t.trim() || t === EMPTY_DIFF_SENTINEL) return ''
  try {
    const out = diff2htmlHtml(t, {
      outputFormat: diff2htmlOutputFormatForView(),
      drawFileList: false,
      matching: 'lines',
      colorScheme: headerAppearanceDark.value ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
    })
    return out?.trim() ? out : ''
  } catch {
    return ''
  }
})

const diffOptions = computed(() => ({
  contextLines: diffContextLines.value,
  ignoreBlankLines: diffIgnoreBlankLines.value,
  ignoreWhitespace: diffIgnoreWhitespace.value,
  showFullFile: diffShowFullFile.value
}))

function toggleDiffFormat() {
  diffOutputFormat.value = diffOutputFormat.value === 'side-by-side' ? 'line-by-line' : 'side-by-side'
}

function toggleIgnoreBlankLines() {
  diffIgnoreBlankLines.value = !diffIgnoreBlankLines.value
}

function toggleIgnoreWhitespace() {
  diffIgnoreWhitespace.value = !diffIgnoreWhitespace.value
}

function decContextLines() {
  if (diffShowFullFile.value) return
  diffContextLines.value = Math.max(0, diffContextLines.value - 1)
}

function incContextLines() {
  if (diffShowFullFile.value) return
  diffContextLines.value = Math.min(50, diffContextLines.value + 1)
}

function toggleShowFullFile() {
  diffShowFullFile.value = !diffShowFullFile.value
  if (diffShowFullFile.value) {
    lastContextLines.value = diffContextLines.value
  } else {
    diffContextLines.value = lastContextLines.value
  }
}

async function refreshRoot() {
  repoPath.value = await api.getRoot()
}

async function loadBranches() {
  const r = await api.branches()
  if ('error' in r) return
  branches.value = r.all
  currentBranch.value = r.current
  const tr = await api.localBranchesTracking()
  if (!('error' in tr)) {
    localBranchTracking.value = new Map(
      tr.branches.map((b) => [b.name, { ahead: b.ahead, behind: b.behind, upstream: b.upstream }])
    )
  }
}

async function loadStatus() {
  loadError.value = null
  const r = await api.status()
  if ('error' in r) {
    if (isLikelyNetworkOrRemoteError(r.error)) {
      ElMessage.error(r.error)
    } else {
      loadError.value = r.error
    }
    status.value = null
    return
  }
  status.value = r
  await loadBranches()
}

function getHistoryLogLimit(): number {
  return Math.min(100_000, Math.max(500, persistedHistoryMaxCommits.value) + historyLogExtra.value)
}

const historyTotalLogLimit = computed(() => getHistoryLogLimit())

async function loadHistory() {
  const r = await api.log(getHistoryLogLimit())
  if ('error' in r) {
    history.value = []
    historyGitgraph.value = []
    return
  }
  history.value = r.entries
  historyGitgraph.value = r.gitgraph
}

const displayHistoryGitgraph = computed(
  () => historyGraphOverride.value?.gitgraph ?? historyGitgraph.value
)

const historySearchActive = computed(() => historyGraphOverride.value != null)

async function runHistoryLogSearch(opts: {
  grep?: string
  pickaxe?: string
  regexp?: boolean
  allMatch?: boolean
  ignoreCase?: boolean
}) {
  const grep = opts.grep?.trim()
  const pickaxe = opts.pickaxe?.trim()
  if (!grep && !pickaxe) {
    ElMessage.warning(tr('ws.historySearchNeedGrepOrPickaxe'))
    return
  }
  if (!repoPath.value) return
  historySearchLoading.value = true
  const r = await api.logSearch({
    grep,
    pickaxe,
    regexp: opts.regexp,
    allMatch: opts.allMatch,
    ignoreCase: opts.ignoreCase
  })
  historySearchLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  historyGraphOverride.value = { entries: r.entries, gitgraph: r.gitgraph }
}

function clearHistoryLogSearch() {
  historyGraphOverride.value = null
}

async function loadMoreHistoryCommits() {
  if (!repoPath.value) return
  const base = Math.max(500, persistedHistoryMaxCommits.value)
  if (base + historyLogExtra.value >= 100_000) {
    ElMessage.info(tr('ws.historyMax100k'))
    return
  }
  const step = Math.min(8000, Math.max(1500, Math.floor(base / 2)))
  historyLogExtra.value += step
  await loadHistory()
  ElMessage.success(tr('ws.historyLimitApprox', { n: getHistoryLogLimit() }))
}

function openStashDetailDialog() {
  if (!repoPath.value) return
  stashDetailDialogOpen.value = true
}

async function openPartialStashPushInTerminal() {
  if (!repoPath.value) return
  const rel = (selectedPath.value ?? '').trim().replace(/\\/g, '/')
  const cmd = rel ? `git stash push -p -- ${shellSingleQuoteForBash(rel)}` : 'git stash push -p'
  try {
    await ElMessageBox.confirm(tr('ws.stashPatchConfirm', { cmd }), tr('ws.stashPatchTitle'), {
      type: 'info',
      confirmButtonText: tr('common.openTerminal'),
      cancelButtonText: tr('common.close')
    })
  } catch {
    return
  }
  const r = await api.openRepoRootInGitTerminalWithCommand(cmd, terminalShellPayload())
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.terminalOpened'))
}

async function applyPatchFromFile() {
  if (!repoPath.value) return
  const picked = await api.selectPatchFile({ title: tr('ws.applyPatchPickTitle') })
  if (!picked) return
  if ('error' in picked) {
    ElMessage.error(picked.error)
    return
  }
  await runWithGitLoading(tr('ws.loadingApplyPatch'), async () => {
    const r = await api.applyPatch(picked.text, { cached: false, reverse: false })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.applyPatchDone'))
    await refreshAll()
    if (repoPath.value) broadcastRepoWorkspaceChanged(repoPath.value, 'apply-patch', 'main')
  })
}

async function openHostingCompareInBrowser() {
  if (!repoPath.value) return
  const remote = resolvePreferredRemoteName(selectedRemote.value)
  if (!remote) {
    ElMessage.warning(tr('ws.remoteUrlMissing'))
    return
  }
  const row = remoteDetails.value.find((r) => r.name === remote)
  const fetchUrl = row?.fetchUrl || row?.pushUrl
  if (!fetchUrl?.trim()) {
    ElMessage.warning(tr('ws.remoteUrlMissing'))
    return
  }
  const br = await api.remoteDefaultBranch(remote)
  const base = !('error' in br) && br.branch ? br.branch : 'main'
  const head = currentBranch.value.trim()
  if (!head || status.value?.detached) {
    ElMessage.warning(tr('ws.needBranchForCompare'))
    return
  }
  const compareUrl = buildHostingCompareUrl(fetchUrl, base, head)
  if (!compareUrl) {
    ElMessage.warning(tr('ws.hostingUnknownRemote'))
    return
  }
  const r = await api.openExternalUrl(compareUrl)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.browserCompareOpened'))
}

async function loadRemotes() {
  const r = await api.remotes()
  if ('error' in r) {
    remotes.value = []
    syncTabSelectedRemotesWithCurrentRepoRemotes()
    return
  }
  remotes.value = r.names
  syncTabSelectedRemotesWithCurrentRepoRemotes()
}

async function loadSidebarExtra() {
  if (!repoPath.value) return
  const [rv, tg, sth, sm] = await Promise.all([
    api.remoteList(),
    api.tags(),
    api.stashList(),
    api.submodules()
  ])
  if (!('error' in rv)) remoteDetails.value = rv.remotes
  if (!('error' in tg)) gitTags.value = tg.tags
  if (!('error' in sth)) stashEntries.value = sth.entries
  if (!('error' in sm)) submoduleItems.value = sm.submodules
}

async function addOpenedRepo(picked: string, opts?: { skipLoading?: boolean }): Promise<boolean> {
  const norm = normRepoPath(picked)
  const existing = repoTabs.value.find((t) => normRepoPath(t.path) === norm)
  if (existing) {
    await activateTab(existing.id, opts)
    return true
  }
  const title = repoDisplayNames.value[norm] ?? basenameRepo(picked)
  const run = async (): Promise<boolean> => {
    const set = await api.setRepo(picked)
    if (!set.ok) {
      loadError.value = set.error
      return false
    }
    const id = newTabId()
    repoTabs.value.push({ id, path: picked, title })
    repoDisplayNames.value[norm] = title
    activeTabId.value = id
    repoPath.value = picked
    selectedRemote.value = ''
    loadError.value = null
    clearHistoryCommitDetail()
    historyLogExtra.value = 0
    persistWorkspaceNow()
    await loadStatus()
    await loadHistory()
    await loadRemotes()
    await loadSidebarExtra()
    applySelectedRemoteForCurrentRepo()
    return true
  }
  if (opts?.skipLoading) return run()
  return runWithGitLoading(tr('ws.loadingOpenRepo', { name: title }), run)
}

async function openRepo() {
  const picked = await api.openRepoDialog()
  if (!picked) return
  await addOpenedRepo(picked)
}

function openCloneDialog() {
  cloneUrlInput.value = ''
  cloneParentDir.value = ''
  cloneFolderName.value = ''
  cloneDialogOpen.value = true
}

async function pickCloneParentDirectory() {
  const p = await api.selectDirectory()
  if (p) cloneParentDir.value = p
}

function syncCloneFolderFromUrl() {
  const d = deriveCloneFolderFromUrl(cloneUrlInput.value)
  if (d) cloneFolderName.value = d
}

async function runCloneRepo() {
  const url = cloneUrlInput.value.trim()
  const parent = cloneParentDir.value.trim()
  if (!url) {
    ElMessage.warning(tr('ws.cloneNeedUrl'))
    return
  }
  if (!parent) {
    ElMessage.warning(tr('ws.cloneNeedParent'))
    return
  }
  const directory = joinCloneTargetPath(parent, cloneFolderName.value)
  await runWithGitLoading(tr('ws.loadingClone'), async () => {
    const r = await api.cloneRepo({ url, directory })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.cloneDone'))
    cloneDialogOpen.value = false
    await addOpenedRepo(r.path, { skipLoading: true })
  })
}

/** 用于判断仓库状态是否与当前界面一致，避免无变更时触发 Vue 更新 */
function repoStateFingerprint(s: {
  loadError: string | null
  status: GitStatusPlain | null
  history: LogEntry[]
  historyGitgraph: GitgraphImportRow[]
  branches: string[]
  currentBranch: string
  remotes: string[]
  remoteDetails: { name: string; fetchUrl: string; pushUrl: string }[]
  gitTags: string[]
  stashEntries: { index: number; label: string }[]
  submoduleItems: { path: string; sha: string; ref?: string }[]
}): string {
  return JSON.stringify({
    e: s.loadError,
    st: s.status,
    h: s.history,
    gh: s.historyGitgraph,
    b: s.branches,
    c: s.currentBranch,
    r: s.remotes,
    rd: s.remoteDetails,
    tg: s.gitTags,
    sth: s.stashEntries,
    sm: s.submoduleItems
  })
}

async function refreshAll() {
  await refreshRoot()
  if (!repoPath.value) return
  historyGraphOverride.value = null

  const [st, br, logRes, remRes, rv, tg, sth, sm, trk] = await Promise.all([
    api.status(),
    api.branches(),
    api.log(getHistoryLogLimit()),
    api.remotes(),
    api.remoteList(),
    api.tags(),
    api.stashList(),
    api.submodules(),
    api.localBranchesTracking()
  ])

  if ('error' in st) {
    const err = st.error
    if (loadError.value === err && status.value === null) {
      return
    }
    if (isLikelyNetworkOrRemoteError(err)) {
      ElMessage.error(err)
    } else {
      loadError.value = err
    }
    status.value = null
    return
  }

  loadError.value = null

  if (!('error' in trk)) {
    localBranchTracking.value = new Map(
      trk.branches.map((b) => [b.name, { ahead: b.ahead, behind: b.behind, upstream: b.upstream }])
    )
  } else {
    localBranchTracking.value = new Map()
  }

  let nextBranches = branches.value
  let nextCurrent = currentBranch.value
  if (!('error' in br)) {
    nextBranches = br.all
    nextCurrent = br.current
  }

  const nextHistory: LogEntry[] = 'error' in logRes ? [] : logRes.entries
  const nextGitgraph: GitgraphImportRow[] = 'error' in logRes ? [] : logRes.gitgraph

  let nextRemotes = remotes.value
  if (!('error' in remRes)) {
    nextRemotes = remRes.names
  }

  let nextRemoteDetails = remoteDetails.value
  if (!('error' in rv)) nextRemoteDetails = rv.remotes
  let nextGitTags = gitTags.value
  if (!('error' in tg)) nextGitTags = tg.tags
  let nextStash = stashEntries.value
  if (!('error' in sth)) nextStash = sth.entries
  let nextSubmodule = submoduleItems.value
  if (!('error' in sm)) nextSubmodule = sm.submodules

  const next = repoStateFingerprint({
    loadError: null,
    status: st,
    history: nextHistory,
    historyGitgraph: nextGitgraph,
    branches: nextBranches,
    currentBranch: nextCurrent,
    remotes: nextRemotes,
    remoteDetails: nextRemoteDetails,
    gitTags: nextGitTags,
    stashEntries: nextStash,
    submoduleItems: nextSubmodule
  })
  const prev = repoStateFingerprint({
    loadError: loadError.value,
    status: status.value,
    history: history.value,
    historyGitgraph: historyGitgraph.value,
    branches: branches.value,
    currentBranch: currentBranch.value,
    remotes: remotes.value,
    remoteDetails: remoteDetails.value,
    gitTags: gitTags.value,
    stashEntries: stashEntries.value,
    submoduleItems: submoduleItems.value
  })

  if (next === prev) {
    return
  }

  status.value = st
  if (!('error' in br)) {
    branches.value = br.all
    currentBranch.value = br.current
  }
  history.value = nextHistory
  historyGitgraph.value = nextGitgraph
  if (!('error' in remRes)) {
    remotes.value = remRes.names
    syncTabSelectedRemotesWithCurrentRepoRemotes()
  }
  if (!('error' in rv)) remoteDetails.value = rv.remotes
  if (!('error' in tg)) gitTags.value = tg.tags
  if (!('error' in sth)) stashEntries.value = sth.entries
  if (!('error' in sm)) submoduleItems.value = sm.submodules
}

function remoteArg(): string | undefined {
  return preferredRemoteName.value || undefined
}

function openFetchSyncDialog() {
  if (!repoPath.value) return
  fetchDialogOpen.value = true
}

function openPullSyncDialog() {
  if (!repoPath.value) return
  pullDialogOpen.value = true
}

function openPushSyncDialog() {
  if (!repoPath.value) return
  pushDialogOpen.value = true
}

function openStashSyncDialog() {
  if (!repoPath.value) return
  stashDialogOpen.value = true
}

/** 供 Blame / 单文件历史 对话框预填路径 */
const openBlamePath = ref('')
const openFileHistoryPath = ref('')

function openCompareDialog(from?: string, to?: string) {
  if (!repoPath.value) return
  if (from != null || to != null) {
    comparePresetFrom.value = (from ?? '').trim()
    comparePresetTo.value = (to ?? '').trim()
  } else {
    comparePresetFrom.value = ''
    comparePresetTo.value = ''
  }
  compareDialogOpen.value = true
}

function openRebaseInteractiveStartDialog() {
  if (!repoPath.value) return
  rebaseInteractiveStartDialogOpen.value = true
}

function openPushDeleteBranchDialog() {
  if (!repoPath.value) return
  pushDeleteBranchDialogOpen.value = true
}

function openReflogDialog() {
  if (!repoPath.value) return
  reflogDialogOpen.value = true
}

function openWorktreeDialog() {
  if (!repoPath.value) return
  worktreeDialogOpen.value = true
}

function openBisectDialog() {
  if (!repoPath.value) return
  bisectDialogOpen.value = true
}

function openRebaseTodoDialog() {
  if (!repoPath.value) return
  rebaseTodoDialogOpen.value = true
}

function openBlameDialog(relPath?: string) {
  if (!repoPath.value) return
  openBlamePath.value = String(relPath ?? '').trim()
  blameDialogOpen.value = true
}

function openFileHistoryDialog(relPath?: string) {
  if (!repoPath.value) return
  openFileHistoryPath.value = String(relPath ?? '').trim()
  fileHistoryDialogOpen.value = true
}

function openRemotePruneDialog() {
  if (!repoPath.value) return
  remotePruneDialogOpen.value = true
}

function openLfsToolsDialog() {
  if (!repoPath.value) return
  lfsToolsDialogOpen.value = true
}

function openSettingsDialog() {
  settingsDialogOpen.value = true
}

watch(blameDialogOpen, (o) => {
  if (!o) openBlamePath.value = ''
})

watch(fileHistoryDialogOpen, (o) => {
  if (!o) openFileHistoryPath.value = ''
})

async function runFetch(opts: { remote?: string; all?: boolean; prune?: boolean }) {
  if (!repoPath.value) return
  syncBusy.value = 'fetch'
  loadError.value = null
  const r = await api.fetch(
    opts.all ? { all: true, prune: opts.prune } : { remote: opts.remote, prune: opts.prune }
  )
  syncBusy.value = null
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.fetchDone'))
  fetchDialogOpen.value = false
  await refreshAll()
}

async function loadRemoteBranchesForSidebar(remoteName: string) {
  const n = remoteName.trim()
  if (!n) return
  remoteSidebarLoadingBranchList[n] = true
  try {
    const r = await api.remoteBranches(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      remoteSidebarBranches.value = { ...remoteSidebarBranches.value, [n]: [] }
      return
    }
    remoteSidebarBranches.value = { ...remoteSidebarBranches.value, [n]: r.branches }
  } finally {
    remoteSidebarLoadingBranchList[n] = false
  }
}

/** 右键「跟踪远程分支」子菜单：预取尚未缓存的远程分支列表 */
async function prefetchRemoteBranchesForTrackMenu() {
  if (!repoPath.value) return
  await Promise.all(
    remoteDetails.value
      .filter((rm) => !(rm.name in remoteSidebarBranches.value))
      .map((rm) => loadRemoteBranchesForSidebar(rm.name))
  )
}

async function setBranchUpstream(localBranch: string, upstreamRef: string) {
  const loc = localBranch.trim()
  const up = upstreamRef.trim()
  if (!loc || !up || !repoPath.value) return
  const r = await api.branchSetUpstream({ localBranch: loc, upstreamRef: up })
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.branchUpstreamSet', { branch: loc, upstream: up }))
  await refreshAll()
}

async function fetchRemoteForSidebar(remoteName: string) {
  const n = remoteName.trim()
  if (!n || !repoPath.value) return
  await runWithGitLoading(tr('ws.loadingFetchFrom', { name: n }), async () => {
    loadError.value = null
    const res = await api.fetch({ remote: n })
    if ('error' in res) {
      ElMessage.error(res.error)
      return
    }
    ElMessage.success(tr('ws.fetchDone'))
    await refreshAll()
    await loadRemoteBranchesForSidebar(n)
    remoteSidebarExpanded[n] = true
  })
}

function toggleRemoteBranchesExpanded(remoteName: string) {
  const n = remoteName.trim()
  if (!n) return
  remoteSidebarExpanded[n] = !remoteSidebarExpanded[n]
  if (remoteSidebarExpanded[n] && !(n in remoteSidebarBranches.value)) {
    void loadRemoteBranchesForSidebar(n)
  }
}

/** 侧栏搜索需匹配远程下的分支；分支列表原仅在展开时加载，未加载则筛选结果为空。有搜索词时预取各远程分支列表。 */
let sidebarRemotePrefetchTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => sidebarSearch.value.trim(),
  (q) => {
    if (sidebarRemotePrefetchTimer) {
      clearTimeout(sidebarRemotePrefetchTimer)
      sidebarRemotePrefetchTimer = null
    }
    if (!q) return
    sidebarRemotePrefetchTimer = setTimeout(() => {
      sidebarRemotePrefetchTimer = null
      for (const rm of remoteDetails.value) {
        const n = rm.name
        if (!(n in remoteSidebarBranches.value)) {
          void loadRemoteBranchesForSidebar(n)
        }
      }
    }, 280)
  }
)

/** 远程改名后同步侧栏选中、标签页与分支缓存（由 SidebarCreateDialogs 在成功 rename 后调用） */
function applyRemoteRenameSelection(oldName: string, newName: string) {
  const o = oldName.trim()
  const n = newName.trim()
  if (!o || !n || o === n) return
  if (selectedRemote.value.trim() === o) selectedRemote.value = n
  for (const t of repoTabs.value) {
    if (t.selectedRemote === o) t.selectedRemote = n
  }
  if (o in remoteSidebarBranches.value) {
    const next = { ...remoteSidebarBranches.value }
    next[n] = next[o]!
    delete next[o]
    remoteSidebarBranches.value = next
  }
  if (remoteSidebarExpanded[o]) {
    remoteSidebarExpanded[n] = true
    delete remoteSidebarExpanded[o]
  }
  if (remoteSidebarLoadingBranchList[o]) {
    remoteSidebarLoadingBranchList[n] = remoteSidebarLoadingBranchList[o]!
    delete remoteSidebarLoadingBranchList[o]
  }
}

async function removeRemoteFromSidebar(remoteName: string) {
  const n = remoteName.trim()
  if (!n) return
  try {
    await ElMessageBox.confirm(tr('ws.removeRemoteConfirm', { name: n }), tr('ws.removeRemoteTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.delete'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRemoveRemote'), async () => {
    const r = await api.remoteRemove(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.remoteRemoved'))
    const next = { ...remoteSidebarBranches.value }
    delete next[n]
    remoteSidebarBranches.value = next
    delete remoteSidebarExpanded[n]
    delete remoteSidebarLoadingBranchList[n]
    await refreshAll()
  })
}

async function copyRemoteFetchUrl(rm: { fetchUrl: string; pushUrl?: string }) {
  const text = (rm.fetchUrl || rm.pushUrl || '').trim()
  if (!text) {
    ElMessage.warning(tr('ws.noUrlToCopy'))
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(tr('ws.urlCopied'))
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success(tr('ws.urlCopied'))
    } catch {
      ElMessage.error(tr('ws.copyFailed'))
    }
  }
}

async function runPull(opts: PullOpts) {
  if (!repoPath.value) return
  syncBusy.value = 'pull'
  loadError.value = null
  const r = await api.pull(opts)
  syncBusy.value = null
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.pullDone'))
  pullDialogOpen.value = false
  await refreshAll()
}

async function runPush(opts: PushOpts) {
  if (!repoPath.value) return
  syncBusy.value = 'push'
  loadError.value = null
  const r = await api.push(opts)
  syncBusy.value = null
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(opts?.dryRun ? tr('ws.pushDryRunDone') : tr('ws.pushDone'))
  if (!opts?.dryRun) pushDialogOpen.value = false
  await refreshAll()
}

function isStashNoLocalChangesError(msg: string): boolean {
  const s = msg.toLowerCase()
  if (s.includes('no local changes')) return true
  if (/nothing to stash/i.test(msg)) return true
  if (/没有要保存|沒有要儲存|没有可贮藏|无可贮藏/i.test(msg)) return true
  return false
}

async function runStashPush(opts: {
  message?: string
  includeUntracked?: boolean
  stagedOnly?: boolean
  paths?: string[]
}) {
  if (!repoPath.value) return
  stashBusy.value = true
  loadError.value = null
  const tryPush = async (o: {
    message?: string
    includeUntracked?: boolean
    stagedOnly?: boolean
    paths?: string[]
  }) => api.stashPush(o)

  let r = await tryPush(opts)
  if ('error' in r && isStashNoLocalChangesError(r.error) && !opts.includeUntracked) {
    r = await tryPush({ ...opts, includeUntracked: true })
  }
  if ('error' in r && isStashNoLocalChangesError(r.error) && opts.paths?.length && !opts.stagedOnly) {
    r = await tryPush({ ...opts, stagedOnly: true })
  }
  if ('error' in r && isStashNoLocalChangesError(r.error) && opts.paths?.length && opts.stagedOnly) {
    r = await tryPush({ ...opts, stagedOnly: false, paths: undefined })
  }
  if ('error' in r && isStashNoLocalChangesError(r.error) && !opts.stagedOnly && !(opts.paths?.length)) {
    r = await tryPush({
      message: opts.message,
      includeUntracked: opts.includeUntracked,
      stagedOnly: true
    })
  }
  stashBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(i18n.global.t('changes.stashSaved'))
  stashDialogOpen.value = false
  await refreshAll()
}

/** 一键贮藏：优先工作区+暂存区；失败时自动尝试含未跟踪、仅暂存或全仓库 */
async function quickStashAll() {
  if (!repoPath.value || syncBusy.value != null || commitBusy.value || stashBusy.value) return
  await runStashPush({})
}

async function stashApply(stashIndex: number) {
  const n = Math.floor(Number(stashIndex))
  if (!repoPath.value || !Number.isFinite(n) || n < 0) return
  await runWithGitLoading(tr('ws.loadingStashApply'), async () => {
    const r = await api.stashApply(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.stashApplied'))
    await refreshAll()
  })
}

async function stashPop(stashIndex: number) {
  const n = Math.floor(Number(stashIndex))
  if (!repoPath.value || !Number.isFinite(n) || n < 0) return
  try {
    await ElMessageBox.confirm(tr('ws.stashPopConfirm', { n: String(n) }), tr('ws.stashPopTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.pop'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingStashPop'), async () => {
    const r = await api.stashPop(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.stashPopped'))
    adjustSidebarStashSelectionAfterRemove(n)
    await refreshAll()
  })
}

async function dropStash(stashIndex: number) {
  const n = Math.floor(Number(stashIndex))
  if (!repoPath.value || !Number.isFinite(n) || n < 0) return
  const entry = stashEntries.value.find((e) => e.index === n)
  const hint = entry?.label ? `\n「${entry.label}」` : ''
  try {
    await ElMessageBox.confirm(tr('ws.stashDropConfirm', { n: String(n), hint }), tr('ws.stashDropTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.delete'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingStashDrop'), async () => {
    const r = await api.stashDrop(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.stashDropped'))
    adjustSidebarStashSelectionAfterRemove(n)
    await refreshAll()
  })
}

async function mergeIntoHead(ref: string) {
  const r = String(ref ?? '').trim()
  if (!r || !repoPath.value) return
  if (syncBusy.value != null || commitBusy.value || stashBusy.value) return
  const headLabel = currentBranch.value.trim() || tr('common.detachedHead')
  try {
    await ElMessageBox.confirm(tr('ws.mergeConfirm', { ref: r, head: headLabel }), tr('ws.mergeTitle'), {
      type: 'warning',
      confirmButtonText: tr('ws.mergeBtn'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingMerge'), async () => {
    const res = await api.merge(r)
    if ('error' in res) {
      ElMessage.error(res.error)
      return
    }
    ElMessage.success(tr('ws.mergeDone'))
    await refreshAll()
  })
}

async function rebaseOnto(ref: string) {
  const r = String(ref ?? '').trim()
  if (!r || !repoPath.value) return
  if (syncBusy.value != null || commitBusy.value || stashBusy.value) return
  try {
    await ElMessageBox.confirm(tr('ws.rebaseConfirm', { ref: r }), tr('ws.rebaseTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.startRebase'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRebase'), async () => {
    const res = await api.rebase(r)
    if ('error' in res) {
      ElMessage.error(res.error)
      return
    }
    ElMessage.success(tr('ws.rebaseDone'))
    await refreshAll()
  })
}

function gitHistoryOpBlocked(): boolean {
  return syncBusy.value != null || commitBusy.value || stashBusy.value
}

async function cherryPickCommit(rev: string) {
  const h = String(rev ?? '').trim()
  if (!h || !repoPath.value) return
  if (gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(
      tr('ws.cherryPickConfirm', { short: h.slice(0, 7) }),
      tr('ws.cherryPickTitle'),
      { type: 'warning', confirmButtonText: tr('history.cherryPick'), cancelButtonText: tr('common.cancel') }
    )
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingCherryPick'), async () => {
    const r = await api.cherryPick(h)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.cherryPickDone'))
    await refreshAll()
  })
}

async function revertCommit(rev: string) {
  const h = String(rev ?? '').trim()
  if (!h || !repoPath.value) return
  if (gitHistoryOpBlocked()) return
  const d = await api.commitDetail(h)
  if ('error' in d) {
    ElMessage.error(d.error)
    return
  }
  let mainline: number | undefined
  if (d.parents.length > 1) {
    try {
      const { value } = await ElMessageBox.prompt(tr('ws.revertMergePrompt'), tr('ws.revertMergeTitle'), {
        confirmButtonText: tr('common.continue'),
        cancelButtonText: tr('common.cancel'),
        inputValue: '1',
        inputPattern: /^[1-9]\d*$/,
        inputErrorMessage: tr('ws.revertMainlineInvalid')
      })
      mainline = parseInt(String(value).trim(), 10)
    } catch {
      return
    }
  }
  try {
    await ElMessageBox.confirm(tr('ws.revertConfirm', { short: h.slice(0, 7) }), tr('ws.revertTitle'), {
      type: 'warning',
      confirmButtonText: tr('history.revert'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRevert'), async () => {
    const r = await api.revert({ hash: h, mainline })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.revertCreated'))
    await refreshAll()
  })
}

async function resetToCommit(ref: string, mode: 'soft' | 'mixed' | 'hard') {
  const h = String(ref ?? '').trim()
  if (!h || !repoPath.value) return
  if (gitHistoryOpBlocked()) return
  const modeLabel =
    mode === 'soft' ? tr('ws.resetModeSoft') : mode === 'mixed' ? tr('ws.resetModeMixed') : tr('ws.resetModeHard')
  const hints =
    mode === 'soft'
      ? tr('ws.resetHintSoft')
      : mode === 'mixed'
        ? tr('ws.resetHintMixed')
        : tr('ws.resetHintHard')
  const short = h.slice(0, 7)
  if (mode === 'hard') {
    try {
      await ElMessageBox.confirm(
        tr('ws.resetHardConfirm1', { short, hint: hints }),
        tr('ws.resetHardTitle'),
        { type: 'error', confirmButtonText: tr('ws.resetHardFirstConfirm'), cancelButtonText: tr('common.cancel') }
      )
    } catch {
      return
    }
    try {
      await ElMessageBox.confirm(tr('ws.resetHardAgain'), tr('ws.resetHardTitle'), {
        type: 'error',
        confirmButtonText: tr('ws.resetHardConfirmBtn'),
        cancelButtonText: tr('common.cancel')
      })
    } catch {
      return
    }
  } else {
    try {
      await ElMessageBox.confirm(
        tr('ws.resetSoftMixedConfirm', { mode: modeLabel, short, hint: hints }),
        tr('ws.resetTitle'),
        { type: 'warning', confirmButtonText: tr('ws.resetBtn'), cancelButtonText: tr('common.cancel') }
      )
    } catch {
      return
    }
  }
  await runWithGitLoading(tr('ws.loadingReset'), async () => {
    const r = await api.reset({ ref: h, mode })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.resetDone'))
    await refreshAll()
  })
}

async function openInteractiveRebaseHint() {
  if (!repoPath.value) return
  const todo = await api.rebaseTodoRead()
  if ('text' in todo) {
    rebaseTodoDialogOpen.value = true
    return
  }
  try {
    await ElMessageBox.confirm(tr('ws.rebaseTodoMissing'), tr('ws.rebaseInteractiveTitle'), {
      type: 'info',
      confirmButtonText: tr('common.openTerminal'),
      cancelButtonText: tr('common.close')
    })
  } catch {
    return
  }
  await openRepoInGitTerminal()
}

async function runMergeContinue() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  await runWithGitLoading(tr('ws.loadingMergeContinue'), async () => {
    const r = await api.mergeContinue()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.mergeContinueDone'))
    await refreshAll()
  })
}

async function runMergeAbort() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(tr('ws.mergeAbortConfirm'), tr('ws.mergeAbortTitle'), {
      type: 'warning',
      confirmButtonText: tr('ws.mergeAbortBtn'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingMergeAbort'), async () => {
    const r = await api.mergeAbort()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.mergeAborted'))
    await refreshAll()
  })
}

async function runRebaseContinue() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  await runWithGitLoading(tr('ws.loadingRebaseContinue'), async () => {
    const r = await api.rebaseContinue()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.rebaseContinued'))
    await refreshAll()
  })
}

async function runRebaseSkip() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(tr('ws.rebaseSkipConfirm'), tr('ws.rebaseSkipTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.skip'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRebaseSkip'), async () => {
    const r = await api.rebaseSkip()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.rebaseSkipped'))
    await refreshAll()
  })
}

async function runRebaseAbort() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(tr('ws.rebaseAbortConfirm'), tr('ws.rebaseAbortTitle'), {
      type: 'warning',
      confirmButtonText: tr('ws.rebaseAbortBtn'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRebaseAbort'), async () => {
    const r = await api.rebaseAbort()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.rebaseAborted'))
    await refreshAll()
  })
}

async function runCherryPickContinue() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  await runWithGitLoading(tr('ws.loadingCherryPickContinue'), async () => {
    const r = await api.cherryPickContinue()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.cherryPickContinued'))
    await refreshAll()
  })
}

async function runCherryPickAbort() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(tr('ws.cherryPickAbortConfirm'), tr('ws.cherryPickAbortTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.abort'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingCherryPickAbort'), async () => {
    const r = await api.cherryPickAbort()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.cherryPickAborted'))
    await refreshAll()
  })
}

async function runRevertContinue() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  await runWithGitLoading(tr('ws.loadingRevertContinue'), async () => {
    const r = await api.revertContinue()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.revertContinued'))
    await refreshAll()
  })
}

async function runRevertAbort() {
  if (!repoPath.value || gitHistoryOpBlocked()) return
  try {
    await ElMessageBox.confirm(tr('ws.revertAbortConfirm'), tr('ws.revertAbortTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.abort'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingRevertAbort'), async () => {
    const r = await api.revertAbort()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.revertAborted'))
    await refreshAll()
  })
}

function defaultRemoteForTagDelete(): string {
  return resolvePreferredRemoteName(selectedRemote.value)
}

function openTagDeleteDialog(tagName: string) {
  const n = String(tagName ?? '').trim()
  if (!n) return
  tagDeleteTagName.value = n
  tagDeleteAlsoRemote.value = false
  tagDeleteRemotePick.value = defaultRemoteForTagDelete()
  tagDeleteDialogOpen.value = true
}

function closeTagDeleteDialog() {
  tagDeleteDialogOpen.value = false
}

async function confirmTagDelete() {
  const name = tagDeleteTagName.value.trim()
  if (!name || !repoPath.value) return
  let remote = ''
  if (tagDeleteAlsoRemote.value) {
    remote = tagDeleteRemotePick.value.trim()
    if (!remote) {
      ElMessage.warning(tr('ws.pickRemoteForTagDelete'))
      return
    }
    if (!remotes.value.includes(remote)) {
      ElMessage.warning(tr('ws.remoteNotFound'))
      return
    }
  }
  await runWithGitLoading(tr('ws.loadingTagDelete'), async () => {
    const r = await api.tagDelete({ name, remote: remote || undefined })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(remote ? tr('ws.tagDeletedRemoteToo') : tr('ws.tagDeletedLocal'))
    tagDeleteDialogOpen.value = false
    const sel = selectedSidebarRef.value
    if (sel?.kind === 'tag' && sel.name === name) {
      clearHistoryCommitDetail()
    }
    await refreshAll()
  })
}

async function openRepoInExplorer() {
  if (!repoPath.value) return
  const r = await api.openRepoRootInExplorer()
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
}

function terminalShellPayload(): { shellPath?: string } {
  const s = loadAppSettings().customGitShellPath.trim()
  return s ? { shellPath: s } : {}
}

function mergetoolSettingsPayload(): { preset?: string; toolPath?: string } {
  const k = loadAppSettings()
  if (k.mergeToolPreset === 'default' && !k.mergeToolExecutablePath.trim()) return {}
  const o: { preset?: string; toolPath?: string } = { preset: k.mergeToolPreset }
  if (k.mergeToolExecutablePath.trim()) o.toolPath = k.mergeToolExecutablePath.trim()
  return o
}

async function openRepoInGitTerminal() {
  if (!repoPath.value) return
  const r = await api.openRepoRootInGitTerminal(terminalShellPayload())
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
}

/** 供「变基 / 贮藏」等对话框在仓库根目录打开终端并执行命令 */
async function openGitTerminalWithCommand(cmd: string) {
  if (!repoPath.value) return
  const r = await api.openRepoRootInGitTerminalWithCommand(cmd, terminalShellPayload())
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.terminalOpened'))
}

function joinRepoRelativePath(repo: string, rel: string): string {
  const sep = repo.includes('\\') ? '\\' : '/'
  return `${repo.replace(/[/\\]+$/, '')}${sep}${rel.replace(/^[/\\]+/, '').replace(/\//g, sep)}`
}

async function openSubmoduleInExplorer(relPath: string) {
  const r = await api.openRepoRelativeInExplorer(relPath)
  if ('error' in r) ElMessage.error(r.error)
}

async function openSubmoduleInGitTerminal(relPath: string) {
  const r = await api.openRepoRelativeInGitTerminal(relPath, terminalShellPayload())
  if ('error' in r) ElMessage.error(r.error)
}

async function copySubmodulePathToClipboard(relPath: string) {
  if (!repoPath.value) return
  const abs = joinRepoRelativePath(repoPath.value, relPath)
  try {
    await navigator.clipboard.writeText(abs)
    ElMessage.success(tr('ws.pathCopied'))
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = abs
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success(tr('ws.pathCopied'))
    } catch {
      ElMessage.error(tr('ws.copyFailed'))
    }
  }
}

async function removeSubmodule(relPath: string) {
  const name = relPath.trim()
  if (!name) return
  try {
    await ElMessageBox.confirm(tr('ws.submoduleRemoveConfirm', { name }), tr('ws.submoduleRemoveTitle'), {
      type: 'warning',
      confirmButtonText: tr('common.remove'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingSubmoduleRemove'), async () => {
    const r = await api.submoduleRemove(name)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.submoduleRemoved'))
    await refreshAll()
  })
}

async function runSubmoduleUpdateSync() {
  if (!repoPath.value) return
  try {
    await ElMessageBox.confirm(tr('ws.submoduleUpdateConfirm'), tr('ws.submoduleUpdateTitle'), {
      type: 'info',
      confirmButtonText: tr('common.startUpdate'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingSubmoduleUpdate'), async () => {
    const r = await api.submoduleUpdate({ init: true, recursive: true })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.submoduleUpdated'))
    await refreshAll()
  })
}

async function runSubmoduleSync() {
  if (!repoPath.value) return
  await runWithGitLoading(tr('ws.loadingSubmoduleSync'), async () => {
    const r = await api.submoduleSync({ recursive: true })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.submoduleSyncDone'))
    await refreshAll()
  })
}

async function runSubmoduleForeachPreset(preset: 'fetch' | 'pull' | 'pullRebase' | 'status') {
  if (!repoPath.value) return
  await runWithGitLoading(tr('ws.loadingSubmoduleForeach'), async () => {
    const r = await api.submoduleForeachPreset(preset)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.submoduleForeachDone'))
    await refreshAll()
  })
}

async function runSubmoduleUpdateRemote(opts?: { rebase?: boolean }) {
  if (!repoPath.value) return
  const mode = opts?.rebase ? 'rebase' : 'merge'
  try {
    await ElMessageBox.confirm(
      tr('ws.submoduleUpdateRemoteConfirm', { mode }),
      tr('ws.submoduleUpdateRemoteTitle'),
      { type: 'warning', confirmButtonText: tr('common.execute'), cancelButtonText: tr('common.cancel') }
    )
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingSubmoduleUpdateRemote'), async () => {
    const r = await api.submoduleUpdateRemote({ rebase: !!opts?.rebase, recursive: true })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.submoduleUpdatedRemote'))
    await refreshAll()
  })
}

async function runLfsInstall() {
  if (!repoPath.value) return
  const v = await api.lfsVersion()
  if ('error' in v) {
    ElMessage.error(tr('ws.lfsNotFound', { msg: v.error }))
    return
  }
  await runWithGitLoading(tr('ws.loadingLfsInstall'), async () => {
    const r = await api.lfsInstall()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.lfsInstallDone'))
    await refreshAll()
  })
}

async function runLfsPull() {
  if (!repoPath.value) return
  const v = await api.lfsVersion()
  if ('error' in v) {
    ElMessage.error(tr('ws.lfsNotFound', { msg: v.error }))
    return
  }
  await runWithGitLoading(tr('ws.loadingLfsPull'), async () => {
    const r = await api.lfsPull()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.lfsPullDone'))
    await refreshAll()
  })
}

async function runPushDeleteBranch(remote: string, branch: string) {
  const rm = remote.trim()
  const br = branch.trim()
  if (!repoPath.value || !rm || !br) return
  try {
    await ElMessageBox.confirm(
      tr('ws.pushDeleteBranchConfirm', { remote: rm, branch: br }),
      tr('ws.pushDeleteBranchTitle'),
      { type: 'error', confirmButtonText: tr('common.delete'), cancelButtonText: tr('common.cancel') }
    )
  } catch {
    return
  }
  await runWithGitLoading(tr('ws.loadingPushDeleteBranch'), async () => {
    const r = await api.pushDeleteBranch({ remote: rm, branch: br })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.remoteBranchDeleted'))
    pushDeleteBranchDialogOpen.value = false
    await refreshAll()
  })
}

async function checkoutConflictOurs(relPath: string) {
  const p = String(relPath ?? '').trim()
  if (!p || !repoPath.value) return
  await runWithGitLoading(tr('ws.loadingCheckoutOurs'), async () => {
    const r = await api.checkoutOurs(p)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.checkoutOursDone'))
    await refreshAll()
  })
}

async function checkoutConflictTheirs(relPath: string) {
  const p = String(relPath ?? '').trim()
  if (!p || !repoPath.value) return
  await runWithGitLoading(tr('ws.loadingCheckoutTheirs'), async () => {
    const r = await api.checkoutTheirs(p)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.checkoutTheirsDone'))
    await refreshAll()
  })
}

async function openMergetoolForPath(relPath?: string) {
  if (!repoPath.value) return
  const p = relPath != null ? String(relPath).trim() : ''
  await runWithGitLoading(tr('ws.loadingMergetool'), async () => {
    const r = await api.mergetool(p || undefined, mergetoolSettingsPayload())
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.info(tr('ws.mergetoolLaunched'))
    await refreshAll()
  })
}

function shellSingleQuoteForBash(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}

async function openAddPartialStashHint() {
  if (!repoPath.value) return
  const rel = (selectedPath.value ?? '').trim().replace(/\\/g, '/')
  const cmd = rel ? `git add -p -- ${shellSingleQuoteForBash(rel)}` : 'git add -p'
  try {
    await ElMessageBox.confirm(tr('ws.partialStageConfirm', { cmd }), tr('ws.partialStageTitle'), {
      type: 'info',
      confirmButtonText: tr('common.openTerminal'),
      cancelButtonText: tr('common.close')
    })
  } catch {
    return
  }
  const r = await api.openRepoRootInGitTerminalWithCommand(cmd, terminalShellPayload())
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tr('ws.terminalOpened'))
}

async function runBisectStep(action: 'good' | 'bad' | 'skip' | 'reset', rev?: string) {
  if (!repoPath.value) return
  if (gitHistoryOpBlocked()) return
  const label =
    action === 'good'
      ? tr('ws.bisectMarkingGood')
      : action === 'bad'
        ? tr('ws.bisectMarkingBad')
        : action === 'skip'
          ? tr('ws.bisectSkipping')
          : tr('ws.bisectResetting')
  await runWithGitLoading(label, async () => {
    let r: { ok: true } | { error: string }
    if (action === 'good') r = await api.bisectGood(rev?.trim() || undefined)
    else if (action === 'bad') r = await api.bisectBad(rev?.trim() || undefined)
    else if (action === 'skip') r = await api.bisectSkip()
    else r = await api.bisectReset()
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.bisectUpdated'))
    await refreshAll()
  })
}

async function onBranchChange(name: string) {
  const n = String(name ?? '').trim()
  if (!n) return
  if (n === currentBranch.value.trim()) return
  await runWithGitLoading(tr('ws.loadingCheckout', { branch: n }), async () => {
    const r = await api.checkout(n)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.branchCheckedOut', { branch: n }))
    await refreshAll()
  })
}

function onBranchSelect(v: string | number | boolean | null | undefined) {
  if (v == null || v === '') return
  void onBranchChange(String(v))
}

async function renameLocalBranch(from: string, to: string) {
  const t = to.trim()
  if (!t) {
    ElMessage.warning(tr('ws.nameRequired'))
    return
  }
  if (t === from) return
  await runWithGitLoading(tr('ws.loadingBranchRename'), async () => {
    const r = await api.branchRename(from, t)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('ws.branchRenamed'))
    await refreshAll()
  })
}

/** @returns 失败时的 `{ error }`，成功或已取消返回 `undefined`；`force` 为 true 时失败会弹错误提示 */
async function deleteLocalBranch(name: string, force: boolean): Promise<GitErr | undefined> {
  return runWithGitLoading(force ? tr('ws.loadingBranchDeleteForce') : tr('ws.loadingBranchDelete'), async () => {
    const r = await api.branchDelete(name, force)
    if ('error' in r) {
      if (force) ElMessage.error(r.error)
      return r
    }
    ElMessage.success(force ? tr('ws.branchForceDeleted') : tr('ws.branchDeleted'))
    await refreshAll()
    return undefined
  })
}

type Row = {
  path: string
  label: string
  staged: boolean
  unstaged: boolean
  /** Git 短状态：index 列 */
  index: string
  /** Git 短状态：working tree 列 */
  workingDir: string
  /** 修订上次提交时，来自 HEAD 的 name-status 状态（如 M / A / D） */
  amendCommitStatus?: string
}

/** 侧边栏树节点（目录或文件） */
export type FileTreeNode = {
  id: string
  label: string
  children?: FileTreeNode[]
  path?: string
  row?: Row
}

type DirMap = { dirs: Map<string, DirMap>; files: Row[] }

/** 提交里 `old → new` 仅用于 diff/选中 id；建树分层必须用新路径拆目录 */
function pathForCommitTreeLayout(spec: string): string {
  const s = spec.trim()
  const arrow = ' → '
  if (s.includes(arrow)) {
    const tail = s.split(arrow).pop()?.trim()
    if (tail) return tail
  }
  return s
}

function splitPathForTree(p: string): string[] {
  const t = pathForCommitTreeLayout(p).trim()
  if (!t) return []
  return t.split(/[/\\]/).filter(Boolean)
}

function addRowToDirMap(root: DirMap, row: Row) {
  const parts = pathForCommitTreeLayout(row.path).split(/[/\\]/).filter(Boolean)
  let cur = root
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (i === parts.length - 1) {
      cur.files.push(row)
    } else {
      if (!cur.dirs.has(seg)) cur.dirs.set(seg, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(seg)!
    }
  }
}

function dirMapToTreeNodes(dm: DirMap, idPrefix: string): FileTreeNode[] {
  const nodes: FileTreeNode[] = []
  const dirEntries = [...dm.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [name, sub] of dirEntries) {
    const segPath = idPrefix ? `${idPrefix}/${name}` : name
    const children = dirMapToTreeNodes(sub, segPath)
    nodes.push({
      id: `dir:${segPath}`,
      label: name,
      children
    })
  }
  const files = [...dm.files].sort((a, b) => a.path.localeCompare(b.path))
  for (const row of files) {
    const name = pathForCommitTreeLayout(row.path).split(/[/\\]/).filter(Boolean).pop()!
    nodes.push({
      id: row.path,
      label: name,
      path: row.path,
      row
    })
  }
  return nodes
}

function rowsToPathTree(rows: Row[]): FileTreeNode[] {
  const root: DirMap = { dirs: new Map(), files: [] }
  for (const row of rows) addRowToDirMap(root, row)
  return dirMapToTreeNodes(root, '')
}

function commitDetailFilesToAmendRows(files: { path: string; status: string }[]): Row[] {
  return files.map((f) => {
    const layout = pathForCommitTreeLayout(f.path)
    const name = layout.split(/[/\\]/).filter(Boolean).pop() ?? f.path
    return {
      path: f.path,
      label: `${f.status} ${name}`,
      staged: true,
      unstaged: false,
      index: ' ',
      workingDir: ' ',
      amendCommitStatus: f.status
    }
  })
}

/** 未暂存区看 working tree；已暂存区看 index。修改类用黄色 M，新增/删除仍用绿+/红− */
function statusGlyphsForRow(
  row: Row,
  scope: 'staged' | 'unstaged'
): { plus: boolean; minus: boolean; modified: boolean } {
  if (scope === 'staged' && row.amendCommitStatus) {
    return commitFileGlyphs(row.amendCommitStatus)
  }
  const ix = row.index || ' '
  const wd = row.workingDir || ' '
  if (scope === 'unstaged') {
    /** 同一路径两行：暂存区删除（D）+ 工作区未跟踪（??），未暂存侧表示「可再次加入」 */
    if (ix === 'D' && wd === '?') return { plus: true, minus: false, modified: false }
    if (wd === 'D') return { plus: false, minus: true, modified: false }
    if (ix === '?' && wd === '?') return { plus: true, minus: false, modified: false }
    if (wd === 'M') return { plus: false, minus: false, modified: true }
    if (wd === 'A') return { plus: true, minus: false, modified: false }
    if (wd === 'R' || wd === 'C' || wd === 'U') return { plus: false, minus: false, modified: true }
    return { plus: false, minus: false, modified: false }
  }
  if (ix === 'D') return { plus: false, minus: true, modified: false }
  if (ix === 'A') return { plus: true, minus: false, modified: false }
  if (ix === 'M') return { plus: false, minus: false, modified: true }
  if (ix === 'R' || ix === 'C') return { plus: false, minus: false, modified: true }
  return { plus: false, minus: false, modified: false }
}

/** 提交中 `--name-status` 的 status（如 A / M / D / R100）→ 与侧边栏一致的 glyph */
function commitFileGlyphs(status: string): { plus: boolean; minus: boolean; modified: boolean } {
  const c = (status.trim()[0] || '').toUpperCase()
  if (c === 'A') return { plus: true, minus: false, modified: false }
  if (c === 'D') return { plus: false, minus: true, modified: false }
  if (c === 'M') return { plus: false, minus: false, modified: true }
  if (c === 'R' || c === 'C' || c === 'T' || c === 'U') return { plus: false, minus: false, modified: true }
  return { plus: false, minus: false, modified: false }
}

type CommitDetailFileItem = { path: string; status?: string }

/** 提交详情「文件树」标签页用（与变更侧栏相同的目录结构） */
type CommitDetailFileTreeNode = {
  id: string
  label: string
  children?: CommitDetailFileTreeNode[]
  path?: string
  status?: string
}

type CommitDirMap = { dirs: Map<string, CommitDirMap>; files: CommitDetailFileItem[] }

function addCommitFileToDirMap(root: CommitDirMap, f: CommitDetailFileItem) {
  const parts = splitPathForTree(f.path)
  if (!parts.length) return
  let cur = root
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (i === parts.length - 1) {
      cur.files.push(f)
    } else {
      if (!cur.dirs.has(seg)) cur.dirs.set(seg, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(seg)!
    }
  }
}

function dirMapToCommitTreeNodes(dm: CommitDirMap, idPrefix: string): CommitDetailFileTreeNode[] {
  const nodes: CommitDetailFileTreeNode[] = []
  const dirEntries = [...dm.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [name, sub] of dirEntries) {
    const segPath = idPrefix ? `${idPrefix}/${name}` : name
    const children = dirMapToCommitTreeNodes(sub, segPath)
    nodes.push({
      id: `dir:${segPath}`,
      label: name,
      children
    })
  }
  const files = [...dm.files].sort((a, b) => a.path.localeCompare(b.path))
  for (const f of files) {
    const segs = splitPathForTree(f.path)
    const name = segs[segs.length - 1] ?? f.path
    const leaf: CommitDetailFileTreeNode = {
      id: f.path,
      label: name,
      path: f.path
    }
    if (f.status !== undefined && f.status !== '') leaf.status = f.status
    nodes.push(leaf)
  }
  return nodes
}

function commitFilesToTree(files: CommitDetailFileItem[]): CommitDetailFileTreeNode[] {
  const root: CommitDirMap = { dirs: new Map(), files: [] }
  for (const f of files) addCommitFileToDirMap(root, f)
  return dirMapToCommitTreeNodes(root, '')
}

function addPathOnlyToDirMap(root: CommitDirMap, fpath: string) {
  const parts = splitPathForTree(fpath)
  if (!parts.length) return
  let cur = root
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (i === parts.length - 1) {
      cur.files.push({ path: fpath })
    } else {
      if (!cur.dirs.has(seg)) cur.dirs.set(seg, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(seg)!
    }
  }
}

function commitPathsOnlyToTree(paths: string[]): CommitDetailFileTreeNode[] {
  if (!paths.length) return []
  const root: CommitDirMap = { dirs: new Map(), files: [] }
  for (const p of paths) addPathOnlyToDirMap(root, p)
  return dirMapToCommitTreeNodes(root, '')
}

const commitSnapshotTreePaths = ref<string[]>([])
const commitSnapshotTreeLoading = ref(false)

const commitFilesTreeData = computed(() => commitPathsOnlyToTree(commitSnapshotTreePaths.value))

/** 历史「文件树」标签：按路径筛选快照树 */
const historySnapshotTreeSearch = ref('')
const commitFilesTreeDataFiltered = computed(() => {
  const paths = commitSnapshotTreePaths.value
  const q = historySnapshotTreeSearch.value.trim().toLowerCase()
  const filtered = !q ? paths : paths.filter((p) => p.toLowerCase().includes(q))
  return commitPathsOnlyToTree(filtered)
})

async function loadCommitSnapshotTree(hash: string) {
  commitSnapshotTreeLoading.value = true
  commitSnapshotTreePaths.value = []
  try {
    const r = await api.commitTreePaths(hash)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    commitSnapshotTreePaths.value = r.paths
  } finally {
    commitSnapshotTreeLoading.value = false
  }
}

const filteredCommitFilesForChangeTab = computed(() => {
  const files = commitDetail.value?.files
  if (!files?.length) return []
  const q = historyChangeFileSearch.value.trim().toLowerCase()
  if (!q) return files
  return files.filter((f) => {
    const p = f.path.toLowerCase()
    const layout = pathForCommitTreeLayout(f.path).toLowerCase()
    return p.includes(q) || layout.includes(q)
  })
})

const commitFilesTreeForChangesTab = computed(() => commitFilesToTree(filteredCommitFilesForChangeTab.value))

const sortedCommitDetailFiles = computed(() => {
  const files = commitDetail.value?.files
  if (!files?.length) return []
  return [...files].sort((a, b) => a.path.localeCompare(b.path))
})

function collectPathsFromTreeNode(node: FileTreeNode): string[] {
  if (node.path) return [node.path]
  if (!node.children?.length) return []
  return node.children.flatMap(collectPathsFromTreeNode)
}

let unstagedTreeClickTimer: ReturnType<typeof setTimeout> | null = null
let stagedTreeClickTimer: ReturnType<typeof setTimeout> | null = null

/** 变更侧栏多选（无 checkbox，用高亮表示）；Shift 范围按树深度优先顺序 */
const unstagedSelectedPaths = ref<string[]>([])
const stagedSelectedPaths = ref<string[]>([])
const unstagedRangeAnchorPath = ref<string | null>(null)
const stagedRangeAnchorPath = ref<string | null>(null)

function collectFilePathsDfsOrder(nodes: FileTreeNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.children?.length) out.push(...collectFilePathsDfsOrder(n.children))
    if (n.row && n.path) out.push(n.path)
  }
  return out
}

function orderedUnstagedTreePaths(): string[] {
  return collectFilePathsDfsOrder(unstagedTreeData.value)
}

function orderedStagedTreePaths(): string[] {
  return collectFilePathsDfsOrder(stagedTreeData.value)
}

function changeTreeNodeClass(scope: 'unstaged' | 'staged', data: FileTreeNode): string {
  const p = data.path
  if (!p) return ''
  const sel = scope === 'unstaged' ? unstagedSelectedPaths.value : stagedSelectedPaths.value
  return sel.includes(p) ? 'change-tree-node--selected' : ''
}

function clearUnstagedTreeSelection() {
  unstagedSelectedPaths.value = []
  unstagedRangeAnchorPath.value = null
}

function clearStagedTreeSelection() {
  stagedSelectedPaths.value = []
  stagedRangeAnchorPath.value = null
}

function changeCheckedPathsForScope(scope: 'unstaged' | 'staged'): string[] {
  return scope === 'unstaged' ? [...unstagedSelectedPaths.value] : [...stagedSelectedPaths.value]
}

/** `D path` + `?? path` 会在 `status.files` 里占两条同 path，合并后才能在 UI 同时看到暂存删除与未跟踪新增 */
function mergeFileRowsForSamePath(a: Row, b: Row): Row {
  const staged = a.staged || b.staged
  const unstaged = a.unstaged || b.unstaged
  const aUnt = a.index === '?' && a.workingDir === '?'
  const bUnt = b.index === '?' && b.workingDir === '?'
  const aDel = a.index === 'D'
  const bDel = b.index === 'D'
  const ix = aDel || bDel ? 'D' : aUnt || bUnt ? '?' : b.index || a.index
  const wd = aUnt || bUnt ? '?' : b.workingDir || a.workingDir || ''
  const ixF = ix
  const wdF = wd
  const label =
    ixF === '?' && wdF === '?'
      ? '??'
      : ixF === 'D' && wdF === '?'
        ? 'D / ??'
        : [ixF, wdF].filter(Boolean).join(' / ') || '—'
  return {
    path: a.path,
    label,
    staged,
    unstaged,
    index: ixF,
    workingDir: wdF,
    amendCommitStatus: a.amendCommitStatus ?? b.amendCommitStatus
  }
}

const fileRows = computed<Row[]>(() => {
  const s = status.value
  if (!s) return []
  const map = new Map<string, Row>()
  for (const f of s.files) {
    /** simple-git 不把纯索引重命名（R+空格）放进 `staged[]`，但索引侧已暂存 */
    const staged =
      s.staged.includes(f.path) ||
      s.renamed.some(
        (r) =>
          r.to === f.path ||
          r.from === f.path ||
          pathForCommitTreeLayout(r.to) === pathForCommitTreeLayout(f.path) ||
          pathForCommitTreeLayout(r.from) === pathForCommitTreeLayout(f.path)
      )
    const wd = f.working_dir.trim()
    const unstaged =
      (wd !== '' && wd !== '?') || s.not_added.includes(f.path) || (!staged && f.index === '?')
    const ix = f.index !== ' ' && f.index ? f.index : ''
    const wdx = f.working_dir !== ' ' && f.working_dir ? f.working_dir : ''
    const label = ix === '?' && wdx === '?' ? '??' : [ix, wdx].filter(Boolean).join(' / ') || '—'
    const next: Row = {
      path: f.path,
      label,
      staged,
      unstaged,
      index: ix,
      workingDir: wdx
    }
    const prev = map.get(f.path)
    map.set(f.path, prev ? mergeFileRowsForSamePath(prev, next) : next)
  }
  for (const p of s.not_added) {
    if (!map.has(p))
      map.set(p, {
        path: p,
        label: '??',
        staged: false,
        unstaged: true,
        index: '?',
        workingDir: '?'
      })
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
})

const stagedRows = computed(() => fileRows.value.filter((r) => r.staged))

function fileRowMatchingAmendPath(amendPath: string, rows: Row[]): Row | undefined {
  const k = pathForCommitTreeLayout(amendPath)
  return rows.find((fr) => fr.path === amendPath || pathForCommitTreeLayout(fr.path) === k)
}

function pathsMatchAmend(rowPath: string, amendPath: string): boolean {
  return rowPath === amendPath || pathForCommitTreeLayout(rowPath) === pathForCommitTreeLayout(amendPath)
}

/** 修订模式：暂存区仅展示已在索引中的 HEAD 文件 + 新暂存路径；从索引拿掉后只出现在未暂存，可再次 git add 回来 */
function buildAmendDisplayStagedRows(): Row[] {
  const detail = amendHeadDetail.value
  if (!detail?.files?.length) return stagedRows.value
  const amendRows = commitDetailFilesToAmendRows(detail.files)
  const amendKeys = new Set(detail.files.map((f) => pathForCommitTreeLayout(f.path)))
  const out: Row[] = []

  for (const ar of amendRows) {
    /** 以 `stagedRows`（status 里标记为暂存区一侧）为准，避免 `live.staged` 与索引不同步时出现「上下都有」 */
    const sr = stagedRows.value.find((r) => pathsMatchAmend(r.path, ar.path))
    if (sr) {
      /**
       * `git restore --staged --source=HEAD^` 后常见 MM：索引相对 HEAD、工作区相对索引都有差，
       * simple-git 会 `staged && unstaged` 同时为 true，同一文件会占上下两栏。修订时从 HEAD 取消暂存
       * 应只在「未暂存」呈现（与 Fork 等一致）；纯部分暂存同文件的边角情况较少见。
       */
      const inAmend = amendKeys.has(pathForCommitTreeLayout(ar.path))
      if (inAmend && sr.staged && sr.unstaged) {
        continue
      }
      out.push({
        ...ar,
        label: sr.label,
        index: sr.index,
        workingDir: sr.workingDir,
        unstaged: sr.unstaged
      })
      continue
    }
    const live = fileRowMatchingAmendPath(ar.path, fileRows.value)
    if (!live) {
      out.push(ar)
      continue
    }
    // 在 status 中但已不在暂存区：取消暂存后只显示在未暂存列表
  }

  for (const sr of stagedRows.value) {
    const k = pathForCommitTreeLayout(sr.path)
    if (amendKeys.has(k) && sr.staged && sr.unstaged) {
      continue
    }
    if (!amendKeys.has(k)) {
      out.push(sr)
    }
  }
  return out.sort((a, b) =>
    pathForCommitTreeLayout(a.path).localeCompare(pathForCommitTreeLayout(b.path), undefined, {
      sensitivity: 'base'
    })
  )
}

/** 修订上次提交时展示「将纳入修订的暂存内容」，否则为真实暂存区 */
const displayStagedRows = computed(() => {
  if (commitAmend.value && amendHeadDetail.value?.files?.length) {
    return buildAmendDisplayStagedRows()
  }
  return stagedRows.value
})
const unstagedRows = computed(() => fileRows.value.filter((r) => r.unstaged))

/** 工具栏「暂存」：有未暂存文件且当前多选命中其中至少一条 */
const hasUnstagedSelectionToStage = computed(() => {
  if (!unstagedRows.value.length) return false
  const unstagedSet = new Set(unstagedRows.value.map((r) => r.path))
  return unstagedSelectedPaths.value.some((p) => unstagedSet.has(p))
})

/** 工具栏「取消暂存」：有已暂存文件且当前多选命中其中至少一条 */
const hasStagedSelectionToUnstage = computed(() => {
  if (!displayStagedRows.value.length) return false
  const stagedSet = new Set(displayStagedRows.value.map((r) => r.path))
  return stagedSelectedPaths.value.some((p) => stagedSet.has(p))
})

const filteredUnstagedRows = computed(() => {
  const q = changeFileTreeSearch.value.trim().toLowerCase()
  if (!q) return unstagedRows.value
  return unstagedRows.value.filter((r) => r.path.toLowerCase().includes(q))
})

const filteredStagedRows = computed(() => {
  const q = changeFileTreeSearch.value.trim().toLowerCase()
  if (!q) return displayStagedRows.value
  return displayStagedRows.value.filter((r) => r.path.toLowerCase().includes(q))
})

const unstagedTreeData = computed(() => rowsToPathTree(filteredUnstagedRows.value))
const stagedTreeData = computed(() => rowsToPathTree(filteredStagedRows.value))

function pruneChangeTreeSelections() {
  const us = new Set(filteredUnstagedRows.value.map((r) => r.path))
  const ss = new Set(filteredStagedRows.value.map((r) => r.path))
  unstagedSelectedPaths.value = unstagedSelectedPaths.value.filter((p) => us.has(p))
  stagedSelectedPaths.value = stagedSelectedPaths.value.filter((p) => ss.has(p))
}

watch([filteredUnstagedRows, filteredStagedRows], () => {
  pruneChangeTreeSelections()
})

const selectedChangeFileName = computed(() => {
  const p = selectedPath.value
  return p ? basenameRepo(p) : ''
})

const selectedChangeStatusPresentation = computed(() => {
  void i18n.global.locale.value
  const p = selectedPath.value
  if (!p) return { text: '', kind: 'none' as const }
  if (commitAmend.value && amendHeadDetail.value) {
    const af = amendHeadDetail.value.files.find((f) => f.path === p)
    if (af) {
      const st = af.status.trim().toUpperCase()
      const c0 = st[0] || 'M'
      if (c0 === 'A') return { text: tr('changes.fileStatusAdded'), kind: 'created' as const }
      if (c0 === 'D') return { text: tr('changes.fileStatusDeleted'), kind: 'deleted' as const }
      if (c0 === 'R' || c0 === 'C')
        return { text: tr('changes.fileStatusRenamedCopy'), kind: 'renamed' as const }
      return { text: tr('changes.fileStatusModified'), kind: 'modified' as const }
    }
  }
  const s = status.value
  if (!s) return { text: '', kind: 'none' as const }
  if (s.conflicted.includes(p)) return { text: tr('changes.fileStatusConflict'), kind: 'conflict' as const }
  if (s.not_added.includes(p)) return { text: tr('changes.fileStatusNew'), kind: 'created' as const }
  if (s.created.includes(p)) return { text: tr('changes.fileStatusNew'), kind: 'created' as const }
  if (s.deleted.includes(p)) return { text: tr('changes.fileStatusDeleted'), kind: 'deleted' as const }
  if (s.renamed.some((r) => r.to === p || r.from === p))
    return { text: tr('changes.fileStatusRenamed'), kind: 'renamed' as const }
  if (s.modified.includes(p)) return { text: tr('changes.fileStatusModified'), kind: 'modified' as const }
  return { text: tr('changes.fileStatusChanged'), kind: 'modified' as const }
})

const changeDiffIsBinary = computed(
  () =>
    diffLooksBinary.value || /binary files .+ differ/i.test((diffText.value || '').trim())
)

const selectedWorkingFileSize = ref<number | null>(null)

watch([selectedPath, repoPath], async () => {
  selectedWorkingFileSize.value = null
  const p = selectedPath.value
  if (!p || !repoPath.value) return
  const r = await api.workingFileMeta(p)
  if (!('error' in r)) selectedWorkingFileSize.value = r.size
})

const changeCount = computed(() => fileRows.value.length)

function onUnstagedRowClick(row: Row) {
  selectedDiffScope.value = 'unstaged'
  if (selectedPath.value === row.path) {
    void loadDiff()
    return
  }
  selectedPath.value = row.path
}

function onStagedRowClick(row: Row) {
  selectedDiffScope.value = 'staged'
  if (selectedPath.value === row.path) {
    void loadDiff()
    return
  }
  selectedPath.value = row.path
}

function onUnstagedTreeNodeClick(data: FileTreeNode, _node: unknown, e?: MouseEvent) {
  const t = e?.target as HTMLElement | undefined
  if (t?.closest('.el-tree-node__expand-icon')) return
  if (!data.row || !data.path) return
  const path = data.path
  const ctrl = !!(e?.ctrlKey || e?.metaKey)
  const shift = !!e?.shiftKey

  if (shift) {
    const order = orderedUnstagedTreePaths()
    const anchor = unstagedRangeAnchorPath.value
    const i2 = order.indexOf(path)
    if (i2 < 0) return
    if (anchor == null) {
      unstagedSelectedPaths.value = [path]
      unstagedRangeAnchorPath.value = path
      selectedDiffScope.value = 'unstaged'
      selectedPath.value = path
      void loadDiff()
      return
    }
    const i1 = order.indexOf(anchor)
    if (i1 < 0) {
      unstagedSelectedPaths.value = [path]
      unstagedRangeAnchorPath.value = path
      selectedDiffScope.value = 'unstaged'
      selectedPath.value = path
      void loadDiff()
      return
    }
    const a = Math.min(i1, i2)
    const b = Math.max(i1, i2)
    unstagedSelectedPaths.value = order.slice(a, b + 1)
    selectedDiffScope.value = 'unstaged'
    selectedPath.value = path
    void loadDiff()
    return
  }

  if (ctrl) {
    const set = new Set(unstagedSelectedPaths.value)
    if (set.has(path)) set.delete(path)
    else set.add(path)
    unstagedSelectedPaths.value = [...set]
    unstagedRangeAnchorPath.value = path
    selectedDiffScope.value = 'unstaged'
    selectedPath.value = set.has(path) ? path : [...set][0] ?? null
    if (selectedPath.value) void loadDiff()
    return
  }

  unstagedSelectedPaths.value = [path]
  unstagedRangeAnchorPath.value = path
  selectedDiffScope.value = 'unstaged'
  selectedPath.value = path
  if (unstagedTreeClickTimer) clearTimeout(unstagedTreeClickTimer)
  unstagedTreeClickTimer = setTimeout(() => {
    unstagedTreeClickTimer = null
    onUnstagedRowClick(data.row!)
  }, 220)
}

function onStagedTreeNodeClick(data: FileTreeNode, _node: unknown, e?: MouseEvent) {
  const t = e?.target as HTMLElement | undefined
  if (t?.closest('.el-tree-node__expand-icon')) return
  if (!data.row || !data.path) return
  const path = data.path
  const ctrl = !!(e?.ctrlKey || e?.metaKey)
  const shift = !!e?.shiftKey

  if (shift) {
    const order = orderedStagedTreePaths()
    const anchor = stagedRangeAnchorPath.value
    const i2 = order.indexOf(path)
    if (i2 < 0) return
    if (anchor == null) {
      stagedSelectedPaths.value = [path]
      stagedRangeAnchorPath.value = path
      selectedDiffScope.value = 'staged'
      selectedPath.value = path
      void loadDiff()
      return
    }
    const i1 = order.indexOf(anchor)
    if (i1 < 0) {
      stagedSelectedPaths.value = [path]
      stagedRangeAnchorPath.value = path
      selectedDiffScope.value = 'staged'
      selectedPath.value = path
      void loadDiff()
      return
    }
    const a = Math.min(i1, i2)
    const b = Math.max(i1, i2)
    stagedSelectedPaths.value = order.slice(a, b + 1)
    selectedDiffScope.value = 'staged'
    selectedPath.value = path
    void loadDiff()
    return
  }

  if (ctrl) {
    const set = new Set(stagedSelectedPaths.value)
    if (set.has(path)) set.delete(path)
    else set.add(path)
    stagedSelectedPaths.value = [...set]
    stagedRangeAnchorPath.value = path
    selectedDiffScope.value = 'staged'
    selectedPath.value = set.has(path) ? path : [...set][0] ?? null
    if (selectedPath.value) void loadDiff()
    return
  }

  stagedSelectedPaths.value = [path]
  stagedRangeAnchorPath.value = path
  selectedDiffScope.value = 'staged'
  selectedPath.value = path
  if (stagedTreeClickTimer) clearTimeout(stagedTreeClickTimer)
  stagedTreeClickTimer = setTimeout(() => {
    stagedTreeClickTimer = null
    onStagedRowClick(data.row!)
  }, 220)
}

function onUnstagedTreeDblClick(data: FileTreeNode, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (unstagedTreeClickTimer) {
    clearTimeout(unstagedTreeClickTimer)
    unstagedTreeClickTimer = null
  }
  const t = e.target as HTMLElement
  if (t.closest('.el-tree-node__expand-icon')) return
  const paths = collectPathsFromTreeNode(data)
  if (paths.length) void stagePaths(paths)
}

function onStagedTreeDblClick(data: FileTreeNode, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (stagedTreeClickTimer) {
    clearTimeout(stagedTreeClickTimer)
    stagedTreeClickTimer = null
  }
  const t = e.target as HTMLElement
  if (t.closest('.el-tree-node__expand-icon')) return
  const paths = collectPathsFromTreeNode(data)
  if (paths.length) void unstagePaths(paths)
}

function clearHistoryCommitDetail() {
  selectedHistoryHash.value = null
  selectedSidebarRef.value = null
  commitDetail.value = null
  historyCommitDiffText.value = ''
  historyChangeFileSearch.value = ''
  historySnapshotTreeSearch.value = ''
  selectedCommitDiffPath.value = null
  commitOverviewCollapseName.value = ''
  commitSnapshotTreePaths.value = []
  commitSnapshotTreeLoading.value = false
}

async function loadCommitDetailForHash(hash: string, opts?: { keepSidebarRef?: boolean }) {
  if (!opts?.keepSidebarRef) {
    selectedSidebarRef.value = null
  }
  selectedHistoryHash.value = hash
  commitDetail.value = null
  historyCommitDiffText.value = ''
  historyChangeFileSearch.value = ''
  historySnapshotTreeSearch.value = ''
  selectedCommitDiffPath.value = null
  commitOverviewCollapseName.value = ''
  commitDetailLoading.value = true
  const d = await api.commitDetail(hash)
  commitDetailLoading.value = false
  if ('error' in d) {
    ElMessage.error(d.error)
    return
  }
  commitDetail.value = d
}

async function onHistoryRowClick(row: LogEntry) {
  await loadCommitDetailForHash(row.hash)
}

function selectHistoryByHash(hash: string) {
  void loadCommitDetailForHash(hash)
}

async function selectHistoryFromLocalBranch(branchName: string) {
  const n = branchName.trim()
  if (!n) return
  const r = await api.revParse(n)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  selectedSidebarRef.value = { kind: 'branch', name: n }
  activeView.value = 'history'
  await loadCommitDetailForHash(r.hash, { keepSidebarRef: true })
}

async function selectHistoryFromTag(tagName: string) {
  const n = tagName.trim()
  if (!n) return
  /** 附注标签 rev-parse refs/tags/x 得到的是 tag 对象 SHA，与 log 里 %H 不一致；^{commit} 剥到被指向的提交 */
  let r = await api.revParse(`refs/tags/${n}^{commit}`)
  if ('error' in r) {
    r = await api.revParse(`refs/tags/${n}`)
  }
  if ('error' in r) {
    r = await api.revParse(n)
  }
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  selectedSidebarRef.value = { kind: 'tag', name: n }
  activeView.value = 'history'
  await loadCommitDetailForHash(r.hash, { keepSidebarRef: true })
}

async function selectHistoryFromRemoteBranch(remote: string, branch: string) {
  const rm = remote.trim()
  const br = branch.trim()
  if (!rm || !br) return
  const ref = `${rm}/${br}`
  const r = await api.revParse(ref)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  selectedSidebarRef.value = { kind: 'remoteBranch', remote: rm, branch: br }
  activeView.value = 'history'
  await loadCommitDetailForHash(r.hash, { keepSidebarRef: true })
}

async function selectHistoryFromStash(stashIndex: number) {
  const idx = Number(stashIndex)
  if (!Number.isFinite(idx) || idx < 0) return
  const ref = `stash@{${idx}}`
  const r = await api.revParse(ref)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  selectedSidebarRef.value = { kind: 'stash', index: idx }
  activeView.value = 'history'
  await loadCommitDetailForHash(r.hash, { keepSidebarRef: true })
}

async function stagePaths(paths: string[]) {
  if (!paths.length) return
  const r = await api.stage(paths)
  if ('error' in r) ElMessage.error(r.error)
  else if (repoPath.value) broadcastRepoWorkspaceChanged(repoPath.value, 'stage', 'main')
  await loadStatus()
  await loadDiff()
}

async function unstagePaths(paths: string[]) {
  if (!paths.length) return
  const resolved = paths.map((p) => (p.includes(' → ') ? pathForCommitTreeLayout(p) : p))
  const r = await api.unstage(resolved, commitAmend.value ? { amend: true } : undefined)
  if ('error' in r) ElMessage.error(r.error)
  else if (repoPath.value) broadcastRepoWorkspaceChanged(repoPath.value, 'unstage', 'main')
  await loadStatus()
  await loadDiff()
}

async function restoreWorktreePaths(paths: string[]) {
  if (!paths.length) return
  const resolved = paths.map((p) => (p.includes(' → ') ? pathForCommitTreeLayout(p) : p))
  const r = await api.restoreWorktree(resolved)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(i18n.global.t('changes.filesRestored'))
  await refreshAll()
  if (repoPath.value) broadcastRepoWorkspaceChanged(repoPath.value, 'restore', 'main')
}

async function applyChangeDiffLineSelection(
  startLine: number,
  endLine: number,
  mode: 'stage' | 'unstage' | 'discard'
) {
  const p = selectedPath.value
  if (!p || !repoPath.value) return
  if (status.value?.conflicted.includes(p)) {
    ElMessage.warning(i18n.global.t('changes.conflictNoLineOps'))
    return
  }
  if (changeDiffIsBinary.value) {
    ElMessage.warning(i18n.global.t('changes.binaryNoLineOps'))
    return
  }
  const raw = diffText.value
  if (!raw.trim() || raw === EMPTY_DIFF_SENTINEL) return
  if (
    mode === 'discard' &&
    selectedDiffScope.value !== 'unstaged' &&
    selectedDiffScope.value !== 'staged'
  ) {
    ElMessage.warning(i18n.global.t('changes.wrongScopeLineOps'))
    return
  }
  if (mode === 'stage' && selectedDiffScope.value !== 'unstaged') {
    ElMessage.warning(i18n.global.t('changes.wrongScopeLineOps'))
    return
  }
  if (mode === 'unstage' && selectedDiffScope.value !== 'staged') {
    ElMessage.warning(i18n.global.t('changes.wrongScopeLineOps'))
    return
  }
  if (mode === 'discard') {
    try {
      const discardMsg =
        selectedDiffScope.value === 'staged'
          ? i18n.global.t('changes.discardStagedSelectionConfirmMsg')
          : i18n.global.t('changes.discardConfirmMsg')
      await ElMessageBox.confirm(
        discardMsg,
        i18n.global.t('changes.discardConfirmTitle'),
        { type: 'warning', confirmButtonText: i18n.global.t('common.confirm'), cancelButtonText: i18n.global.t('common.cancel') }
      )
    } catch {
      return
    }
  }
  let appliedMeta: { addedContextLines: boolean } | null = null
  let lastApplyErr = ''
  if (mode === 'discard' && selectedDiffScope.value === 'staged') {
    strategies: for (const tune of PATCH_APPLY_STRATEGIES) {
      for (const ctx of LINE_PATCH_CONTEXT_TRY_ORDER) {
        const ex = extractPartialLinePatchForLineRange(raw, startLine, endLine, ctx)
        if (!ex) continue
        const r1 = await api.applyPatch(ex.patch, { cached: true, reverse: true, ...tune })
        if ('error' in r1) {
          lastApplyErr = r1.error
          continue
        }
        const r2 = await api.applyPatch(ex.patch, { cached: false, reverse: true, ...tune })
        if ('error' in r2) {
          const rb = await api.applyPatch(ex.patch, { cached: true, reverse: false, ...tune })
          if ('error' in rb) {
            ElMessage.error(rb.error)
            await refreshAll()
            await loadDiff()
            return
          }
          lastApplyErr = r2.error
          continue
        }
        appliedMeta = { addedContextLines: ex.addedContextLines }
        break strategies
      }
    }
  } else {
    const plMode =
      mode === 'stage' ? 'stage' : mode === 'unstage' ? 'unstage' : 'discard-unstaged'
    const r = await api.partialLineMerge({
      relPath: p,
      diffText: raw,
      startLine,
      endLine,
      mode: plMode
    })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    appliedMeta = { addedContextLines: r.addedContextLines }
  }
  if (!appliedMeta) {
    ElMessage.error(lastApplyErr || i18n.global.t('changes.invalidDiffSelection'))
    return
  }
  if (appliedMeta.addedContextLines) {
    ElMessage.info(i18n.global.t('changes.diffSelectionContextAdded'))
  }
  if (mode === 'discard' && selectedDiffScope.value === 'staged') {
    ElMessage.success(i18n.global.t('changes.lineDiscardStagedOk'))
    await refreshAll()
    await loadDiff()
    return
  }
  const msgKey =
    mode === 'stage' ? 'changes.lineStageOk' : mode === 'unstage' ? 'changes.lineUnstageOk' : 'changes.lineDiscardOk'
  ElMessage.success(i18n.global.t(msgKey))
  await refreshAll()
  await loadDiff()
}

async function stageAllUnstaged() {
  const unstagedSet = new Set(unstagedRows.value.map((r) => r.path))
  const paths = changeCheckedPathsForScope('unstaged').filter((p) => unstagedSet.has(p))
  if (!paths.length) {
    void ElMessageBox.alert(
      i18n.global.t('changes.noPathsChecked'),
      i18n.global.t('changes.stageAll'),
      { type: 'info' }
    )
    return
  }
  await stagePaths(paths)
  clearUnstagedTreeSelection()
}

async function unstageAllStaged() {
  const stagedSet = new Set(displayStagedRows.value.map((r) => r.path))
  const paths = changeCheckedPathsForScope('staged').filter((p) => stagedSet.has(p))
  if (!paths.length) {
    void ElMessageBox.alert(
      i18n.global.t('changes.noPathsChecked'),
      i18n.global.t('changes.unstageAll'),
      { type: 'info' }
    )
    return
  }
  await unstagePaths(paths)
  clearStagedTreeSelection()
}

function validateCommitDraft():
  | { subject: string; body?: string; wasAmend: boolean }
  | null {
  const subject = commitSubject.value.trim()
  if (!subject) {
    ElMessage.warning(tr('ws.commitSubjectRequired'))
    return null
  }
  if (!commitAmend.value && stagedRows.value.length === 0) {
    ElMessage.warning(tr('ws.nothingToCommit'))
    return null
  }
  return {
    subject,
    body: commitDescription.value.trim() || undefined,
    wasAmend: commitAmend.value
  }
}

function resetCommitComposerAfterSuccess() {
  commitFieldsBeforeAmend.value = null
  commitAmend.value = false
  amendHeadDetail.value = null
  commitSubject.value = ''
  commitDescription.value = ''
}

function parseTrackingRef(tracking: string | null | undefined): { remote: string; branch: string } | null {
  const raw = String(tracking ?? '').trim()
  if (!raw) return null
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash >= raw.length - 1) return null
  return {
    remote: raw.slice(0, slash).trim(),
    branch: raw.slice(slash + 1).trim()
  }
}

function resolvePreferredRemoteName(preferred?: string | null): string {
  const names = remotes.value
  const picked = String(preferred ?? '').trim()
  if (picked && names.includes(picked)) return picked
  const trackingRemote = parseTrackingRef(status.value?.tracking)?.remote ?? ''
  if (trackingRemote && names.includes(trackingRemote)) return trackingRemote
  const configured = loadAppSettings().gitDefaultRemoteName.trim()
  if (configured && names.includes(configured)) return configured
  if (names.includes('origin')) return 'origin'
  return names[0] ?? ''
}

function applySelectedRemoteForCurrentRepo(preferred?: string | null) {
  const next = resolvePreferredRemoteName(preferred)
  if (selectedRemote.value === next) return
  selectedRemote.value = next
  persistWorkspaceNow()
}

const preferredRemoteName = computed(() => resolvePreferredRemoteName(selectedRemote.value))

function buildCommitAndPushOpts(): PushOpts | undefined {
  const selected = resolvePreferredRemoteName(selectedRemote.value)
  const current = currentBranch.value.trim()
  const tracking = parseTrackingRef(status.value?.tracking)
  const trackingRemote = tracking?.remote ?? ''
  const trackingBranch = tracking?.branch ?? ''
  const remote = selected || trackingRemote || remotes.value[0] || ''
  if (!remote) return undefined
  if (!current || status.value?.detached) return { remote }
  return {
    remote,
    localBranch: current,
    remoteBranch:
      trackingRemote === remote && trackingBranch && trackingBranch !== current ? trackingBranch : undefined,
    setUpstream: !trackingRemote || (selected ? selected !== trackingRemote : false) || undefined
  }
}

async function pushAfterCommit(): Promise<string | null> {
  loadError.value = null
  syncBusy.value = 'push'
  try {
    const opts = buildCommitAndPushOpts()
    const r = opts ? await api.push(opts) : await api.push()
    return 'error' in r ? r.error : null
  } finally {
    syncBusy.value = null
  }
}

async function doCommit() {
  const draft = validateCommitDraft()
  if (!draft) return
  commitBusy.value = true
  try {
    loadError.value = null
    const r = await api.commit({
      subject: draft.subject,
      body: draft.body,
      amend: draft.wasAmend
    })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    resetCommitComposerAfterSuccess()
    ElMessage.success(draft.wasAmend ? tr('ws.commitAmended') : tr('ws.commitSucceeded'))
    await refreshAll()
    if (repoPath.value) broadcastRepoWorkspaceChanged(repoPath.value, 'commit', 'main')
  } finally {
    commitBusy.value = false
  }
}

async function doCommitAndPush() {
  const draft = validateCommitDraft()
  if (!draft) return
  commitBusy.value = true
  try {
    loadError.value = null
    const r = await api.commit({
      subject: draft.subject,
      body: draft.body,
      amend: draft.wasAmend
    })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    resetCommitComposerAfterSuccess()
    const pushError = await pushAfterCommit()
    await refreshAll()
    if (repoPath.value) {
      broadcastRepoWorkspaceChanged(repoPath.value, pushError ? 'commit' : 'commit-push', 'main')
    }
    if (pushError) {
      ElMessage.error(tr('ws.commitSucceededPushFailed', { error: pushError }))
      return
    }
    ElMessage.success(draft.wasAmend ? tr('ws.commitAndPushAmended') : tr('ws.commitAndPushSucceeded'))
  } finally {
    commitBusy.value = false
  }
}

async function loadDiff() {
  const p = selectedPath.value
  diffText.value = ''
  diffLooksBinary.value = false
  if (!p || !repoPath.value) return
  diffLoading.value = true
  try {
    let raw: string | { error: string }
    if (selectedDiffScope.value === 'staged') {
      const inIndex = stagedRows.value.some(
        (r) => r.path === p || pathForCommitTreeLayout(r.path) === pathForCommitTreeLayout(p)
      )
      if (commitAmend.value && amendHeadDetail.value?.fullHash) {
        raw = inIndex
          ? await api.diffStaged(p, diffOptions.value)
          : await api.commitDiff(amendHeadDetail.value.fullHash, diffOptions.value, p)
      } else {
        raw = await api.diffStaged(p, diffOptions.value)
      }
    } else {
      raw = await api.diff(p, diffOptions.value)
    }
    if (typeof raw !== 'string') {
      diffText.value = formatDiff(raw)
      return
    }
    diffLooksBinary.value = isBinaryDiffOutput(raw)
    diffText.value = diffLooksBinary.value ? '' : formatDiff(raw)
  } finally {
    diffLoading.value = false
  }
}

/** 「变更」「提交」「文件树」标签页下，按当前选中路径加载该文件在本次提交中的 diff */
async function loadCommitDetailDiff() {
  const h = selectedHistoryHash.value
  if (!h) {
    historyCommitDiffText.value = ''
    historyCommitDiffLoading.value = false
    return
  }
  let path: string | null = null
  if (detailTab.value === 'changes' || detailTab.value === 'files') {
    path = selectedCommitDiffPath.value
  } else if (detailTab.value === 'commit') {
    const n = commitOverviewCollapseName.value
    path = n !== '' && n !== undefined && n !== null ? String(n) : null
  } else {
    historyCommitDiffText.value = ''
    historyCommitDiffLoading.value = false
    return
  }
  if (!path) {
    historyCommitDiffText.value = ''
    historyCommitDiffLoading.value = false
    return
  }
  historyCommitDiffLoading.value = true
  historyCommitDiffText.value = ''
  try {
    historyCommitDiffText.value = formatDiff(await api.commitDiff(h, diffOptions.value, path))
  } finally {
    historyCommitDiffLoading.value = false
  }
}

function applyAppSettings(s: PersistedAppSettingsV1) {
  const n = normalizeAppSettings(s)
  setAppLocale(n.uiLocale)
  applyAppTheme(n.theme)
  diffOutputFormat.value = n.diffDefaultFormat
  const ctx = n.diffDefaultContextLines
  diffContextLines.value = ctx
  lastContextLines.value = ctx
  diffIgnoreBlankLines.value = n.diffDefaultIgnoreBlankLines
  diffIgnoreWhitespace.value = n.diffDefaultIgnoreWhitespace
  diffShowFullFile.value = n.diffDefaultShowFullFile
  persistedHistoryMaxCommits.value = n.historyMaxCommits
}

function persistAppSettings(s: PersistedAppSettingsV1) {
  const n = normalizeAppSettings(s)
  const prevMax = persistedHistoryMaxCommits.value
  saveAppSettings(n)
  applyAppSettings(n)
  if (n.historyMaxCommits !== prevMax) {
    historyLogExtra.value = 0
    if (repoPath.value) void loadHistory()
  }
  if (repoPath.value && !selectedRemote.value.trim()) {
    applySelectedRemoteForCurrentRepo()
  }
  if (selectedPath.value) void loadDiff()
  if (selectedHistoryHash.value) void loadCommitDetailDiff()
  ElMessage.success(i18n.global.t('settings.saved'))
  settingsDialogOpen.value = false
}

/** 顶栏开关：固定为浅色 / 深色并写入设置（不再使用「跟随系统」） */
function setHeaderThemeDark(dark: boolean) {
  const cur = loadAppSettings()
  const next = normalizeAppSettings({ ...cur, theme: dark ? 'dark' : 'light' })
  saveAppSettings(next)
  applyAppTheme(next.theme)
}

async function clearPersistedWorkspaceOnly() {
  try {
    await ElMessageBox.confirm(tr('ws.clearWorkspaceConfirm'), tr('ws.clearWorkspaceTitle'), {
      type: 'warning',
      confirmButtonText: tr('ws.clearWorkspaceBtn'),
      cancelButtonText: tr('common.cancel')
    })
  } catch {
    return
  }
  clearPersistedWorkspace()
  repoTabs.value = []
  activeTabId.value = null
  repoDisplayNames.value = {}
  await api.clearRepo()
  repoPath.value = null
  resetWorkspaceState()
  ElMessage.success(tr('ws.workspaceCleared'))
  settingsDialogOpen.value = false
}

function onCommitChangeTreeClick(data: CommitDetailFileTreeNode, _node: unknown, e?: MouseEvent) {
  const t = e?.target as HTMLElement | undefined
  if (t?.closest('.el-tree-node__expand-icon')) return
  if (!data.path || data.children) return
  selectedCommitDiffPath.value = data.path
}

/** Git workspace state — singleton; first useGitWorkspace() registers watchers and lifecycle hooks. */
let _hooksRegistered = false
function registerHooks() {
  let _hydratingFromStorage = false
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  /** 接收 Git MM 等同路径仓库变更，刷新主窗口 */
  let repoSyncInboundChannel: BroadcastChannel | null = null

  function schedulePersistWorkspace() {
    if (_hydratingFromStorage) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistWorkspaceNow()
    }, 280)
  }

  function flushWorkspaceOnUnload() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    persistWorkspaceNow()
  }

  window.addEventListener('beforeunload', flushWorkspaceOnUnload)

  let settingsSyncChannel: BroadcastChannel | null = null

  function onExternalAppSettingsChanged() {
    applyAppSettings(loadAppSettings())
  }

  function onAppSettingsStorageEvent(e: StorageEvent) {
    if (e.key !== APP_SETTINGS_STORAGE_KEY || e.storageArea !== localStorage) return
    onExternalAppSettingsChanged()
  }

  function attachAppSettingsCrossWindowSync() {
    window.addEventListener('storage', onAppSettingsStorageEvent)
    if (typeof BroadcastChannel === 'undefined') return
    try {
      settingsSyncChannel = new BroadcastChannel(APP_SETTINGS_SYNC_CHANNEL)
      settingsSyncChannel.onmessage = () => onExternalAppSettingsChanged()
    } catch {
      settingsSyncChannel = null
    }
  }

  function detachAppSettingsCrossWindowSync() {
    window.removeEventListener('storage', onAppSettingsStorageEvent)
    if (settingsSyncChannel) {
      settingsSyncChannel.close()
      settingsSyncChannel = null
    }
  }

  function applyRepoDisplayNamesFromPersist(data: PersistedWorkspaceV1) {
    const fromTabs: Record<string, string> = {}
    for (const t of data.repoTabs ?? []) {
      const n = normRepoPath(t.path)
      fromTabs[n] = (t.title && String(t.title).trim()) || basenameRepo(t.path)
    }
    repoDisplayNames.value = { ...(data.repoDisplayNames ?? {}), ...fromTabs }
  }

  watch([repoTabs, activeTabId, activeView, repoDisplayNames], schedulePersistWorkspace, { deep: true })

  async function restorePersistedWorkspace(): Promise<boolean> {
    const data = loadPersistedWorkspace()
    if (!data) return false
    applyRepoDisplayNamesFromPersist(data)
    if (!data.repoTabs?.length) return false
    _hydratingFromStorage = true
    try {
      if (data.activeView) {
        activeView.value = data.activeView === 'history' ? 'history' : 'changes'
      }
      repoTabs.value = data.repoTabs.map((t) => {
        const n = normRepoPath(t.path)
        const title =
          (t.title && String(t.title).trim()) ||
          repoDisplayNames.value[n] ||
          basenameRepo(t.path)
        return { ...t, title }
      })
      activeTabId.value =
        data.activeTabId && data.repoTabs.some((t) => t.id === data.activeTabId)
          ? data.activeTabId
          : data.repoTabs[0]!.id

      while (repoTabs.value.length) {
        const id = activeTabId.value ?? repoTabs.value[0]!.id
        const tab = repoTabs.value.find((t) => t.id === id)
        if (!tab) {
          activeTabId.value = repoTabs.value[0]?.id ?? null
          if (!activeTabId.value) break
          continue
        }
        const ok = await switchRepoToTab(tab)
        if (ok) return true
        const i = repoTabs.value.findIndex((t) => t.id === tab.id)
        if (i !== -1) repoTabs.value.splice(i, 1)
        activeTabId.value = repoTabs.value[0]?.id ?? null
        loadError.value = null
      }
      await api.clearRepo()
      resetWorkspaceState()
      return false
    } finally {
      _hydratingFromStorage = false
    }
  }

watch(selectedPath, () => {
  void loadDiff()
})

watch(
  [diffIgnoreBlankLines, diffIgnoreWhitespace, diffContextLines, diffShowFullFile, selectedDiffScope],
  () => {
    if (!selectedPath.value) return
    void loadDiff()
  }
)

watch(commitAmend, async (on) => {
  if (!repoPath.value) return
  if (on) {
    commitFieldsBeforeAmend.value = {
      subject: commitSubject.value,
      description: commitDescription.value
    }
    await runWithGitLoading(tr('ws.loadingAmendPrepare'), async () => {
      const seq = ++amendLoadSeq
      const d = await api.commitDetail('HEAD')
      if (seq !== amendLoadSeq) return
      if ('error' in d) {
        ElMessage.error(d.error)
        commitFieldsBeforeAmend.value = null
        commitAmend.value = false
        return
      }
      amendHeadDetail.value = d
      commitSubject.value = d.subject
      commitDescription.value = d.body ?? ''
    })
  } else {
    amendLoadSeq += 1
    amendHeadDetail.value = null
    const bak = commitFieldsBeforeAmend.value
    commitFieldsBeforeAmend.value = null
    if (bak) {
      commitSubject.value = bak.subject
      commitDescription.value = bak.description
    }
  }
})

watch([changeFileTreeSearch, selectedDiffScope, unstagedRows], () => {
  if (selectedDiffScope.value !== 'unstaged') return
  const list = filteredUnstagedRows.value
  if (!list.length) {
    selectedPath.value = null
    diffText.value = ''
    diffLooksBinary.value = false
    return
  }
  const cur = selectedPath.value
  if (!cur || !list.some((r) => r.path === cur)) {
    selectedPath.value = list[0]!.path
  }
})

watch([filteredStagedRows, selectedDiffScope, displayStagedRows], () => {
  if (selectedDiffScope.value !== 'staged') return
  const list = filteredStagedRows.value
  if (!list.length) {
    // 勾选「修订」后、HEAD 详情尚未返回前，暂存列表可能仍为空；勿清空选中，否则右侧预览与提交区会像整片消失
    if (commitAmend.value && !amendHeadDetail.value) return
    selectedPath.value = null
    diffText.value = ''
    diffLooksBinary.value = false
    return
  }
  const cur = selectedPath.value
  if (!cur || !list.some((r) => r.path === cur)) {
    selectedPath.value = list[0]!.path
  }
})

watch(
  [
    detailTab,
    selectedHistoryHash,
    selectedCommitDiffPath,
    commitOverviewCollapseName,
    diffIgnoreBlankLines,
    diffIgnoreWhitespace,
    diffContextLines,
    diffShowFullFile
  ],
  () => {
    if (!selectedHistoryHash.value) return
    if (detailTab.value === 'changes' || detailTab.value === 'commit' || detailTab.value === 'files') {
      void loadCommitDetailDiff()
    } else {
      historyCommitDiffText.value = ''
      historyCommitDiffLoading.value = false
    }
  }
)

watch([detailTab, selectedHistoryHash, filteredCommitFilesForChangeTab], () => {
  if (detailTab.value !== 'changes' || !selectedHistoryHash.value) return
  const list = filteredCommitFilesForChangeTab.value
  if (!list.length) {
    selectedCommitDiffPath.value = null
    return
  }
  const cur = selectedCommitDiffPath.value
  if (!cur || !list.some((f) => f.path === cur)) {
    selectedCommitDiffPath.value = list[0]!.path
  }
})

watch([detailTab, selectedHistoryHash], async () => {
  if (detailTab.value !== 'files' || !selectedHistoryHash.value) {
    commitSnapshotTreePaths.value = []
    commitSnapshotTreeLoading.value = false
    return
  }
  await loadCommitSnapshotTree(selectedHistoryHash.value)
})

/** 「文件树」标签：选中路径与 `git ls-tree` 快照一致 */
watch([detailTab, selectedHistoryHash, commitSnapshotTreePaths], () => {
  if (detailTab.value !== 'files' || !selectedHistoryHash.value) return
  const paths = commitSnapshotTreePaths.value
  if (!paths.length) {
    selectedCommitDiffPath.value = null
    return
  }
  const cur = selectedCommitDiffPath.value
  if (!cur || !paths.includes(cur)) {
    selectedCommitDiffPath.value = paths[0]!
  }
})

watch(
  () => status.value,
  () => {
    const cur = selectedPath.value
    const inAmendFiles =
      !!cur &&
      commitAmend.value &&
      !!amendHeadDetail.value?.files.some((f) => f.path === cur)
    if (cur && !fileRows.value.some((r) => r.path === cur) && !inAmendFiles) {
      selectedPath.value = fileRows.value[0]?.path ?? null
    }
    const row = selectedPath.value ? fileRows.value.find((r) => r.path === selectedPath.value) : null
    const pathStillAmend =
      !!selectedPath.value &&
      commitAmend.value &&
      !!amendHeadDetail.value?.files.some((f) => f.path === selectedPath.value)
    if (row && !pathStillAmend) {
      if (selectedDiffScope.value === 'staged' && !row.staged && row.unstaged) selectedDiffScope.value = 'unstaged'
      if (selectedDiffScope.value === 'unstaged' && !row.unstaged && row.staged) selectedDiffScope.value = 'staged'
    }
    void loadDiff()
  }
)

watch(activeView, (v) => {
  if (v !== 'history') {
    clearHistoryCommitDetail()
  }
})

/** 仓库定时轮询（页面可见时）；与快照比较，无变更则不更新界面 */
const REPO_POLL_INTERVAL_MS = 30_000
let repoPollTimer: ReturnType<typeof setInterval> | null = null
let foregroundRefreshTimer: ReturnType<typeof setTimeout> | null = null
let unExternalRepoCleanup: (() => void) | undefined

function stopRepoPoll() {
  if (repoPollTimer) {
    clearInterval(repoPollTimer)
    repoPollTimer = null
  }
}

function startRepoPoll() {
  stopRepoPoll()
  if (!repoPath.value) return
  repoPollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (syncBusy.value != null || commitBusy.value || stashBusy.value) return
    void refreshAll()
  }, REPO_POLL_INTERVAL_MS)
}

watch(repoPath, (p) => {
  if (p) startRepoPoll()
  else {
    stopRepoPoll()
    remoteDetails.value = []
    gitTags.value = []
    stashEntries.value = []
    submoduleItems.value = []
  }
})

watch(selectedRemote, (remote) => {
  const id = activeTabId.value
  if (!id) return
  const tab = repoTabs.value.find((t) => t.id === id)
  if (tab) tab.selectedRemote = remote
})

function scheduleForegroundRefresh() {
  if (!repoPath.value) return
  if (syncBusy.value != null || commitBusy.value || stashBusy.value) return
  if (foregroundRefreshTimer) clearTimeout(foregroundRefreshTimer)
  foregroundRefreshTimer = setTimeout(() => {
    foregroundRefreshTimer = null
    void refreshAll()
  }, 400)
}

/** 窗口聚焦或标签页回到前台时主动拉取；防抖避免与 visibility + focus 重复请求 */
function onWindowFocus() {
  if (document.visibilityState !== 'visible') return
  scheduleForegroundRefresh()
}

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  scheduleForegroundRefresh()
}

onMounted(async () => {
  function syncHeaderAppearanceDark() {
    headerAppearanceDark.value = document.documentElement.classList.contains('dark')
  }
  if (themeEffectiveUnsub) themeEffectiveUnsub()
  themeEffectiveUnsub = onThemeEffectiveChange(syncHeaderAppearanceDark)
  applyAppSettings(loadAppSettings())
  attachAppSettingsCrossWindowSync()
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  await refreshRoot()
  unExternalRepoCleanup = window.gitClient.onExternalRepoSet((p: string) => {
    void addOpenedRepo(p)
  })
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      repoSyncInboundChannel = new BroadcastChannel(REPO_WORKSPACE_SYNC_CHANNEL)
      repoSyncInboundChannel.onmessage = (ev: MessageEvent<RepoWorkspaceSyncPayload>) => {
        const d = ev.data
        if (!d || d.type !== 'git-state-changed' || !d.repoRoot) return
        if ((d.origin ?? 'main') === 'main') return
        const cur = repoPath.value
        if (!cur || normRepoPath(cur) !== normRepoPath(d.repoRoot)) return
        void refreshAll()
      }
    } catch {
      repoSyncInboundChannel = null
    }
  }
  const restored = await restorePersistedWorkspace()
  if (restored) {
    startRepoPoll()
    return
  }
  if (repoPath.value) {
    if (!repoTabs.value.length) {
      const id = newTabId()
      const p = repoPath.value
      const n = normRepoPath(p)
      const title = repoDisplayNames.value[n] ?? basenameRepo(p)
      repoTabs.value.push({ id, path: p, title })
      repoDisplayNames.value[n] = title
      activeTabId.value = id
    }
    await loadStatus()
    await loadHistory()
    await loadRemotes()
    await loadSidebarExtra()
    startRepoPoll()
  }
})

onUnmounted(() => {
  unExternalRepoCleanup?.()
  unExternalRepoCleanup = undefined
  if (repoSyncInboundChannel) {
    repoSyncInboundChannel.close()
    repoSyncInboundChannel = null
  }
  detachAppSettingsCrossWindowSync()
  stopRepoPoll()
  if (foregroundRefreshTimer) clearTimeout(foregroundRefreshTimer)
  if (themeEffectiveUnsub) {
    themeEffectiveUnsub()
    themeEffectiveUnsub = null
  }
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('beforeunload', flushWorkspaceOnUnload)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (unstagedTreeClickTimer) clearTimeout(unstagedTreeClickTimer)
  if (stagedTreeClickTimer) clearTimeout(stagedTreeClickTimer)
})
}

export function useGitWorkspace() {
  if (!_hooksRegistered) {
    registerHooks()
    _hooksRegistered = true
  }
  return {
    activateTab,
    activeTabId,
    activeTabModel,
    activeView,
    basenameRepo,
    beforeRepoTabLeave,
    branches,
    canControlWindow,
    headerAppearanceDark,
    setHeaderThemeDark,
    changeCheckedPathsForScope,
    hasStagedSelectionToUnstage,
    hasUnstagedSelectionToStage,
    collectPathsFromTreeNode,
    changeCount,
    changeTreeNodeClass,
    clearHistoryCommitDetail,
    clearStagedTreeSelection,
    clearUnstagedTreeSelection,
    changeDiffIsBinary,
    commitDetail,
    commitDetailLoading,
    commitFileGlyphs,
    commitFilesTreeData,
    commitFilesTreeDataFiltered,
    commitSnapshotTreeLoading,
    commitFilesTreeForChangesTab,
    commitAmend,
    commitBusy,
    commitDescription,
    commitOverviewCollapseName,
    commitSubject,
    recentCommitMessages,
    currentBranch,
    decContextLines,
    detailTab,
    diffContextLines,
    diffHtml,
    diffIgnoreBlankLines,
    diffIgnoreWhitespace,
    diffLoading,
    diffOptions,
    diffOutputFormat,
    diffShowFullFile,
    diffText,
    doCommit,
    doCommitAndPush,
    stageAllUnstaged,
    fetchDialogOpen,
    pullDialogOpen,
    pushDialogOpen,
    stashDialogOpen,
    compareDialogOpen,
    comparePresetFrom,
    comparePresetTo,
    rebaseInteractiveStartDialogOpen,
    pushDeleteBranchDialogOpen,
    reflogDialogOpen,
    worktreeDialogOpen,
    bisectDialogOpen,
    rebaseTodoDialogOpen,
    blameDialogOpen,
    fileHistoryDialogOpen,
    remotePruneDialogOpen,
    lfsToolsDialogOpen,
    settingsDialogOpen,
    stashDetailDialogOpen,
    openStashDetailDialog,
    openSettingsDialog,
    persistAppSettings,
    clearPersistedWorkspaceOnly,
    openBlamePath,
    openFileHistoryPath,
    openCompareDialog,
    openRebaseInteractiveStartDialog,
    openPushDeleteBranchDialog,
    openReflogDialog,
    openWorktreeDialog,
    openBisectDialog,
    openRebaseTodoDialog,
    openBlameDialog,
    openFileHistoryDialog,
    openRemotePruneDialog,
    openLfsToolsDialog,
    checkoutConflictOurs,
    checkoutConflictTheirs,
    openMergetoolForPath,
    runSubmoduleUpdateSync,
    runSubmoduleSync,
    runSubmoduleUpdateRemote,
    runSubmoduleForeachPreset,
    runLfsInstall,
    runLfsPull,
    runPushDeleteBranch,
    runBisectStep,
    cloneDialogOpen,
    cloneUrlInput,
    cloneParentDir,
    cloneFolderName,
    openCloneDialog,
    pickCloneParentDirectory,
    runCloneRepo,
    syncCloneFolderFromUrl,
    tagDeleteDialogOpen,
    tagDeleteTagName,
    tagDeleteAlsoRemote,
    tagDeleteRemotePick,
    openTagDeleteDialog,
    closeTagDeleteDialog,
    confirmTagDelete,
    openFetchSyncDialog,
    openPullSyncDialog,
    openPushSyncDialog,
    openStashSyncDialog,
    openRepoInExplorer,
    openRepoInGitTerminal,
    openGitTerminalWithCommand,
    openSubmoduleInExplorer,
    openSubmoduleInGitTerminal,
    copySubmodulePathToClipboard,
    removeSubmodule,
    runFetch,
    runPull,
    runPush,
    runStashPush,
    quickStashAll,
    dropStash,
    stashApply,
    stashPop,
    mergeIntoHead,
    rebaseOnto,
    cherryPickCommit,
    revertCommit,
    resetToCommit,
    openInteractiveRebaseHint,
    openAddPartialStashHint,
    runMergeContinue,
    runMergeAbort,
    runRebaseContinue,
    runRebaseAbort,
    runRebaseSkip,
    runCherryPickContinue,
    runCherryPickAbort,
    runRevertContinue,
    runRevertAbort,
    filteredBranches,
    localBranchTracking,
    setBranchUpstream,
    prefetchRemoteBranchesForTrackMenu,
    filteredRemoteSidebarBranches,
    remoteDetailsFiltered,
    filteredGitTags,
    filteredStashEntries,
    filteredSubmoduleItems,
    filteredCommitFilesForChangeTab,
    filteredUnstagedRows,
    filteredStagedRows,
    formatDiff,
    gitTags,
    history,
    historyGitgraph,
    displayHistoryGitgraph,
    historySearchLoading,
    runHistoryLogSearch,
    clearHistoryLogSearch,
    historySearchActive,
    historyTotalLogLimit,
    loadMoreHistoryCommits,
    openHostingCompareInBrowser,
    openPartialStashPushInTerminal,
    historyChangeFileSearch,
    historySnapshotTreeSearch,
    historyCommitDiffHtml,
    historyCommitDiffLoading,
    historyCommitDiffText,
    incContextLines,
    lastContextLines,
    loadBranches,
    loadCommitDetailDiff,
    loadDiff,
    loadError,
    loadHistory,
    loadRemotes,
    loadSidebarExtra,
    newTabId,
    normRepoPath,
    onBranchChange,
    onBranchSelect,
    renameLocalBranch,
    deleteLocalBranch,
    onCommitChangeTreeClick,
    onHistoryRowClick,
    selectHistoryByHash,
    selectHistoryFromLocalBranch,
    selectHistoryFromTag,
    selectHistoryFromRemoteBranch,
    selectHistoryFromStash,
    onMenuCommand,
    onStagedTreeDblClick,
    onStagedTreeNodeClick,
    onTabRemove,
    onUnstagedTreeDblClick,
    onUnstagedTreeNodeClick,
    openRepo,
    refreshAll,
    refreshRoot,
    remoteArg,
    remoteDetails,
    remoteSidebarBranches,
    remoteSidebarExpanded,
    remoteSidebarLoadingBranchList,
    copyRemoteFetchUrl,
    applyRemoteRenameSelection,
    fetchRemoteForSidebar,
    loadRemoteBranchesForSidebar,
    removeRemoteFromSidebar,
    toggleRemoteBranchesExpanded,
    remotes,
    repoPath,
    renameActiveRepoTab,
    repoStateFingerprint,
    repoTabs,
    repoTitle,
    resetWorkspaceState,
    selectedChangeFileName,
    selectedChangeStatusPresentation,
    selectedCommitDiffPath,
    selectedDiffScope,
    selectedHistoryHash,
    selectedSidebarRef,
    selectedPath,
    selectedWorkingFileSize,
    selectedRemote,
    preferredRemoteName,
    shortSha,
    sidebarSearch,
    sortedCommitDetailFiles,
    stagePaths,
    stagedRows,
    displayStagedRows,
    unstageAllStaged,
    stagedTreeData,
    stashEntries,
    status,
    statusGlyphsForRow,
    submoduleItems,
    stashBusy,
    switchRepoToTab,
    syncBusy,
    toggleDiffFormat,
    toggleIgnoreBlankLines,
    toggleIgnoreWhitespace,
    toggleShowFullFile,
    changeFileTreeSearch,
    unstagedRows,
    unstagedTreeData,
    unstagePaths,
    restoreWorktreePaths,
    applyChangeDiffLineSelection,
    winClose,
    winMaximize,
    winMinimize
  }
}
