<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { html as diff2htmlHtml } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { useDiff2HtmlCopyMenu } from '../composables/useDiff2HtmlCopyMenu.ts'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'
import {
  parseRebaseTodo,
  serializeRebaseTodo,
  REBASE_GRAPH_COMMANDS,
  type RebaseTodoRow
} from '../utils/rebaseTodoModel.ts'

const api = window.gitClient
const { t, locale } = useI18n()

const {
  refreshAll,
  activeView,
  branches,
  selectHistoryByHash,
  compareDialogOpen,
  comparePresetFrom,
  comparePresetTo,
  rebaseInteractiveStartDialogOpen,
  openGitTerminalWithCommand,
  pushDeleteBranchDialogOpen,
  runPushDeleteBranch,
  reflogDialogOpen,
  worktreeDialogOpen,
  bisectDialogOpen,
  rebaseTodoDialogOpen,
  blameDialogOpen,
  fileHistoryDialogOpen,
  remotePruneDialogOpen,
  lfsToolsDialogOpen,
  openBlamePath,
  openFileHistoryPath,
  selectedPath,
  remotes,
  headerAppearanceDark,
  diffOutputFormat
} = useGitWorkspace()

const {
  diff2htmlCopyMenu,
  onDiff2HtmlContextMenu,
  confirmCopyDiff2Html
} = useDiff2HtmlCopyMenu()

/* —— 比对 —— */
const compareFrom = ref('')
const compareTo = ref('')
const compareTripleDot = ref(false)
const compareLoading = ref(false)
const compareDiffText = ref('')

watch(compareDialogOpen, (o) => {
  if (!o) {
    compareDiffText.value = ''
    return
  }
  const pf = comparePresetFrom.value.trim()
  const pt = comparePresetTo.value.trim()
  if (pf || pt) {
    compareFrom.value = pf || 'HEAD~1'
    compareTo.value = pt || 'HEAD'
  } else if (!compareFrom.value.trim() && !compareTo.value.trim()) {
    compareFrom.value = 'HEAD~1'
    compareTo.value = 'HEAD'
  }
})

const compareDiffHtml = computed(() => {
  const t = compareDiffText.value
  if (!t.trim() || t === EMPTY_DIFF_SENTINEL) return ''
  try {
    return (
      diff2htmlHtml(t, {
        outputFormat: diffOutputFormat.value,
        drawFileList: false,
        matching: 'lines',
        colorScheme: headerAppearanceDark.value ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
      })?.trim() || ''
    )
  } catch {
    return ''
  }
})

/* —— 交互式变基起点（终端执行 git rebase -i） —— */
const rebaseInteractiveBase = ref('HEAD~5')
function rebaseInteractiveCommand(): string {
  const b = rebaseInteractiveBase.value.trim() || 'HEAD~1'
  return `git rebase -i ${b}`
}
async function copyRebaseInteractiveCommand() {
  try {
    await navigator.clipboard.writeText(rebaseInteractiveCommand())
    ElMessage.success(t('dialogs.rebaseInteractive.copyOk'))
  } catch {
    ElMessage.error(t('dialogs.rebaseInteractive.copyFail'))
  }
}
async function openRebaseInteractiveInTerminal() {
  await openGitTerminalWithCommand(rebaseInteractiveCommand())
  rebaseInteractiveStartDialogOpen.value = false
}

/* —— 删除远程分支 —— */
const pushDeleteRemote = ref('')
const pushDeleteBranch = ref('')

watch(pushDeleteBranchDialogOpen, (o) => {
  if (!o) return
  pushDeleteRemote.value = remotes.value[0] || ''
  pushDeleteBranch.value = ''
})

async function runCompareDiff() {
  const a = compareFrom.value.trim()
  const b = compareTo.value.trim()
  if (!a || !b) {
    ElMessage.warning(t('dialogs.compare.fillRefs'))
    return
  }
  compareLoading.value = true
  const r = await api.diffRange({ from: a, to: b, tripleDot: compareTripleDot.value })
  compareLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    compareDiffText.value = ''
    return
  }
  compareDiffText.value = (r.text || '').trim() ? r.text : EMPTY_DIFF_SENTINEL
}

/* —— Reflog —— */
const reflogLoading = ref(false)
const reflogEntries = ref<{ ref: string; hash: string; subject: string }[]>([])

watch(reflogDialogOpen, async (o) => {
  if (!o) return
  reflogLoading.value = true
  const r = await api.reflog(150)
  reflogLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    reflogEntries.value = []
    return
  }
  reflogEntries.value = r.entries
})

async function reflogCreateBranch(row: { hash: string }) {
  try {
    const { value } = await ElMessageBox.prompt(t('dialogs.reflog.promptBranch'), t('dialogs.reflog.promptBranchTitle'), {
      inputPattern: /.+/,
      inputErrorMessage: t('dialogs.reflog.branchNameRequired'),
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel')
    })
    const name = String(value).trim()
    const res = await api.branchCreate({ name, startPoint: row.hash, checkoutAfter: false })
    if ('error' in res) {
      ElMessage.error(res.error)
      return
    }
    ElMessage.success(t('dialogs.reflog.branchCreated'))
    await refreshAll()
  } catch {
    /* cancel */
  }
}

async function reflogHardReset(row: { hash: string }) {
  try {
    await ElMessageBox.confirm(
      t('dialogs.reflog.hardResetBody', { short: row.hash.slice(0, 7) }),
      t('dialogs.reflog.hardResetTitle'),
      {
        type: 'error',
        confirmButtonText: t('dialogs.reflog.hardResetConfirm'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  const r = await api.reset({ ref: row.hash, mode: 'hard' })
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.reflog.hardResetOk'))
  reflogDialogOpen.value = false
  await refreshAll()
}

/* —— Worktree —— */
const worktreeLoading = ref(false)
const worktreeRows = ref<{ path: string; head: string; branch: string }[]>([])
const worktreeNewPath = ref('')
const worktreeNewRef = ref('')

watch(worktreeDialogOpen, async (o) => {
  if (!o) return
  await reloadWorktrees()
})

async function reloadWorktrees() {
  worktreeLoading.value = true
  const r = await api.worktreeList()
  worktreeLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    worktreeRows.value = []
    return
  }
  worktreeRows.value = r.worktrees
}

async function addWorktreeSubmit() {
  const r = await api.worktreeAdd({
    workPath: worktreeNewPath.value.trim(),
    ref: worktreeNewRef.value.trim() || undefined
  })
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.worktree.added'))
  worktreeNewPath.value = ''
  worktreeNewRef.value = ''
  await reloadWorktrees()
  await refreshAll()
}

async function removeWorktreeRow(row: { path: string }, force: boolean) {
  const r = await api.worktreeRemove({ workPath: row.path, force })
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.worktree.removed'))
  await reloadWorktrees()
  await refreshAll()
}

/* —— Bisect —— */
const bisectBusy = ref(false)
const bisectGoodInput = ref('')
const bisectBadInput = ref('')

async function bisectRun(action: 'start' | 'good' | 'bad' | 'skip' | 'reset') {
  bisectBusy.value = true
  let r: { ok: true } | { error: string }
  if (action === 'start') r = await api.bisectStart()
  else if (action === 'good') r = await api.bisectGood(bisectGoodInput.value.trim() || undefined)
  else if (action === 'bad') r = await api.bisectBad(bisectBadInput.value.trim() || undefined)
  else if (action === 'skip') r = await api.bisectSkip()
  else r = await api.bisectReset()
  bisectBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.bisect.done'))
  await refreshAll()
}

/* —— Rebase todo —— */
const rebaseTodoText = ref('')
const rebaseTodoLoading = ref(false)
const rebaseTodoUiTab = ref<'text' | 'graph'>('graph')
const rebaseTodoRows = ref<RebaseTodoRow[]>([])

watch(rebaseTodoDialogOpen, async (o) => {
  if (!o) {
    rebaseTodoRows.value = []
    return
  }
  rebaseTodoLoading.value = true
  const r = await api.rebaseTodoRead()
  rebaseTodoLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    rebaseTodoText.value = ''
    rebaseTodoRows.value = []
    return
  }
  rebaseTodoText.value = r.text
  rebaseTodoRows.value = parseRebaseTodo(r.text)
  rebaseTodoUiTab.value = 'graph'
})

watch(rebaseTodoUiTab, (tab, prev) => {
  if (prev === 'text' && tab === 'graph') {
    rebaseTodoRows.value = parseRebaseTodo(rebaseTodoText.value)
  }
  if (prev === 'graph' && tab === 'text') {
    rebaseTodoText.value = serializeRebaseTodo(rebaseTodoRows.value)
  }
})

function moveRebaseRow(i: number, delta: number) {
  const arr = rebaseTodoRows.value
  const j = i + delta
  if (j < 0 || j >= arr.length) return
  const t = arr[i]!
  arr.splice(i, 1)
  arr.splice(j, 0, t)
}

async function saveRebaseTodo() {
  if (rebaseTodoUiTab.value === 'graph') {
    rebaseTodoText.value = serializeRebaseTodo(rebaseTodoRows.value)
  }
  const r = await api.rebaseTodoWrite(rebaseTodoText.value)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.rebaseTodo.saved'))
  rebaseTodoDialogOpen.value = false
}

/* —— Blame —— */
const blamePathInput = ref('')
const blameTextOut = ref('')
const blameLoading = ref(false)

function parseGitBlameLines(
  text: string,
  formatMeta: (date: string, lineNo: string, author: string) => string
): { hash: string; shortHash: string; meta: string; line: string }[] {
  const rows: { hash: string; shortHash: string; meta: string; line: string }[] = []
  for (const raw of text.split('\n')) {
    if (!raw) continue
    const m = raw.match(/^(\^?)([0-9a-f]{7,40})\s+\((.*)\)\s(.*)$/)
    if (!m) continue
    const boundary = m[1] === '^'
    const hashFull = m[2]!
    const inner = m[3]!
    const line = m[4]!
    const tail = inner.match(/^(.*)\s(\d{4}-\d{2}-\d{2})\s(\d+)$/)
    const meta = tail
      ? formatMeta(tail[2]!, tail[3]!, tail[1]!.trim())
      : inner
    rows.push({
      hash: hashFull,
      shortHash: (boundary ? '^' : '') + hashFull.slice(0, 7),
      meta,
      line
    })
  }
  return rows
}

const blameTableRows = computed(() => {
  void locale.value
  return parseGitBlameLines(blameTextOut.value, (date, lineNo, author) =>
    t('dialogs.blame.metaLine', { date, line: lineNo, author })
  )
})

watch(blameDialogOpen, async (o) => {
  if (!o) {
    blameTextOut.value = ''
    return
  }
  blamePathInput.value = openBlamePath.value.trim() || selectedPath.value || ''
  if (blamePathInput.value.trim()) await loadBlame()
  else blameTextOut.value = ''
})

async function loadBlame() {
  const p = blamePathInput.value.trim()
  if (!p) {
    ElMessage.warning(t('dialogs.blame.pathRequired'))
    return
  }
  blameLoading.value = true
  const r = await api.blame(p)
  blameLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    blameTextOut.value = ''
    return
  }
  blameTextOut.value = r.text
}

function jumpToBlameCommit(fullHash: string) {
  selectHistoryByHash(fullHash)
  activeView.value = 'history'
  blameDialogOpen.value = false
}

/* —— Git LFS 管理 —— */
const lfsTrackPattern = ref('')
const lfsUntrackPattern = ref('')
const lfsLsLoading = ref(false)
const lfsActionBusy = ref(false)
const lfsLsLines = ref<string[]>([])

watch(lfsToolsDialogOpen, async (o) => {
  if (!o) return
  lfsTrackPattern.value = ''
  lfsUntrackPattern.value = ''
  await reloadLfsLs()
})

async function reloadLfsLs() {
  lfsLsLoading.value = true
  const r = await api.lfsLsFiles()
  lfsLsLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    lfsLsLines.value = []
    return
  }
  lfsLsLines.value = r.lines
}

async function doLfsTrack() {
  const p = lfsTrackPattern.value.trim()
  if (!p) {
    ElMessage.warning(t('dialogs.lfs.patternTrackRequired'))
    return
  }
  lfsActionBusy.value = true
  const r = await api.lfsTrack(p)
  lfsActionBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.lfs.trackOk'))
  lfsTrackPattern.value = ''
  await reloadLfsLs()
  await refreshAll()
}

async function doLfsUntrack() {
  const p = lfsUntrackPattern.value.trim()
  if (!p) {
    ElMessage.warning(t('dialogs.lfs.patternUntrackRequired'))
    return
  }
  lfsActionBusy.value = true
  const r = await api.lfsUntrack(p)
  lfsActionBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.lfs.untrackOk'))
  lfsUntrackPattern.value = ''
  await reloadLfsLs()
  await refreshAll()
}

/* —— 单文件历史 —— */
const fileHistoryPathInput = ref('')
const fileHistoryEntries = ref<
  { hash: string; shortHash: string; subject: string; date: string; author: string }[]
>([])
const fileHistoryLoading = ref(false)
const fileHistDiffOld = ref('')
const fileHistDiffNew = ref('')
const fileHistDiffText = ref('')
const fileHistDiffLoading = ref(false)

watch(fileHistoryDialogOpen, async (o) => {
  if (!o) {
    fileHistoryEntries.value = []
    return
  }
  fileHistoryPathInput.value = openFileHistoryPath.value.trim() || selectedPath.value || ''
  if (fileHistoryPathInput.value.trim()) await loadFileHistory()
  else fileHistoryEntries.value = []
})

async function loadFileHistory() {
  const p = fileHistoryPathInput.value.trim()
  if (!p) {
    ElMessage.warning(t('dialogs.fileHistory.pathRequired'))
    return
  }
  fileHistoryLoading.value = true
  const r = await api.logFile({ path: p, maxCount: 100 })
  fileHistoryLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    fileHistoryEntries.value = []
    return
  }
  fileHistoryEntries.value = r.entries
  fileHistDiffOld.value = ''
  fileHistDiffNew.value = ''
  fileHistDiffText.value = ''
}

const fileHistDiffHtml = computed(() => {
  const tx = fileHistDiffText.value
  if (!tx.trim() || tx === EMPTY_DIFF_SENTINEL) return ''
  try {
    return (
      diff2htmlHtml(tx, {
        outputFormat: diffOutputFormat.value,
        drawFileList: false,
        matching: 'lines',
        colorScheme: headerAppearanceDark.value ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
      })?.trim() || ''
    )
  } catch {
    return ''
  }
})

function setFileHistDiffMark(which: 'old' | 'new', hash: string) {
  if (which === 'old') fileHistDiffOld.value = hash
  else fileHistDiffNew.value = hash
}

async function runFileHistCommitDiff() {
  const path = fileHistoryPathInput.value.trim()
  const a = fileHistDiffOld.value.trim()
  const b = fileHistDiffNew.value.trim()
  if (!path || !a || !b) {
    ElMessage.warning(t('dialogs.fileHistory.pickOldNew'))
    return
  }
  fileHistDiffLoading.value = true
  const r = await api.diffFileCommits({ from: a, to: b, path })
  fileHistDiffLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    fileHistDiffText.value = ''
    return
  }
  fileHistDiffText.value = (r.text || '').trim() ? r.text : EMPTY_DIFF_SENTINEL
}

function openHistoryCommit(hash: string) {
  activeView.value = 'history'
  selectHistoryByHash(hash)
  fileHistoryDialogOpen.value = false
}

/* —— Remote prune —— */
const pruneRemote = ref('')

watch(remotePruneDialogOpen, (o) => {
  if (!o) return
  pruneRemote.value = remotes.value[0] || ''
})

async function doRemotePrune() {
  const rm = pruneRemote.value.trim()
  if (!rm) {
    ElMessage.warning(t('dialogs.remotePrune.pickRemote'))
    return
  }
  const r = await api.remotePrune(rm)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('dialogs.remotePrune.ok'))
  remotePruneDialogOpen.value = false
  await refreshAll()
}
</script>

<template>
  <el-dialog
    v-model="compareDialogOpen"
    :title="t('dialogs.compare.title')"
    width="min(920px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">
      {{ t('dialogs.compare.hint') }}
    </p>
    <div class="fork-adv-row">
      <el-input v-model="compareFrom" :placeholder="t('dialogs.compare.phFrom')" clearable />
      <el-input v-model="compareTo" :placeholder="t('dialogs.compare.phTo')" clearable />
    </div>
    <el-checkbox v-model="compareTripleDot" class="fork-adv-check">{{ t('dialogs.compare.tripleDot') }}</el-checkbox>
    <div class="fork-adv-actions">
      <el-button type="primary" :loading="compareLoading" @click="runCompareDiff">{{
        t('dialogs.compare.showDiff')
      }}</el-button>
    </div>
    <el-scrollbar max-height="52vh" class="fork-adv-diff-scroll">
      <div v-if="compareLoading" class="fork-adv-placeholder">{{ t('dialogs.loading') }}</div>
      <div
        v-else-if="compareDiffHtml"
        class="diff2html-root"
        v-html="compareDiffHtml"
        @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, compareDiffText)"
      />
      <pre v-else-if="compareDiffText" class="diff-pre fork-adv-pre">{{
        compareDiffText === EMPTY_DIFF_SENTINEL ? t('changes.noDiff') : compareDiffText
      }}</pre>
    </el-scrollbar>
  </el-dialog>

  <el-dialog
    v-model="rebaseInteractiveStartDialogOpen"
    :title="t('dialogs.rebaseInteractive.title')"
    width="520px"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">
      {{ t('dialogs.rebaseInteractive.hint') }}
    </p>
    <el-input v-model="rebaseInteractiveBase" :placeholder="t('dialogs.rebaseInteractive.phBase')" clearable />
    <p class="fork-adv-cmd mono">{{ rebaseInteractiveCommand() }}</p>
    <template #footer>
      <el-button @click="copyRebaseInteractiveCommand">{{ t('dialogs.rebaseInteractive.copyCmd') }}</el-button>
      <el-button type="primary" @click="openRebaseInteractiveInTerminal">{{
        t('dialogs.rebaseInteractive.runInTerminal')
      }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="pushDeleteBranchDialogOpen"
    :title="t('ws.pushDeleteBranchTitle')"
    width="440px"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">{{ t('dialogs.pushDelete.hint') }}</p>
    <el-select v-model="pushDeleteRemote" filterable :placeholder="t('dialogs.pushDelete.phRemote')" class="fork-adv-full">
      <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
    </el-select>
    <el-input
      v-model="pushDeleteBranch"
      class="fork-adv-mt"
      :placeholder="t('dialogs.pushDelete.phBranch')"
      clearable
    />
    <template #footer>
      <el-button
        type="danger"
        :disabled="!pushDeleteRemote.trim() || !pushDeleteBranch.trim()"
        @click="runPushDeleteBranch(pushDeleteRemote, pushDeleteBranch)"
      >
        {{ t('common.delete') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="reflogDialogOpen"
    :title="t('dialogs.reflog.title')"
    width="min(800px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">{{ t('dialogs.reflog.hint') }}</p>
    <el-table v-loading="reflogLoading" :data="reflogEntries" size="small" max-height="420" stripe>
      <el-table-column prop="ref" :label="t('dialogs.reflog.colRef')" width="100" class-name="mono" />
      <el-table-column prop="hash" :label="t('dialogs.reflog.colHash')" width="120">
        <template #default="{ row }">
          <span class="mono">{{ row.hash.slice(0, 7) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="subject" :label="t('dialogs.reflog.colSubject')" min-width="200" show-overflow-tooltip />
      <el-table-column :label="t('dialogs.reflog.colActions')" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="reflogCreateBranch(row)">{{
            t('dialogs.reflog.newBranch')
          }}</el-button>
          <el-button link type="danger" size="small" @click="reflogHardReset(row)">{{
            t('dialogs.reflog.hardReset')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>

  <el-dialog
    v-model="worktreeDialogOpen"
    :title="t('dialogs.worktree.title')"
    width="min(720px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">{{ t('dialogs.worktree.hint') }}</p>
    <el-table v-loading="worktreeLoading" :data="worktreeRows" size="small" max-height="240" stripe>
      <el-table-column prop="path" :label="t('dialogs.worktree.colPath')" min-width="200" show-overflow-tooltip />
      <el-table-column prop="branch" :label="t('dialogs.worktree.colBranch')" width="160" show-overflow-tooltip />
      <el-table-column prop="head" :label="t('dialogs.worktree.colHead')" width="120">
        <template #default="{ row }">
          <span class="mono">{{ row.head.slice(0, 7) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" size="small" @click="removeWorktreeRow(row, false)">{{
            t('dialogs.worktree.remove')
          }}</el-button>
          <el-button link type="danger" size="small" @click="removeWorktreeRow(row, true)">{{
            t('dialogs.worktree.force')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-divider content-position="left">{{ t('dialogs.worktree.addSection') }}</el-divider>
    <div class="fork-adv-row">
      <el-input v-model="worktreeNewPath" :placeholder="t('dialogs.worktree.phNewPath')" clearable />
      <el-select
        v-model="worktreeNewRef"
        filterable
        allow-create
        clearable
        :placeholder="t('dialogs.worktree.phRef')"
      >
        <el-option v-for="b in branches" :key="b" :label="b" :value="b" />
      </el-select>
    </div>
    <template #footer>
      <el-button type="primary" :disabled="!worktreeNewPath.trim()" @click="addWorktreeSubmit">{{
        t('dialogs.worktree.addSubmit')
      }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="bisectDialogOpen"
    :title="t('dialogs.bisect.title')"
    width="480px"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">
      {{ t('dialogs.bisect.hint') }}
    </p>
    <div class="fork-adv-bisect-actions">
      <el-button :loading="bisectBusy" @click="bisectRun('start')">{{ t('dialogs.bisect.start') }}</el-button>
      <el-button :loading="bisectBusy" @click="bisectRun('reset')">{{ t('dialogs.bisect.resetEnd') }}</el-button>
    </div>
    <el-divider />
    <div class="fork-adv-row">
      <el-input v-model="bisectBadInput" :placeholder="t('dialogs.bisect.phBad')" clearable />
      <el-button :loading="bisectBusy" type="danger" plain @click="bisectRun('bad')">{{
        t('dialogs.bisect.markBad')
      }}</el-button>
    </div>
    <div class="fork-adv-row">
      <el-input v-model="bisectGoodInput" :placeholder="t('dialogs.bisect.phGood')" clearable />
      <el-button :loading="bisectBusy" type="success" plain @click="bisectRun('good')">{{
        t('dialogs.bisect.markGood')
      }}</el-button>
    </div>
    <el-button :loading="bisectBusy" class="fork-adv-skip" @click="bisectRun('skip')">{{
      t('dialogs.bisect.skipCurrent')
    }}</el-button>
  </el-dialog>

  <el-dialog
    v-model="rebaseTodoDialogOpen"
    :title="t('dialogs.rebaseTodo.title')"
    width="min(800px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">
      {{ t('dialogs.rebaseTodo.hint') }}
    </p>
    <el-radio-group v-model="rebaseTodoUiTab" size="small" class="fork-rebase-todo-mode">
      <el-radio-button value="graph">{{ t('dialogs.rebaseTodo.modeGraph') }}</el-radio-button>
      <el-radio-button value="text">{{ t('dialogs.rebaseTodo.modeText') }}</el-radio-button>
    </el-radio-group>
    <el-skeleton v-if="rebaseTodoLoading" :rows="6" animated />
    <template v-else-if="rebaseTodoUiTab === 'graph'">
      <el-scrollbar max-height="52vh" class="fork-rebase-graph-scroll">
        <div v-for="(row, idx) in rebaseTodoRows" :key="row.id" class="fork-rebase-graph-row">
          <template v-if="row.kind === 'commit'">
            <el-select v-model="row.command" size="small" class="fork-rebase-cmd">
              <el-option v-for="c in REBASE_GRAPH_COMMANDS" :key="c" :label="c" :value="c" />
            </el-select>
            <span class="mono fork-rebase-hash">{{ row.hash.slice(0, 7) }}</span>
            <el-input v-model="row.subject" size="small" class="fork-rebase-subj" :placeholder="t('dialogs.rebaseTodo.phSubject')" />
            <el-button-group class="fork-rebase-move">
              <el-button size="small" :disabled="idx === 0" @click="moveRebaseRow(idx, -1)">↑</el-button>
              <el-button
                size="small"
                :disabled="idx >= rebaseTodoRows.length - 1"
                @click="moveRebaseRow(idx, 1)"
                >↓</el-button
              >
            </el-button-group>
          </template>
          <template v-else-if="row.kind === 'exec'">
            <el-tag size="small" type="info">exec</el-tag>
            <el-input v-model="row.body" size="small" class="fork-rebase-exec" />
          </template>
          <template v-else-if="row.kind === 'break'">
            <el-tag size="small" type="warning">break</el-tag>
          </template>
          <template v-else-if="row.kind === 'comment'">
            <el-input v-model="row.text" size="small" class="fork-rebase-comment" />
          </template>
          <template v-else>
            <el-input v-model="row.text" size="small" class="fork-rebase-raw" :placeholder="t('dialogs.rebaseTodo.phRawLine')" />
          </template>
        </div>
      </el-scrollbar>
    </template>
    <el-input
      v-else
      v-model="rebaseTodoText"
      type="textarea"
      :rows="16"
      class="fork-adv-todo"
      spellcheck="false"
    />
    <template #footer>
      <el-button :disabled="rebaseTodoLoading" type="primary" @click="saveRebaseTodo">{{
        t('dialogs.rebaseTodo.save')
      }}</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="blameDialogOpen"
    :title="t('dialogs.blame.title')"
    width="min(900px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="fork-adv-row">
      <el-input v-model="blamePathInput" :placeholder="t('dialogs.blame.phPath')" clearable />
      <el-button type="primary" :loading="blameLoading" @click="loadBlame">{{ t('dialogs.blame.load') }}</el-button>
    </div>
    <el-scrollbar max-height="60vh">
      <el-skeleton v-if="blameLoading" :rows="8" animated />
      <el-table
        v-else-if="blameTableRows.length"
        :data="blameTableRows"
        size="small"
        stripe
        class="fork-adv-blame-table"
        max-height="56vh"
      >
        <el-table-column prop="shortHash" :label="t('dialogs.blame.colCommit')" width="100" class-name="mono">
          <template #default="{ row }">
            <el-button link type="primary" class="mono" @click="jumpToBlameCommit(row.hash)">
              {{ row.shortHash }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="meta" :label="t('dialogs.blame.colMeta')" min-width="200" show-overflow-tooltip />
        <el-table-column prop="line" :label="t('dialogs.blame.colLine')" min-width="240" show-overflow-tooltip />
      </el-table>
      <pre v-else class="diff-pre fork-adv-pre">{{ blameTextOut || t('dialogs.blame.empty') }}</pre>
    </el-scrollbar>
  </el-dialog>

  <el-dialog
    v-model="lfsToolsDialogOpen"
    :title="t('dialogs.lfs.title')"
    width="min(640px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">
      {{ t('dialogs.lfs.hint') }}
    </p>
    <div class="fork-adv-row">
      <el-input v-model="lfsTrackPattern" :placeholder="t('dialogs.lfs.phTrack')" clearable />
      <el-button type="primary" :loading="lfsActionBusy" @click="doLfsTrack">{{ t('dialogs.lfs.trackBtn') }}</el-button>
    </div>
    <div class="fork-adv-row">
      <el-input v-model="lfsUntrackPattern" :placeholder="t('dialogs.lfs.phUntrack')" clearable />
      <el-button :loading="lfsActionBusy" @click="doLfsUntrack">{{ t('dialogs.lfs.untrackBtn') }}</el-button>
    </div>
    <el-divider content-position="left">{{ t('dialogs.lfs.dividerLs') }}</el-divider>
    <div class="fork-adv-row">
      <el-button size="small" :loading="lfsLsLoading" @click="reloadLfsLs">{{ t('dialogs.lfs.refreshList') }}</el-button>
    </div>
    <el-skeleton v-if="lfsLsLoading" :rows="6" animated />
    <el-scrollbar v-else max-height="36vh">
      <pre class="diff-pre fork-adv-pre">{{
        lfsLsLines.length ? lfsLsLines.join('\n') : t('dialogs.lfs.emptyList')
      }}</pre>
    </el-scrollbar>
  </el-dialog>

  <el-dialog
    v-model="fileHistoryDialogOpen"
    :title="t('dialogs.fileHistory.title')"
    width="min(760px, 96vw)"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="fork-adv-row">
      <el-input v-model="fileHistoryPathInput" :placeholder="t('dialogs.fileHistory.phPath')" clearable />
      <el-button type="primary" :loading="fileHistoryLoading" @click="loadFileHistory">{{
        t('dialogs.fileHistory.load')
      }}</el-button>
    </div>
    <el-table v-loading="fileHistoryLoading" :data="fileHistoryEntries" size="small" max-height="320" stripe>
      <el-table-column prop="shortHash" :label="t('dialogs.fileHistory.colShort')" width="90" class-name="mono" />
      <el-table-column prop="subject" :label="t('dialogs.fileHistory.colSubject')" min-width="140" show-overflow-tooltip />
      <el-table-column prop="date" :label="t('dialogs.fileHistory.colDate')" width="150" />
      <el-table-column prop="author" :label="t('dialogs.fileHistory.colAuthor')" width="100" show-overflow-tooltip />
      <el-table-column :label="t('dialogs.fileHistory.colDiff')" width="168" fixed="right">
        <template #default="{ row }">
          <el-button link size="small" @click="setFileHistDiffMark('old', row.hash)">{{
            t('dialogs.fileHistory.old')
          }}</el-button>
          <el-button link size="small" @click="setFileHistDiffMark('new', row.hash)">{{
            t('dialogs.fileHistory.new')
          }}</el-button>
          <el-button link type="primary" size="small" @click="openHistoryCommit(row.hash)">{{
            t('dialogs.fileHistory.graph')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-divider content-position="left">{{ t('dialogs.fileHistory.dividerDiff') }}</el-divider>
    <div class="fork-adv-filehist-diff-meta">
      <span class="mono">
        {{ t('dialogs.fileHistory.labelOld') }}{{ fileHistDiffOld ? fileHistDiffOld.slice(0, 7) : t('dialogs.fileHistory.dash') }}
      </span>
      <span class="mono">
        {{ t('dialogs.fileHistory.labelNew') }}{{ fileHistDiffNew ? fileHistDiffNew.slice(0, 7) : t('dialogs.fileHistory.dash') }}
      </span>
      <el-button size="small" type="primary" :loading="fileHistDiffLoading" @click="runFileHistCommitDiff">
        {{ t('dialogs.fileHistory.showDiff') }}
      </el-button>
    </div>
    <el-scrollbar max-height="36vh" class="fork-adv-diff-scroll">
      <div v-if="fileHistDiffLoading" class="fork-adv-placeholder">{{ t('dialogs.loading') }}</div>
      <div
        v-else-if="fileHistDiffHtml"
        class="diff2html-root"
        v-html="fileHistDiffHtml"
        @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, fileHistDiffText)"
      />
      <pre v-else-if="fileHistDiffText" class="diff-pre fork-adv-pre">{{
        fileHistDiffText === EMPTY_DIFF_SENTINEL ? t('changes.noDiff') : fileHistDiffText
      }}</pre>
    </el-scrollbar>
  </el-dialog>

  <el-dialog
    v-model="remotePruneDialogOpen"
    :title="t('dialogs.remotePrune.title')"
    width="420px"
    class="fork-adv-git-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="fork-adv-hint">{{ t('dialogs.remotePrune.hint') }}</p>
    <el-select v-model="pruneRemote" filterable :placeholder="t('dialogs.remotePrune.phRemote')" class="fork-adv-full">
      <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
    </el-select>
    <template #footer>
      <el-button type="primary" :disabled="!pruneRemote.trim()" @click="doRemotePrune">{{
        t('dialogs.remotePrune.run')
      }}</el-button>
    </template>
  </el-dialog>
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
</template>

<style scoped>
.fork-adv-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.fork-adv-hint code {
  font-size: 12px;
}
.fork-adv-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.fork-adv-row .el-input,
.fork-adv-row .el-select {
  flex: 1;
  min-width: 140px;
}
.fork-adv-check {
  margin-bottom: 12px;
}
.fork-adv-actions {
  margin-bottom: 10px;
}
.fork-adv-diff-scroll {
  margin-top: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px;
}
.fork-adv-placeholder {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.fork-adv-pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.fork-adv-todo :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.fork-adv-bisect-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.fork-adv-skip {
  margin-top: 8px;
}
.fork-adv-full {
  width: 100%;
}
.fork-adv-mt {
  margin-top: 10px;
  width: 100%;
}
.fork-adv-cmd {
  margin: 12px 0 0;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  word-break: break-all;
}
.fork-adv-filehist-diff-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.fork-rebase-todo-mode {
  margin-bottom: 10px;
}
.fork-rebase-graph-scroll {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 8px;
}
.fork-rebase-graph-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.fork-rebase-graph-row:last-child {
  border-bottom: none;
}
.fork-rebase-cmd {
  width: 120px;
}
.fork-rebase-hash {
  width: 72px;
  flex-shrink: 0;
}
.fork-rebase-subj {
  flex: 1;
  min-width: 160px;
}
.fork-rebase-exec,
.fork-rebase-comment,
.fork-rebase-raw {
  flex: 1;
  min-width: 200px;
}
.fork-rebase-move {
  flex-shrink: 0;
}
</style>
