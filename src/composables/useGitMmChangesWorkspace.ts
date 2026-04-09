import { ElMessage, ElMessageBox } from 'element-plus'
import { html as diff2htmlHtml } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { i18n } from '../i18n/index.ts'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { REPO_WORKSPACE_SYNC_CHANNEL, type RepoWorkspaceSyncPayload } from '../constants/repoWorkspaceSync.ts'
import { broadcastRepoWorkspaceChanged } from '../utils/repoWorkspaceBroadcast.ts'
import { loadAppSettings } from '../utils/appSettingsStorage.ts'
import { onThemeEffectiveChange } from '../utils/appTheme.ts'
import { isBinaryDiffOutput } from '../utils/binaryDiffDetect.ts'
import { extractPartialLinePatchForLineRange } from '../utils/diffLineRangePatch.ts'
import {
  buildChangeFileRowsFromStatus,
  pathForCommitTreeLayout,
  rowsToPathTreeForChanges,
  statusGlyphsForChangeRow,
  type ChangeFileRow,
  type ChangeFileTreeNode
} from '../utils/changeFileRows.ts'
import type { FileTreeNode } from './useGitWorkspace.ts'
import type { ChangesWorkspaceInjection } from './changesWorkspaceInjection.ts'

const LINE_PATCH_CONTEXT_TRY_ORDER = [0, 1, 2, 3, 4, 5, 7] as const
const PATCH_APPLY_STRATEGIES: readonly { recount?: boolean; ignoreSpaceChange?: boolean }[] = [
  {},
  { recount: true },
  { recount: true, ignoreSpaceChange: true }
]

function tr(key: string, params?: Record<string, unknown>): string {
  return String(i18n.global.t(key, (params ?? {}) as Record<string, unknown>))
}

function basenameRepo(p: string): string {
  const x = p.replace(/[/\\]+$/, '')
  const i = Math.max(x.lastIndexOf('/'), x.lastIndexOf('\\'))
  return i < 0 ? x : x.slice(i + 1)
}

function normRepoPathSync(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function formatDiff(d: string | { error: string }): string {
  return typeof d === 'string' ? d || EMPTY_DIFF_SENTINEL : d.error
}

function isStashNoLocalChangesError(msg: string): boolean {
  const s = msg.toLowerCase()
  if (s.includes('no local changes')) return true
  if (/nothing to stash/i.test(msg)) return true
  if (/没有要保存|沒有要儲存|没有可贮藏|无可贮藏/i.test(msg)) return true
  return false
}

function mergetoolSettingsPayload(): { preset?: string; toolPath?: string } {
  const k = loadAppSettings()
  if (k.mergeToolPreset === 'default' && !k.mergeToolExecutablePath.trim()) return {}
  const o: { preset?: string; toolPath?: string } = { preset: k.mergeToolPreset }
  if (k.mergeToolExecutablePath.trim()) o.toolPath = k.mergeToolExecutablePath.trim()
  return o
}

function collectPathsFromTreeNode(node: ChangeFileTreeNode): string[] {
  if (node.path) return [node.path]
  if (!node.children?.length) return []
  return node.children.flatMap(collectPathsFromTreeNode)
}

/**
 * Git MM 子仓内复用 ChangesView：与主窗口 useGitWorkspace 对齐的字段子集，经 provide 注入。
 */
export function useGitMmChangesWorkspace(repoPath: Ref<string>): ChangesWorkspaceInjection {
  const at = window.gitAt

  const changeFileTreeSearch = ref('')
  const status = ref<import('../types/git-client.ts').GitStatusPlain | null>(null)
  const statusLoading = ref(false)
  const selectedPath = ref<string | null>(null)
  const selectedDiffScope = ref<'unstaged' | 'staged'>('unstaged')
  const diffText = ref('')
  const diffLoading = ref(false)
  const diffLooksBinary = ref(false)

  const diffOutputFormat = ref<'line-by-line' | 'side-by-side'>('side-by-side')
  const diffContextLines = ref(3)
  const lastContextLines = ref(3)
  const diffIgnoreBlankLines = ref(false)
  const diffIgnoreWhitespace = ref(false)
  const diffShowFullFile = ref(false)

  const headerAppearanceDark = ref(false)

  const commitSubject = ref('')
  const commitDescription = ref('')
  const commitAmend = ref(false)
  const commitBusy = ref(false)

  const unstagedSelectedPaths = ref<string[]>([])
  const stagedSelectedPaths = ref<string[]>([])
  const unstagedRangeAnchorPath = ref<string | null>(null)
  const stagedRangeAnchorPath = ref<string | null>(null)

  let unstagedTreeClickTimer: ReturnType<typeof setTimeout> | null = null
  let stagedTreeClickTimer: ReturnType<typeof setTimeout> | null = null

  const selectedWorkingFileSize = ref<number | null>(null)

  const fileRows = computed(() => buildChangeFileRowsFromStatus(status.value))
  const stagedRows = computed(() => fileRows.value.filter((r) => r.staged))
  const unstagedRows = computed(() => fileRows.value.filter((r) => r.unstaged))
  /** 子仓暂不做「修订上次提交」的 HEAD 文件列表覆盖 */
  const displayStagedRows = stagedRows

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

  const unstagedTreeData = computed(() => rowsToPathTreeForChanges(filteredUnstagedRows.value))
  const stagedTreeData = computed(() => rowsToPathTreeForChanges(filteredStagedRows.value))

  function pruneChangeTreeSelections() {
    const us = new Set(filteredUnstagedRows.value.map((r) => r.path))
    const ss = new Set(filteredStagedRows.value.map((r) => r.path))
    unstagedSelectedPaths.value = unstagedSelectedPaths.value.filter((p) => us.has(p))
    stagedSelectedPaths.value = stagedSelectedPaths.value.filter((p) => ss.has(p))
  }

  watch([filteredUnstagedRows, filteredStagedRows], () => {
    pruneChangeTreeSelections()
  })

  const hasUnstagedSelectionToStage = computed(() => {
    if (!unstagedRows.value.length) return false
    const unstagedSet = new Set(unstagedRows.value.map((r) => r.path))
    return unstagedSelectedPaths.value.some((p) => unstagedSet.has(p))
  })

  const hasStagedSelectionToUnstage = computed(() => {
    if (!displayStagedRows.value.length) return false
    const stagedSet = new Set(displayStagedRows.value.map((r) => r.path))
    return stagedSelectedPaths.value.some((p) => stagedSet.has(p))
  })

  function collectFilePathsDfsOrder(nodes: ChangeFileTreeNode[]): string[] {
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

  function statusGlyphsForRow(
    row: ChangeFileRow,
    scope: 'staged' | 'unstaged'
  ): { plus: boolean; minus: boolean; modified: boolean } {
    return statusGlyphsForChangeRow(row, scope)
  }

  function onUnstagedRowClick(row: ChangeFileRow) {
    selectedDiffScope.value = 'unstaged'
    if (selectedPath.value === row.path) {
      void loadDiff()
      return
    }
    selectedPath.value = row.path
  }

  function onStagedRowClick(row: ChangeFileRow) {
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
      onUnstagedRowClick(data.row as ChangeFileRow)
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
      onStagedRowClick(data.row as ChangeFileRow)
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
    const paths = collectPathsFromTreeNode(data as ChangeFileTreeNode)
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
    const paths = collectPathsFromTreeNode(data as ChangeFileTreeNode)
    if (paths.length) void unstagePaths(paths)
  }

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

  const changeDiffIsBinary = computed(
    () => diffLooksBinary.value || /binary files .+ differ/i.test((diffText.value || '').trim())
  )

  const selectedChangeFileName = computed(() => {
    const p = selectedPath.value
    return p ? basenameRepo(p) : ''
  })

  const selectedChangeStatusPresentation = computed(() => {
    void i18n.global.locale.value
    const p = selectedPath.value
    if (!p) return { text: '', kind: 'none' as const }
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

  function notifyMain(reason: string) {
    broadcastRepoWorkspaceChanged(repoPath.value, reason, 'git-mm')
  }

  async function loadStatus() {
    statusLoading.value = true
    try {
      const r = await at.status(repoPath.value)
      if ('error' in r) {
        ElMessage.error(r.error)
        status.value = null
        return
      }
      status.value = r
    } finally {
      statusLoading.value = false
    }
  }

  async function loadDiff() {
    const p = selectedPath.value
    const root = repoPath.value
    diffText.value = ''
    diffLooksBinary.value = false
    if (!p || !root) return
    diffLoading.value = true
    try {
      const raw =
        selectedDiffScope.value === 'staged'
          ? await at.diffStaged(root, p, diffOptions.value)
          : await at.diff(root, p, diffOptions.value)
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

  watch([selectedPath, selectedDiffScope], () => {
    void loadDiff()
  })

  watch(
    () => [repoPath.value, selectedPath.value] as const,
    async () => {
      selectedWorkingFileSize.value = null
      const p = selectedPath.value
      const root = repoPath.value
      if (!p || !root) return
      const r = await at.workingFileMeta(root, p)
      if (!('error' in r)) selectedWorkingFileSize.value = r.size
    }
  )

  async function stagePaths(paths: string[]) {
    if (!paths.length) return
    const r = await at.stage(repoPath.value, paths)
    if ('error' in r) ElMessage.error(r.error)
    else notifyMain('stage')
    await refreshAll()
  }

  async function unstagePaths(paths: string[]) {
    if (!paths.length) return
    const resolved = paths.map((p) => (p.includes(' → ') ? pathForCommitTreeLayout(p) : p))
    const r = await at.unstage(repoPath.value, resolved)
    if ('error' in r) ElMessage.error(r.error)
    else notifyMain('unstage')
    await refreshAll()
  }

  async function stageAllUnstaged() {
    const unstagedSet = new Set(unstagedRows.value.map((r) => r.path))
    const paths = changeCheckedPathsForScope('unstaged').filter((p) => unstagedSet.has(p))
    if (!paths.length) {
      void ElMessageBox.alert(tr('changes.noPathsChecked'), tr('changes.stageAll'), { type: 'info' })
      return
    }
    await stagePaths(paths)
    clearUnstagedTreeSelection()
  }

  async function unstageAllStaged() {
    const stagedSet = new Set(displayStagedRows.value.map((r) => r.path))
    const paths = changeCheckedPathsForScope('staged').filter((p) => stagedSet.has(p))
    if (!paths.length) {
      void ElMessageBox.alert(tr('changes.noPathsChecked'), tr('changes.unstageAll'), { type: 'info' })
      return
    }
    await unstagePaths(paths)
    clearStagedTreeSelection()
  }

  async function restoreWorktreePaths(paths: string[]) {
    if (!paths.length) return
    const resolved = paths.map((p) => (p.includes(' → ') ? pathForCommitTreeLayout(p) : p))
    const r = await at.restoreWorktree(repoPath.value, resolved)
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('changes.filesRestored'))
    await refreshAll()
    notifyMain('restore')
  }

  async function applyChangeDiffLineSelection(
    startLine: number,
    endLine: number,
    mode: 'stage' | 'unstage' | 'discard'
  ) {
    const p = selectedPath.value
    const root = repoPath.value
    if (!p || !root) return
    if (status.value?.conflicted.includes(p)) {
      ElMessage.warning(tr('changes.conflictNoLineOps'))
      return
    }
    if (changeDiffIsBinary.value) {
      ElMessage.warning(tr('changes.binaryNoLineOps'))
      return
    }
    const raw = diffText.value
    if (!raw.trim() || raw === EMPTY_DIFF_SENTINEL) return
    if (
      mode === 'discard' &&
      selectedDiffScope.value !== 'unstaged' &&
      selectedDiffScope.value !== 'staged'
    ) {
      ElMessage.warning(tr('changes.wrongScopeLineOps'))
      return
    }
    if (mode === 'stage' && selectedDiffScope.value !== 'unstaged') {
      ElMessage.warning(tr('changes.wrongScopeLineOps'))
      return
    }
    if (mode === 'unstage' && selectedDiffScope.value !== 'staged') {
      ElMessage.warning(tr('changes.wrongScopeLineOps'))
      return
    }
    if (mode === 'discard') {
      try {
        const discardMsg =
          selectedDiffScope.value === 'staged'
            ? tr('changes.discardStagedSelectionConfirmMsg')
            : tr('changes.discardConfirmMsg')
        await ElMessageBox.confirm(discardMsg, tr('changes.discardConfirmTitle'), {
          type: 'warning',
          confirmButtonText: tr('common.confirm'),
          cancelButtonText: tr('common.cancel')
        })
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
          const r1 = await at.applyPatch(root, ex.patch, { cached: true, reverse: true, ...tune })
          if ('error' in r1) {
            lastApplyErr = r1.error
            continue
          }
          const r2 = await at.applyPatch(root, ex.patch, { cached: false, reverse: true, ...tune })
          if ('error' in r2) {
            const rb = await at.applyPatch(root, ex.patch, { cached: true, reverse: false, ...tune })
            if ('error' in rb) {
              ElMessage.error(rb.error)
              await refreshAll()
              await loadDiff()
              notifyMain('line-patch')
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
      const r = await at.partialLineMerge(root, {
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
      ElMessage.error(lastApplyErr || tr('changes.invalidDiffSelection'))
      return
    }
    if (appliedMeta.addedContextLines) {
      ElMessage.info(tr('changes.diffSelectionContextAdded'))
    }
    if (mode === 'discard' && selectedDiffScope.value === 'staged') {
      ElMessage.success(tr('changes.lineDiscardStagedOk'))
      await refreshAll()
      await loadDiff()
      notifyMain('line-op')
      return
    }
    const msgKey =
      mode === 'stage'
        ? 'changes.lineStageOk'
        : mode === 'unstage'
          ? 'changes.lineUnstageOk'
          : 'changes.lineDiscardOk'
    ElMessage.success(tr(msgKey))
    await refreshAll()
    await loadDiff()
    notifyMain('line-op')
  }

  async function doCommit() {
    const subj = commitSubject.value.trim()
    if (!subj) {
      ElMessage.warning(tr('ws.commitSubjectRequired'))
      return
    }
    if (!commitAmend.value && stagedRows.value.length === 0) {
      ElMessage.warning(tr('ws.nothingToCommit'))
      return
    }
    commitBusy.value = true
    const wasAmend = commitAmend.value
    const r = await at.commit(repoPath.value, {
      subject: subj,
      body: commitDescription.value.trim() || undefined,
      amend: wasAmend
    })
    commitBusy.value = false
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    commitAmend.value = false
    commitSubject.value = ''
    commitDescription.value = ''
    ElMessage.success(wasAmend ? tr('ws.commitAmended') : tr('ws.commitSucceeded'))
    await refreshAll()
    notifyMain('commit')
  }

  async function runStashPush(opts: {
    message?: string
    includeUntracked?: boolean
    stagedOnly?: boolean
    paths?: string[]
  }) {
    const root = repoPath.value
    let r = await at.stashPush(root, opts)
    if ('error' in r && isStashNoLocalChangesError(r.error) && !opts.includeUntracked) {
      r = await at.stashPush(root, { ...opts, includeUntracked: true })
    }
    if ('error' in r && isStashNoLocalChangesError(r.error) && opts.paths?.length && !opts.stagedOnly) {
      r = await at.stashPush(root, { ...opts, stagedOnly: true })
    }
    if ('error' in r && isStashNoLocalChangesError(r.error) && opts.paths?.length && opts.stagedOnly) {
      r = await at.stashPush(root, { stagedOnly: false, paths: undefined, message: opts.message })
    }
    if ('error' in r && isStashNoLocalChangesError(r.error) && !opts.stagedOnly && !opts.paths?.length) {
      r = await at.stashPush(root, { message: opts.message, includeUntracked: opts.includeUntracked, stagedOnly: true })
    }
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    ElMessage.success(tr('changes.stashSaved'))
    await refreshAll()
    notifyMain('stash')
  }

  async function checkoutConflictOurs(relPath: string) {
    const p = String(relPath ?? '').trim()
    if (!p) return
    const r = await at.checkoutOurs(repoPath.value, p)
    if ('error' in r) ElMessage.error(r.error)
    else {
      ElMessage.success(tr('ws.checkoutOursDone'))
      await refreshAll()
      notifyMain('checkout-ours')
    }
  }

  async function checkoutConflictTheirs(relPath: string) {
    const p = String(relPath ?? '').trim()
    if (!p) return
    const r = await at.checkoutTheirs(repoPath.value, p)
    if ('error' in r) ElMessage.error(r.error)
    else {
      ElMessage.success(tr('ws.checkoutTheirsDone'))
      await refreshAll()
      notifyMain('checkout-theirs')
    }
  }

  async function openMergetoolForPath(relPath?: string) {
    const p = relPath != null ? String(relPath).trim() : ''
    const r = await at.mergetool(repoPath.value, p || undefined, mergetoolSettingsPayload())
    if ('error' in r) ElMessage.error(r.error)
    else {
      ElMessage.info(tr('ws.mergetoolLaunched'))
      await refreshAll()
      notifyMain('mergetool')
    }
  }

  async function openBlameDialog(_relPath?: string) {
    const r = await window.gitClient.focusMainWithRepo(repoPath.value)
    if (!r.ok) ElMessage.error(r.error)
    else ElMessage.info(tr('gitMm.openInMainForAdvancedFeatures'))
  }

  async function openFileHistoryDialog(_relPath?: string) {
    const r = await window.gitClient.focusMainWithRepo(repoPath.value)
    if (!r.ok) ElMessage.error(r.error)
    else ElMessage.info(tr('gitMm.openInMainForAdvancedFeatures'))
  }

  async function openAddPartialStashHint() {
    const r = await window.gitClient.focusMainWithRepo(repoPath.value)
    if (!r.ok) ElMessage.error(r.error)
    else ElMessage.info(tr('gitMm.openInMainForAdvancedFeatures'))
  }

  let repoWorkspaceSyncChannel: BroadcastChannel | null = null
  let offTheme: (() => void) | undefined

  async function refreshAll() {
    await loadStatus()
    await loadDiff()
  }

  function initDiffOptsFromSettings() {
    const s = loadAppSettings()
    diffOutputFormat.value = s.diffDefaultFormat
    diffContextLines.value = s.diffDefaultContextLines
    lastContextLines.value = s.diffDefaultContextLines
    diffIgnoreBlankLines.value = s.diffDefaultIgnoreBlankLines
    diffIgnoreWhitespace.value = s.diffDefaultIgnoreWhitespace
    diffShowFullFile.value = s.diffDefaultShowFullFile
  }

  onMounted(() => {
    initDiffOptsFromSettings()
    headerAppearanceDark.value = document.documentElement.classList.contains('dark')
    offTheme = onThemeEffectiveChange(() => {
      headerAppearanceDark.value = document.documentElement.classList.contains('dark')
    })
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        repoWorkspaceSyncChannel = new BroadcastChannel(REPO_WORKSPACE_SYNC_CHANNEL)
        repoWorkspaceSyncChannel.onmessage = (ev: MessageEvent<RepoWorkspaceSyncPayload>) => {
          const d = ev.data
          if (!d || d.type !== 'git-state-changed' || !d.repoRoot) return
          if ((d.origin ?? 'main') === 'git-mm') return
          if (normRepoPathSync(d.repoRoot) !== normRepoPathSync(repoPath.value)) return
          void refreshAll()
        }
      } catch {
        repoWorkspaceSyncChannel = null
      }
    }
  })

  onUnmounted(() => {
    if (repoWorkspaceSyncChannel) {
      repoWorkspaceSyncChannel.close()
      repoWorkspaceSyncChannel = null
    }
    offTheme?.()
  })

  watch(
    () => repoPath.value,
    () => {
      selectedPath.value = null
      void refreshAll()
    },
    { immediate: true }
  )

  const out = {
    changeFileTreeSearch,
    unstagedRows,
    filteredUnstagedRows,
    filteredStagedRows,
    unstagedTreeData,
    displayStagedRows,
    stagedTreeData,
    selectedDiffScope,
    selectedPath,
    onUnstagedTreeNodeClick,
    onStagedTreeNodeClick,
    onUnstagedTreeDblClick,
    onStagedTreeDblClick,
    statusGlyphsForRow,
    diffOutputFormat,
    toggleDiffFormat,
    diffIgnoreBlankLines,
    diffIgnoreWhitespace,
    toggleIgnoreBlankLines,
    toggleIgnoreWhitespace,
    diffContextLines,
    diffShowFullFile,
    decContextLines,
    incContextLines,
    toggleShowFullFile,
    diffLoading,
    diffText,
    diffHtml,
    stageAllUnstaged,
    unstageAllStaged,
    hasUnstagedSelectionToStage,
    hasStagedSelectionToUnstage,
    stagePaths,
    unstagePaths,
    runStashPush,
    restoreWorktreePaths,
    applyChangeDiffLineSelection,
    selectedChangeFileName,
    selectedChangeStatusPresentation,
    changeDiffIsBinary,
    selectedWorkingFileSize,
    commitSubject,
    commitDescription,
    commitAmend,
    commitBusy,
    status,
    statusLoading,
    doCommit,
    checkoutConflictOurs,
    checkoutConflictTheirs,
    openMergetoolForPath,
    openBlameDialog,
    openFileHistoryDialog,
    openAddPartialStashHint,
    changeCheckedPathsForScope,
    collectPathsFromTreeNode: (node: FileTreeNode) =>
      collectPathsFromTreeNode(node as ChangeFileTreeNode),
    changeTreeNodeClass,
    clearStagedTreeSelection,
    clearUnstagedTreeSelection,
    diffOptions,
    refreshAll,
    loadDiff
  }

  return out as unknown as ChangesWorkspaceInjection
}
