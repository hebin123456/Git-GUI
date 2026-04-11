<script setup lang="ts">
import { Search, FolderOpened, Plus, Minus, Document, View, Fold, ArrowDown } from '@element-plus/icons-vue'
import { ElInput, ElMessage, ElMessageBox, ElTree } from 'element-plus'
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { CHANGES_WORKSPACE_INJECTION_KEY } from '../composables/changesWorkspaceInjection.ts'
import { useDiff2HtmlCopyMenu } from '../composables/useDiff2HtmlCopyMenu.ts'
import { useGitWorkspace, type FileTreeNode } from '../composables/useGitWorkspace.ts'
import { bindDiff2HtmlSideLayoutAndScroll } from '../utils/diff2HtmlSideScrollSync.ts'
import { getDiffTextLineRangeFromDiff2HtmlSelection } from '../utils/diff2htmlSelectionLines.ts'
import HunkStageDialog from './HunkStageDialog.vue'
import ResizableSplit from './common/ResizableSplit.vue'

const { t } = useI18n()

defineProps<{ gitAtHunkRoot?: string | null }>()

const ws = inject(CHANGES_WORKSPACE_INJECTION_KEY, null) ?? useGitWorkspace()
const {
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
  recentCommitMessages,
  status,
  doCommit,
  doCommitAndPush,
  checkoutConflictOurs,
  checkoutConflictTheirs,
  openMergetoolForPath,
  openBlameDialog,
  openFileHistoryDialog,
  openAddPartialStashHint,
  changeCheckedPathsForScope,
  collectPathsFromTreeNode,
  changeTreeNodeClass,
  clearStagedTreeSelection,
  clearUnstagedTreeSelection
} = ws

const {
  diff2htmlCopyMenu,
  onDiff2HtmlContextMenu,
  closeDiff2HtmlCopyMenu,
  confirmCopyDiff2Html
} = useDiff2HtmlCopyMenu()

const hunkStageOpen = ref(false)
const commitMessagePopoverOpen = ref(false)

type TreeInst = InstanceType<typeof ElTree>
type InputInst = InstanceType<typeof ElInput>
const unstagedTreeRef = ref<TreeInst>()
const stagedTreeRef = ref<TreeInst>()
const commitSubjectInputRef = ref<InputInst>()
const diffPreRef = ref<HTMLElement | null>(null)

const fileCtxMenu = ref<{
  visible: boolean
  x: number
  y: number
  scope: 'unstaged' | 'staged'
  /** 在文件行上右键时，对该节点（或目录下全部文件）操作，不依赖多选 */
  ctxNodePaths?: string[] | null
}>({ visible: false, x: 0, y: 0, scope: 'unstaged' })

const diffCtxMenu = ref<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })

const diff2HtmlSelUi = ref<{
  visible: boolean
  startLine: number
  endLine: number
  box: { top: number; left: number; width: number; height: number } | null
  toolbarTop: number
  toolbarLeft: number
}>({
  visible: false,
  startLine: 0,
  endLine: 0,
  box: null,
  toolbarTop: 0,
  toolbarLeft: 0
})

const changeDiff2HtmlHostRef = ref<HTMLElement | null>(null)

function hideDiff2HtmlSelFloat() {
  diff2HtmlSelUi.value = {
    visible: false,
    startLine: 0,
    endLine: 0,
    box: null,
    toolbarTop: 0,
    toolbarLeft: 0
  }
}

function closeCtxMenus() {
  fileCtxMenu.value.visible = false
  diffCtxMenu.value.visible = false
  closeDiff2HtmlCopyMenu()
  hideDiff2HtmlSelFloat()
}

function onGlobalPointerDown(e: MouseEvent) {
  if (e.button !== 0) return
  const t = e.target as Node
  if (t instanceof Element && t.closest('.fork-native-ctx-menu')) return
  if (t instanceof Element && t.closest('.change-diff2html-sel-toolbar')) return
  closeCtxMenus()
}

function clampMenuPos(x: number, y: number): { x: number; y: number } {
  const pad = 8
  const w = 220
  const h = 200
  return {
    x: Math.min(x, window.innerWidth - w - pad),
    y: Math.min(y, window.innerHeight - h - pad)
  }
}

function openFileCtxMenu(e: MouseEvent, scope: 'unstaged' | 'staged') {
  e.preventDefault()
  const p = clampMenuPos(e.clientX, e.clientY)
  diffCtxMenu.value.visible = false
  closeDiff2HtmlCopyMenu()
  fileCtxMenu.value = { visible: true, x: p.x, y: p.y, scope, ctxNodePaths: undefined }
}

function openFileCtxMenuFromNode(e: Event, data: FileTreeNode, scope: 'unstaged' | 'staged') {
  const paths = collectPathsFromTreeNode(data)
  if (!paths.length) return
  e.preventDefault()
  const me = e as MouseEvent
  const p = clampMenuPos(me.clientX, me.clientY)
  diffCtxMenu.value.visible = false
  closeDiff2HtmlCopyMenu()
  fileCtxMenu.value = { visible: true, x: p.x, y: p.y, scope, ctxNodePaths: paths }
}

function pathsForChangeCtxActions(scope: 'unstaged' | 'staged'): string[] {
  const ctx = fileCtxMenu.value.ctxNodePaths
  if (ctx?.length) return [...ctx]
  return changeCheckedPathsForScope(scope)
}

function openDiffCtxMenu(e: MouseEvent) {
  e.preventDefault()
  if (!canLineOpsOnDiff.value) return
  const p = clampMenuPos(e.clientX, e.clientY)
  fileCtxMenu.value.visible = false
  closeDiff2HtmlCopyMenu()
  diffCtxMenu.value = { visible: true, x: p.x, y: p.y }
}

async function ctxStashSelected(scope: 'unstaged' | 'staged') {
  const paths = pathsForChangeCtxActions(scope)
  closeCtxMenus()
  if (!paths.length) {
    ElMessageBox.alert(t('changes.noPathsChecked'), t('changes.ctxStashSelected'), { type: 'info' })
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(t('changes.stashMessagePlaceholder'), t('changes.stashMessageTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputPlaceholder: t('changes.stashMessagePlaceholder')
    })
    await runStashPush({
      message: (value as string)?.trim() || undefined,
      stagedOnly: scope === 'staged',
      paths
    })
    clearUnstagedTreeSelection()
    clearStagedTreeSelection()
  } catch {
    /* cancel */
  }
}

async function ctxStageSelected() {
  const paths = pathsForChangeCtxActions('unstaged')
  closeCtxMenus()
  if (!paths.length) {
    ElMessageBox.alert(t('changes.noPathsChecked'), t('changes.ctxStageSelected'), { type: 'info' })
    return
  }
  await stagePaths(paths)
  clearUnstagedTreeSelection()
}

async function ctxUnstageSelected() {
  const paths = pathsForChangeCtxActions('staged')
  closeCtxMenus()
  if (!paths.length) {
    ElMessageBox.alert(t('changes.noPathsChecked'), t('changes.ctxUnstageSelected'), { type: 'info' })
    return
  }
  await unstagePaths(paths)
  clearStagedTreeSelection()
}

async function ctxDiscardSelectedUnstaged() {
  const paths = pathsForChangeCtxActions('unstaged')
  closeCtxMenus()
  if (!paths.length) {
    ElMessageBox.alert(t('changes.noPathsChecked'), t('changes.ctxDiscardSelected'), { type: 'info' })
    return
  }
  const untracked = new Set(status.value?.not_added ?? [])
  const tracked = paths.filter((p) => !untracked.has(p))
  if (!tracked.length) {
    ElMessageBox.alert(t('changes.discardUntrackedHint'), t('changes.ctxDiscardSelected'), { type: 'info' })
    return
  }
  try {
    await ElMessageBox.confirm(t('changes.discardConfirmMsg'), t('changes.discardConfirmTitle'), {
      type: 'warning',
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  if (tracked.length < paths.length) {
    ElMessage.info(t('changes.discardSkippedUntracked'))
  }
  await restoreWorktreePaths(tracked)
  clearUnstagedTreeSelection()
}

function normNl(s: string) {
  return s.replace(/\r\n/g, '\n')
}

function offsetToLineIndex(s: string, charIndex: number): number {
  if (charIndex <= 0) return 0
  let line = 0
  const end = Math.min(charIndex, s.length)
  for (let i = 0; i < end; i++) {
    if (s[i] === '\n') line++
  }
  return line
}

function getSelectedRangeInPre(pre: HTMLElement, fullText: string): { startLine: number; endLine: number } | null {
  const full = normNl(fullText)
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!pre.contains(range.commonAncestorContainer)) return null
  const preNorm = normNl(pre.innerText || pre.textContent || '')
  if (preNorm !== full) return null

  function textOffsetBeforeNode(root: HTMLElement, node: Node, offsetInNode: number): number {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let total = 0
    let w: Node | null
    while ((w = walker.nextNode())) {
      if (w === node) return total + offsetInNode
      total += w.textContent?.length ?? 0
    }
    return -1
  }

  const startOff = textOffsetBeforeNode(pre, range.startContainer, range.startOffset)
  const endOff = textOffsetBeforeNode(pre, range.endContainer, range.endOffset)
  if (startOff < 0 || endOff < 0) return null
  const lo = Math.min(startOff, endOff)
  const hiExclusive = Math.max(startOff, endOff)
  const hi = Math.max(lo, hiExclusive - 1)
  return { startLine: offsetToLineIndex(full, lo), endLine: offsetToLineIndex(full, hi) }
}

/** 仅当界面展示原始 <pre> diff 时可做行级暂存等（diff2html 视图下无 pre） */
const canLineOpsOnDiff = computed(
  () =>
    !!selectedPath.value &&
    !diffLoading.value &&
    !changeDiffIsBinary.value &&
    !diffHtml.value &&
    !!diffText.value.trim() &&
    diffText.value !== EMPTY_DIFF_SENTINEL &&
    !(status.value?.conflicted ?? []).includes(selectedPath.value || '')
)

/** diff2html 渲染时，用选区映射到 unified diff 行后做行级暂存/丢弃 */
const canLineOpsOnDiff2Html = computed(
  () =>
    !!selectedPath.value &&
    !diffLoading.value &&
    !changeDiffIsBinary.value &&
    !!diffHtml.value &&
    !!diffText.value.trim() &&
    diffText.value !== EMPTY_DIFF_SENTINEL &&
    !(status.value?.conflicted ?? []).includes(selectedPath.value || '')
)

let diff2HtmlSelFloatRaf = 0
function scheduleSyncDiff2HtmlSelFloat() {
  if (diff2HtmlSelFloatRaf) return
  diff2HtmlSelFloatRaf = requestAnimationFrame(() => {
    diff2HtmlSelFloatRaf = 0
    syncDiff2HtmlSelFloatFromSelection()
  })
}

function syncDiff2HtmlSelFloatFromSelection() {
  const host = changeDiff2HtmlHostRef.value
  const root = diff2htmlRootRef.value
  if (!host || !root || !canLineOpsOnDiff2Html.value) {
    hideDiff2HtmlSelFloat()
    return
  }
  const rangeLines = getDiffTextLineRangeFromDiff2HtmlSelection(root, diffText.value)
  if (!rangeLines) {
    hideDiff2HtmlSelFloat()
    return
  }
  const sel = window.getSelection()
  if (!sel?.rangeCount || sel.isCollapsed) {
    hideDiff2HtmlSelFloat()
    return
  }
  const domRange = sel.getRangeAt(0)
  if (!root.contains(domRange.commonAncestorContainer)) {
    hideDiff2HtmlSelFloat()
    return
  }
  const raw = domRange.getBoundingClientRect()
  if (raw.width <= 0 && raw.height <= 0) {
    hideDiff2HtmlSelFloat()
    return
  }
  const hr = host.getBoundingClientRect()
  const inset = 2
  const box = {
    top: raw.top - hr.top - inset,
    left: raw.left - hr.left - inset,
    width: raw.width + inset * 2,
    height: raw.height + inset * 2
  }
  const pad = 6
  const toolbarApproxW = selectedDiffScope.value === 'staged' ? 220 : 168
  const toolbarH = 34
  let toolbarLeft = box.left + box.width - toolbarApproxW - pad
  let toolbarTop = box.top + pad
  if (toolbarLeft < pad) toolbarLeft = pad
  const hostW = host.clientWidth
  const hostH = host.clientHeight
  if (toolbarTop + toolbarH > hostH - pad) {
    toolbarTop = Math.max(pad, box.top + box.height - toolbarH - pad)
  }
  if (toolbarLeft + toolbarApproxW > hostW - pad) {
    toolbarLeft = Math.max(pad, hostW - toolbarApproxW - pad)
  }
  diff2HtmlSelUi.value = {
    visible: true,
    startLine: rangeLines.startLine,
    endLine: rangeLines.endLine,
    box,
    toolbarTop,
    toolbarLeft
  }
}

async function runDiff2HtmlLineOp(mode: 'stage' | 'unstage' | 'discard') {
  const u = diff2HtmlSelUi.value
  if (!u.visible || u.box == null || !canLineOpsOnDiff2Html.value) {
    ElMessageBox.alert(t('changes.invalidDiffSelection'), t('changes.diffSelectionToolbar'), { type: 'info' })
    return
  }
  await applyChangeDiffLineSelection(u.startLine, u.endLine, mode)
  closeCtxMenus()
}

async function runLineOp(mode: 'stage' | 'unstage' | 'discard') {
  const pre = diffPreRef.value
  if (!pre || !canLineOpsOnDiff.value) {
    ElMessageBox.alert(t('changes.sideBySideNoLineOps'), t('changes.diffSelectionToolbar'), { type: 'info' })
    return
  }
  const range = getSelectedRangeInPre(pre, diffText.value)
  if (!range) {
    ElMessageBox.alert(t('changes.invalidDiffSelection'), t('changes.diffSelectionToolbar'), { type: 'info' })
    return
  }
  await applyChangeDiffLineSelection(range.startLine, range.endLine, mode)
  closeCtxMenus()
}

function onDiffPreContextMenu(e: MouseEvent) {
  openDiffCtxMenu(e)
}

const treeLayoutTick = ref(0)
const treeExpandedByDefault = ref(true)

function collapseChangeTrees() {
  treeExpandedByDefault.value = false
  treeLayoutTick.value += 1
}

function expandChangeTrees() {
  treeExpandedByDefault.value = true
  treeLayoutTick.value += 1
}

function fileExtension(p: string | null): string {
  if (!p) return ''
  const base = p.replace(/[/\\]/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return t('changes.bytes', { n: bytes })
  if (bytes < 1024 * 1024) return t('changes.kb', { kb: (bytes / 1024).toFixed(1), n: bytes })
  return t('changes.mb', { mb: (bytes / (1024 * 1024)).toFixed(1), n: bytes })
}

const showBinaryPreview = computed(
  () =>
    !!selectedPath.value &&
    !diffLoading.value &&
    changeDiffIsBinary.value &&
    selectedChangeStatusPresentation.value.kind !== 'deleted'
)

const canSubmitCommit = computed(() => {
  if (commitBusy.value) return false
  if (!commitSubject.value.trim()) return false
  if (commitAmend.value) return true
  return displayStagedRows.value.length > 0
})

function applyRecentCommitMessage(hash: string) {
  const picked = recentCommitMessages.value.find((item) => item.hash === hash)
  if (!picked) return
  commitMessagePopoverOpen.value = false
  commitSubject.value = picked.message
  void nextTick(() => commitSubjectInputRef.value?.focus?.())
}

function onCommitDropdownCommand(cmd: string | number | object) {
  if (cmd === 'commit-and-push') {
    void doCommitAndPush()
  }
}

const canOpenHunkStage = computed(
  () =>
    !!selectedPath.value &&
    (selectedDiffScope.value === 'unstaged' || selectedDiffScope.value === 'staged') &&
    !diffLoading.value &&
    !!diffText.value.trim() &&
    diffText.value !== EMPTY_DIFF_SENTINEL &&
    !changeDiffIsBinary.value
)

const conflictedPaths = computed(() => status.value?.conflicted ?? [])

const changeDiffScrollbarRef = ref<{ wrapRef?: HTMLElement } | null>(null)
const diff2htmlRootRef = ref<HTMLElement | null>(null)
let diff2HtmlSideCleanup: (() => void) | null = null
let diff2HtmlSelFloatScrollCleanup: (() => void) | null = null

function rebindDiff2HtmlSideLayoutAndScroll() {
  diff2HtmlSideCleanup?.()
  diff2HtmlSideCleanup = null
  const root = diff2htmlRootRef.value
  if (!root) return
  const wrap = changeDiffScrollbarRef.value?.wrapRef ?? null
  diff2HtmlSideCleanup = bindDiff2HtmlSideLayoutAndScroll(root, wrap ?? undefined)
}

function rebindDiff2HtmlSelFloatScroll() {
  diff2HtmlSelFloatScrollCleanup?.()
  diff2HtmlSelFloatScrollCleanup = null
  const wrap = changeDiffScrollbarRef.value?.wrapRef
  const root = diff2htmlRootRef.value
  if (!wrap || !root) return
  const sync = () => scheduleSyncDiff2HtmlSelFloat()
  wrap.addEventListener('scroll', sync, { passive: true })
  const cleanups: (() => void)[] = [() => wrap.removeEventListener('scroll', sync)]
  root.querySelectorAll('.d2h-file-side-diff').forEach((el) => {
    el.addEventListener('scroll', sync, { passive: true })
    cleanups.push(() => el.removeEventListener('scroll', sync))
  })
  diff2HtmlSelFloatScrollCleanup = () => {
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
  }
}

function onDocSelectionChange() {
  scheduleSyncDiff2HtmlSelFloat()
}

function onWindowResizeDiff2HtmlFloat() {
  scheduleSyncDiff2HtmlSelFloat()
}

watch(
  () => changeDiffScrollbarRef.value,
  () => {
    void nextTick(() => {
      rebindDiff2HtmlSideLayoutAndScroll()
      rebindDiff2HtmlSelFloatScroll()
    })
  },
  { flush: 'post' }
)

watch([diffHtml, diffOutputFormat, diff2htmlRootRef], () => {
  void nextTick(() => {
    rebindDiff2HtmlSideLayoutAndScroll()
    rebindDiff2HtmlSelFloatScroll()
  })
}, { flush: 'post' })

watch([selectedPath, diffText, diffHtml], () => {
  hideDiff2HtmlSelFloat()
})

onMounted(() => {
  document.addEventListener('mousedown', onGlobalPointerDown, true)
  document.addEventListener('selectionchange', onDocSelectionChange)
  window.addEventListener('resize', onWindowResizeDiff2HtmlFloat, { passive: true })
  void nextTick(() => {
    rebindDiff2HtmlSideLayoutAndScroll()
    rebindDiff2HtmlSelFloatScroll()
  })
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onGlobalPointerDown, true)
  document.removeEventListener('selectionchange', onDocSelectionChange)
  window.removeEventListener('resize', onWindowResizeDiff2HtmlFloat)
  diff2HtmlSideCleanup?.()
  diff2HtmlSideCleanup = null
  diff2HtmlSelFloatScrollCleanup?.()
  diff2HtmlSelFloatScrollCleanup = null
})

const conflictNavIndex = ref(0)

const conflictMarkerIndices = computed(() => {
  const p = selectedPath.value
  if (!p || !status.value?.conflicted.includes(p)) return []
  const t = diffText.value
  if (!t || t === EMPTY_DIFF_SENTINEL) return []
  const lines = t.split('\n')
  const out: number[] = []
  lines.forEach((line, idx) => {
    if (/^<<<<<<< /u.test(line)) out.push(idx)
  })
  return out
})

watch([conflictMarkerIndices, selectedPath], () => {
  conflictNavIndex.value = 0
})

const canJumpConflicts = computed(
  () =>
    conflictMarkerIndices.value.length > 0 &&
    !diffHtml.value &&
    diffOutputFormat.value === 'line-by-line'
)

function jumpConflictStep(dir: number) {
  const arr = conflictMarkerIndices.value
  if (!arr.length) return
  conflictNavIndex.value = (conflictNavIndex.value + dir + arr.length) % arr.length
  const lineIdx = arr[conflictNavIndex.value]!
  void nextTick(() => {
    const wrap = changeDiffScrollbarRef.value?.wrapRef
    if (!wrap) return
    const lh = 17
    wrap.scrollTop = Math.max(0, lineIdx * lh - 48)
  })
}
</script>

<template>
  <!-- 单一根节点：父级 App.vue 的 v-show / fork-main-view 才能生效，避免与历史视图同时出现 -->
  <div class="changes-view-root">
    <ResizableSplit
      class="changes-split"
      storage-key="fork-layout-changes-main"
      :default-primary-percent="26"
      :min-primary-percent="16"
      :max-primary-percent="45"
    >
      <template #left>
        <el-aside class="fork-files change-files-aside">
          <div class="change-files-toolbar">
            <el-input
              v-model="changeFileTreeSearch"
              size="small"
              clearable
              :placeholder="t('changes.filterChangeFiles')"
              class="change-files-search"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <div class="change-files-toolbar-actions">
              <el-button size="small" text class="change-toolbar-btn" :title="t('changes.expandAll')" @click="expandChangeTrees">
                <el-icon :size="16"><View /></el-icon>
              </el-button>
              <el-button size="small" text class="change-toolbar-btn" :title="t('changes.collapseAll')" @click="collapseChangeTrees">
                <el-icon :size="16"><Fold /></el-icon>
              </el-button>
            </div>
          </div>

          <div class="change-files-body">
            <ResizableSplit
              class="change-files-sections-split"
              direction="vertical"
              storage-key="fork-layout-changes-file-sections"
              :default-primary-percent="50"
              :min-primary-percent="22"
              :max-primary-percent="78"
            >
              <template #top>
                <div class="change-section change-section-unstaged" @contextmenu.prevent="openFileCtxMenu($event, 'unstaged')">
                  <div class="change-section-head">
                    <span class="change-section-title">{{ t('changes.unstaged') }}</span>
                    <el-button
                      size="small"
                      :disabled="!hasUnstagedSelectionToStage"
                      @click="() => void stageAllUnstaged()"
                    >
                      {{ t('changes.stageAll') }}
                    </el-button>
                  </div>
                  <el-scrollbar class="change-section-scroll">
                    <el-tree
                      v-if="filteredUnstagedRows.length"
                      ref="unstagedTreeRef"
                      :key="'u-' + treeLayoutTick"
                      :data="unstagedTreeData"
                      node-key="id"
                      :props="{
                        label: 'label',
                        children: 'children',
                        class: (d) => changeTreeNodeClass('unstaged', d as FileTreeNode)
                      }"
                      :default-expand-all="treeExpandedByDefault"
                      class="file-tree change-file-tree"
                      @node-click="(d, _n, _c, e) => onUnstagedTreeNodeClick(d, _n, e)"
                      @node-contextmenu="(e, d) => openFileCtxMenuFromNode(e, d, 'unstaged')"
                    >
                      <template #default="{ data }">
                        <span
                          class="file-tree-node"
                          :title="data.row ? data.row.label : data.label"
                          @dblclick.stop="onUnstagedTreeDblClick(data, $event)"
                        >
                          <span v-if="data.children" class="file-tree-dir-ico">
                            <el-icon><FolderOpened /></el-icon>
                          </span>
                          <span v-else-if="data.row" class="file-tree-glyphs">
                            <template v-for="g in [statusGlyphsForRow(data.row, 'unstaged')]" :key="data.row.path">
                              <span v-if="g.modified" class="glyph-modified">M</span>
                              <template v-else>
                                <el-icon v-if="g.plus" class="glyph-plus">
                                  <Plus />
                                </el-icon>
                                <el-icon v-if="g.minus" class="glyph-minus">
                                  <Minus />
                                </el-icon>
                              </template>
                            </template>
                          </span>
                          <span class="file-tree-label">{{ data.label }}</span>
                        </span>
                      </template>
                    </el-tree>
                    <div v-else class="file-tree-empty">{{
                      changeFileTreeSearch.trim() && unstagedRows.length && !filteredUnstagedRows.length
                        ? t('changes.noFilterMatch')
                        : t('common.none')
                    }}</div>
                  </el-scrollbar>
                </div>
              </template>

              <template #bottom>
                <div class="change-section change-section-staged" @contextmenu.prevent="openFileCtxMenu($event, 'staged')">
                  <div class="change-section-head">
                    <span class="change-section-title">{{ t('changes.staged') }}</span>
                    <el-button
                      size="small"
                      :disabled="!hasStagedSelectionToUnstage"
                      @click="() => void unstageAllStaged()"
                    >
                      {{ t('changes.unstageAll') }}
                    </el-button>
                  </div>
                  <el-scrollbar class="change-section-scroll">
                    <el-tree
                      v-if="filteredStagedRows.length"
                      ref="stagedTreeRef"
                      :key="'s-' + treeLayoutTick"
                      :data="stagedTreeData"
                      node-key="id"
                      :props="{
                        label: 'label',
                        children: 'children',
                        class: (d) => changeTreeNodeClass('staged', d as FileTreeNode)
                      }"
                      :default-expand-all="treeExpandedByDefault"
                      class="file-tree change-file-tree"
                      @node-click="(d, _n, _c, e) => onStagedTreeNodeClick(d, _n, e)"
                      @node-contextmenu="(e, d) => openFileCtxMenuFromNode(e, d, 'staged')"
                    >
                      <template #default="{ data }">
                        <span
                          class="file-tree-node"
                          :title="data.row ? data.row.label : data.label"
                          @dblclick.stop="onStagedTreeDblClick(data, $event)"
                        >
                          <span v-if="data.children" class="file-tree-dir-ico">
                            <el-icon><FolderOpened /></el-icon>
                          </span>
                          <span v-else-if="data.row" class="file-tree-glyphs">
                            <template v-for="g in [statusGlyphsForRow(data.row, 'staged')]" :key="data.row.path">
                              <span v-if="g.modified" class="glyph-modified">M</span>
                              <template v-else>
                                <el-icon v-if="g.plus" class="glyph-plus">
                                  <Plus />
                                </el-icon>
                                <el-icon v-if="g.minus" class="glyph-minus">
                                  <Minus />
                                </el-icon>
                              </template>
                            </template>
                          </span>
                          <span class="file-tree-label">{{ data.label }}</span>
                        </span>
                      </template>
                    </el-tree>
                    <div v-else class="file-tree-empty">{{
                      changeFileTreeSearch.trim() && displayStagedRows.length && !filteredStagedRows.length
                        ? t('changes.noFilterMatch')
                        : t('common.none')
                    }}</div>
                  </el-scrollbar>
                </div>
              </template>
            </ResizableSplit>
          </div>
        </el-aside>
      </template>

      <template #right>
        <!-- 勿用 <main>：外层 App 已是 el-main→<main>，再嵌套 main 违反 HTML5，浏览器会错误拆 DOM 导致整栏白屏 -->
        <div class="fork-diff change-detail-main" role="main">
          <ResizableSplit
            class="change-detail-split"
            direction="vertical"
            storage-key="fork-layout-changes-detail"
            :default-primary-percent="76"
            :min-primary-percent="38"
            :max-primary-percent="90"
          >
            <template #top>
              <div class="change-detail-preview">
                <div v-if="conflictedPaths.length" class="change-conflict-panel">
                  <div class="change-conflict-head">
                    <span class="change-conflict-title">{{ t('changes.conflictTitle', { n: conflictedPaths.length }) }}</span>
                    <span class="change-conflict-hint">
                      {{ t('changes.conflictHint', { marker: t('changes.conflictMarker') }) }}
                    </span>
                  </div>
                  <ul class="change-conflict-list">
                    <li v-for="cp in conflictedPaths" :key="cp" class="change-conflict-row">
                      <span class="change-conflict-path mono" :title="cp">{{ cp }}</span>
                      <span class="change-conflict-actions">
                        <el-button size="small" text type="primary" @click="checkoutConflictOurs(cp)">{{
                          t('changes.checkoutOurs')
                        }}</el-button>
                        <el-button size="small" text type="primary" @click="checkoutConflictTheirs(cp)">{{
                          t('changes.checkoutTheirs')
                        }}</el-button>
                        <el-button size="small" text @click="() => void openMergetoolForPath(cp)">{{
                          t('changes.mergetool')
                        }}</el-button>
                      </span>
                    </li>
                  </ul>
                </div>
        <div class="change-detail-topbar">
          <div class="change-detail-file-head">
            <el-icon class="change-detail-file-ico" :size="20"><Document /></el-icon>
            <span class="change-detail-file-name" :title="selectedPath || ''">{{
              selectedChangeFileName || t('changes.noFileSelected')
            }}</span>
            <span
              v-if="selectedPath && selectedChangeStatusPresentation.text"
              class="change-detail-status"
              :class="'kind-' + selectedChangeStatusPresentation.kind"
            >
              {{ selectedChangeStatusPresentation.text }}
            </span>
          </div>

          <div v-if="selectedPath && !showBinaryPreview" class="change-detail-diff-toolbar">
          <template v-if="canJumpConflicts">
            <span class="change-conflict-jump-label">{{ t('changes.conflictJump') }}</span>
            <el-button size="small" text @click="jumpConflictStep(-1)">{{ t('changes.conflictPrev') }}</el-button>
            <el-button size="small" text @click="jumpConflictStep(1)">{{ t('changes.conflictNext') }}</el-button>
            <span class="change-conflict-jump-pos muted"
              >{{ conflictNavIndex + 1 }} / {{ conflictMarkerIndices.length }}</span
            >
            <el-divider direction="vertical" />
          </template>
          <el-tooltip
            v-else-if="conflictedPaths.length && selectedPath && conflictMarkerIndices.length && !canJumpConflicts"
            :content="t('changes.conflictJumpTooltip')"
            placement="bottom"
          >
            <span class="change-conflict-jump-hint muted">{{ t('changes.conflictJumpNeedLineView') }}</span>
          </el-tooltip>
          <el-button size="small" text type="primary" :disabled="!canOpenHunkStage" @click="hunkStageOpen = true">
            {{ selectedDiffScope === 'staged' ? t('changes.hunkUnstage') : t('changes.hunkStage') }}
          </el-button>
          <el-button size="small" text type="primary" @click="() => void openAddPartialStashHint()">
            {{ t('changes.partialTerminal') }}
          </el-button>
          <el-divider direction="vertical" />
          <el-dropdown trigger="click">
            <el-button size="small" text type="primary">
              {{ t('changes.diffOptions') }}
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="toggleDiffFormat">
                  {{
                    diffOutputFormat === 'side-by-side' ? t('changes.diffLineByLine') : t('changes.diffSideBySide')
                  }}
                </el-dropdown-item>
                <el-dropdown-item @click="toggleIgnoreBlankLines">
                  {{ diffIgnoreBlankLines ? '✓ ' : '' }}{{ t('changes.ignoreBlankLines') }}
                </el-dropdown-item>
                <el-dropdown-item @click="toggleIgnoreWhitespace">
                  {{ diffIgnoreWhitespace ? '✓ ' : '' }}{{ t('changes.ignoreWhitespace') }}
                </el-dropdown-item>
                <el-dropdown-item divided :disabled="!selectedPath || diffShowFullFile" @click="decContextLines">
                  {{ t('changes.lessContext') }}
                </el-dropdown-item>
                <el-dropdown-item :disabled="!selectedPath || diffShowFullFile" @click="incContextLines">
                  {{
                    t('changes.moreContext', {
                      n: diffShowFullFile ? t('changes.contextAll') : diffContextLines
                    })
                  }}
                </el-dropdown-item>
                <el-dropdown-item @click="toggleShowFullFile">
                  {{ diffShowFullFile ? '✓ ' : '' }}{{ t('changes.fullFile') }}
                </el-dropdown-item>
                <el-dropdown-item divided :disabled="!selectedPath" @click="openBlameDialog(selectedPath!)">
                  {{ t('changes.blameFile') }}
                </el-dropdown-item>
                <el-dropdown-item :disabled="!selectedPath" @click="openFileHistoryDialog(selectedPath!)">
                  {{ t('changes.fileHistory') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-text v-if="diffLoading" type="info" size="small">{{ t('common.loading') }}</el-text>
          <el-tag
            v-if="selectedPath"
            size="small"
            effect="plain"
            :type="selectedDiffScope === 'staged' ? 'success' : 'info'"
            class="diff-scope-tag"
          >
            {{ selectedDiffScope === 'staged' ? t('changes.scopeStaged') : t('changes.scopeUnstaged') }}
          </el-tag>
          </div>
        </div>
        <el-scrollbar ref="changeDiffScrollbarRef" class="change-detail-scroll">
          <div v-if="!selectedPath" class="change-detail-placeholder">{{ t('changes.pickFile') }}</div>
          <div v-else-if="diffLoading" class="change-detail-placeholder">{{ t('common.loading') }}</div>
          <div v-else-if="showBinaryPreview" class="change-binary-preview">
            <el-icon class="change-binary-ico" :size="72"><Document /></el-icon>
            <div v-if="fileExtension(selectedPath)" class="change-binary-ext">{{ fileExtension(selectedPath) }}</div>
            <div v-if="selectedWorkingFileSize != null" class="change-binary-size">
              {{ formatFileSize(selectedWorkingFileSize) }}
            </div>
            <div v-else class="change-binary-size muted">{{ t('changes.binaryNoSize') }}</div>
          </div>
          <div v-else-if="diffText === EMPTY_DIFF_SENTINEL" class="change-detail-placeholder">{{ t('changes.noDiff') }}</div>
          <div
            v-else-if="diffHtml"
            ref="changeDiff2HtmlHostRef"
            class="change-diff2html-host"
            @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, diffText)"
            @mouseup="scheduleSyncDiff2HtmlSelFloat"
          >
            <div ref="diff2htmlRootRef" class="diff2html-root" v-html="diffHtml" />
            <div
              v-show="diff2HtmlSelUi.visible && diff2HtmlSelUi.box"
              class="change-diff2html-sel-frame"
              :style="
                diff2HtmlSelUi.box
                  ? {
                      top: diff2HtmlSelUi.box.top + 'px',
                      left: diff2HtmlSelUi.box.left + 'px',
                      width: diff2HtmlSelUi.box.width + 'px',
                      height: diff2HtmlSelUi.box.height + 'px'
                    }
                  : {}
              "
            />
            <div
              v-show="diff2HtmlSelUi.visible"
              class="change-diff2html-sel-toolbar"
              :style="{ top: diff2HtmlSelUi.toolbarTop + 'px', left: diff2HtmlSelUi.toolbarLeft + 'px' }"
              @mousedown.stop
            >
              <button
                v-if="selectedDiffScope === 'unstaged'"
                type="button"
                class="change-diff2html-sel-btn change-diff2html-sel-btn-primary"
                @click="runDiff2HtmlLineOp('stage')"
              >
                {{ t('changes.diff2htmlSelStage') }}
              </button>
              <button
                v-if="selectedDiffScope === 'staged'"
                type="button"
                class="change-diff2html-sel-btn"
                @click="runDiff2HtmlLineOp('unstage')"
              >
                {{ t('changes.diff2htmlSelUnstage') }}
              </button>
              <button
                v-if="selectedDiffScope === 'unstaged'"
                type="button"
                class="change-diff2html-sel-btn change-diff2html-sel-btn-danger"
                @click="runDiff2HtmlLineOp('discard')"
              >
                {{ t('changes.diff2htmlSelDiscard') }}
              </button>
              <button
                v-if="selectedDiffScope === 'staged'"
                type="button"
                class="change-diff2html-sel-btn change-diff2html-sel-btn-danger"
                @click="runDiff2HtmlLineOp('discard')"
              >
                {{ t('changes.diff2htmlSelDiscard') }}
              </button>
            </div>
          </div>
          <!-- diff2html 失败或为空时回退原始 diff；<pre> 才支持右键行级暂存/丢弃 -->
          <pre
            v-else-if="diffText"
            ref="diffPreRef"
            class="diff-pre diff-pre-selectable"
            @contextmenu.prevent="onDiffPreContextMenu"
            >{{ diffText }}</pre
          >
          <div v-else class="change-detail-placeholder">{{ t('changes.noContent') }}</div>
        </el-scrollbar>
              </div>
            </template>
            <template #bottom>
              <div class="change-commit-panel">
                <div class="change-commit-top">
                  <el-input
                    ref="commitSubjectInputRef"
                    v-model="commitSubject"
                    class="change-commit-subject"
                    :placeholder="t('changes.commitSubject')"
                    clearable
                  >
                    <template #append>
                      <el-popover
                        v-model:visible="commitMessagePopoverOpen"
                        trigger="click"
                        placement="bottom-end"
                        :width="380"
                        :teleported="true"
                        :popper-options="{ strategy: 'fixed' }"
                        popper-class="change-commit-message-popper"
                      >
                        <div class="change-commit-message-panel">
                          <div v-if="recentCommitMessages.length" class="change-commit-message-list">
                            <el-scrollbar max-height="320" class="change-commit-message-scroll">
                              <button
                                v-for="item in recentCommitMessages"
                                :key="item.hash"
                                type="button"
                                class="change-commit-message-btn"
                                @click="applyRecentCommitMessage(item.hash)"
                              >
                                <div class="change-commit-message-entry">
                                  <div class="change-commit-message-text">{{ item.message }}</div>
                                  <div class="change-commit-message-meta">{{ item.shortHash }}</div>
                                </div>
                              </button>
                            </el-scrollbar>
                          </div>
                          <div v-else class="change-commit-message-empty">
                            {{ t('changes.commitMessageHistoryEmpty') }}
                          </div>
                        </div>
                        <template #reference>
                          <el-button
                            text
                            class="change-commit-history-btn"
                            :icon="ArrowDown"
                            :title="t('changes.commitMessageHistory')"
                            :aria-label="t('changes.commitMessageHistory')"
                          />
                        </template>
                      </el-popover>
                    </template>
                  </el-input>
                  <el-dropdown
                    split-button
                    type="primary"
                    class="change-commit-split"
                    :loading="commitBusy"
                    :disabled="
                      commitBusy || !canSubmitCommit || (!!status?.isClean && !commitAmend)
                    "
                    @click="doCommit"
                    @command="onCommitDropdownCommand"
                  >
                    {{ t('changes.commit') }}
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="commit-and-push">
                          {{ t('changes.commitAndPush') }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <el-input
                  v-model="commitDescription"
                  type="textarea"
                  :rows="2"
                  resize="none"
                  class="change-commit-body"
                  :placeholder="t('changes.commitBody')"
                />
                <div class="change-commit-footer">
                  <el-checkbox v-model="commitAmend">{{ t('changes.commitAmend') }}</el-checkbox>
                </div>
              </div>
            </template>
          </ResizableSplit>
        </div>
      </template>
    </ResizableSplit>

  <Teleport to="body">
    <div
      v-if="fileCtxMenu.visible"
      class="fork-native-ctx-menu"
      :style="{ left: fileCtxMenu.x + 'px', top: fileCtxMenu.y + 'px' }"
      @contextmenu.prevent
    >
      <button type="button" class="fork-native-ctx-item" @click="ctxStashSelected(fileCtxMenu.scope)">
        {{ t('changes.ctxStashSelected') }}
      </button>
      <button
        v-if="fileCtxMenu.scope === 'unstaged'"
        type="button"
        class="fork-native-ctx-item"
        @click="ctxStageSelected"
      >
        {{ t('changes.ctxStageSelected') }}
      </button>
      <button
        v-if="fileCtxMenu.scope === 'unstaged'"
        type="button"
        class="fork-native-ctx-item fork-native-ctx-danger"
        @click="ctxDiscardSelectedUnstaged"
      >
        {{ t('changes.ctxDiscardSelected') }}
      </button>
      <button
        v-if="fileCtxMenu.scope === 'staged'"
        type="button"
        class="fork-native-ctx-item"
        @click="ctxUnstageSelected"
      >
        {{ t('changes.ctxUnstageSelected') }}
      </button>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="diffCtxMenu.visible"
      class="fork-native-ctx-menu"
      :style="{ left: diffCtxMenu.x + 'px', top: diffCtxMenu.y + 'px' }"
      @contextmenu.prevent
    >
      <button
        v-if="selectedDiffScope === 'unstaged'"
        type="button"
        class="fork-native-ctx-item"
        @click="runLineOp('stage')"
      >
        {{ t('changes.stageSelection') }}
      </button>
      <button
        v-if="selectedDiffScope === 'staged'"
        type="button"
        class="fork-native-ctx-item"
        @click="runLineOp('unstage')"
      >
        {{ t('changes.unstageSelection') }}
      </button>
      <button
        v-if="selectedDiffScope === 'unstaged'"
        type="button"
        class="fork-native-ctx-item fork-native-ctx-danger"
        @click="runLineOp('discard')"
      >
        {{ t('changes.discardSelection') }}
      </button>
      <button
        v-if="selectedDiffScope === 'staged'"
        type="button"
        class="fork-native-ctx-item fork-native-ctx-danger"
        @click="runLineOp('discard')"
      >
        {{ t('changes.discardSelection') }}
      </button>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="diff2htmlCopyMenu.visible"
      class="fork-native-ctx-menu"
      :style="{ left: diff2htmlCopyMenu.x + 'px', top: diff2htmlCopyMenu.y + 'px' }"
      @contextmenu.prevent
    >
      <button type="button" class="fork-native-ctx-item" @click="confirmCopyDiff2Html">
        {{ t('common.copy') }}
      </button>
    </div>
  </Teleport>

  <HunkStageDialog
    v-model="hunkStageOpen"
    :rel-path="selectedPath"
    :scope="selectedDiffScope"
    :git-at-root="gitAtHunkRoot"
  />
  </div>
</template>

<style scoped>
.changes-view-root {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}
.change-conflict-panel {
  flex-shrink: 0;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: 6px;
  background: var(--el-color-warning-light-9);
}
.change-conflict-head {
  margin-bottom: 8px;
}
.change-conflict-title {
  font-weight: 600;
  margin-right: 8px;
}
.change-conflict-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.change-conflict-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.change-conflict-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}
.change-conflict-row:first-of-type {
  border-top: none;
}
.change-conflict-path {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.change-conflict-actions {
  flex-shrink: 0;
}
.mono {
  font-family: ui-monospace, monospace;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.change-conflict-jump-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-right: 2px;
}
.change-conflict-jump-pos {
  margin-left: 4px;
}
.change-conflict-jump-hint {
  font-size: 12px;
  margin-right: 6px;
}
.change-conflict-code {
  font-size: 11px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--el-fill-color);
}
</style>
