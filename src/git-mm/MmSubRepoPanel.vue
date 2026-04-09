<script setup lang="ts">
import { Bottom, Top, Refresh, Document, MoreFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { html as diff2htmlHtml } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommitDetail, LogEntry } from '../types/git-client.ts'
import ChangesView from '../components/ChangesView.vue'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { CHANGES_WORKSPACE_INJECTION_KEY } from '../composables/changesWorkspaceInjection.ts'
import { useGitMmChangesWorkspace } from '../composables/useGitMmChangesWorkspace.ts'
import { useDiff2HtmlCopyMenu } from '../composables/useDiff2HtmlCopyMenu.ts'
import { loadAppSettings } from '../utils/appSettingsStorage.ts'
import { onThemeEffectiveChange } from '../utils/appTheme.ts'
import { isBinaryDiffOutput } from '../utils/binaryDiffDetect.ts'
import { bindDiff2HtmlSideLayoutAndScroll } from '../utils/diff2HtmlSideScrollSync.ts'
import MmDiffOptionsToolbar from './MmDiffOptionsToolbar.vue'

const props = defineProps<{ repoPath: string }>()

const { t } = useI18n()
const at = window.gitAt

const mmWs = useGitMmChangesWorkspace(toRef(props, 'repoPath'))
provide(CHANGES_WORKSPACE_INJECTION_KEY, mmWs)

const {
  diff2htmlCopyMenu,
  onDiff2HtmlContextMenu,
  closeDiff2HtmlCopyMenu,
  confirmCopyDiff2Html
} = useDiff2HtmlCopyMenu()

const innerTab = ref<'changes' | 'history'>('changes')

const branches = ref<string[]>([])
const currentBranch = ref('')

const historyEntries = ref<LogEntry[]>([])
const historyLoading = ref(false)
const selectedHash = ref<string | null>(null)
const detail = ref<CommitDetail | null>(null)
const detailLoading = ref(false)
const detailDiffPath = ref<string | null>(null)
const histDiffText = ref('')
const histDiffLoading = ref(false)
const histDiffSurfaceDark = ref(false)

const histDiffOutputFormat = ref<'line-by-line' | 'side-by-side'>('side-by-side')
const histDiffContextLines = ref(3)
const histLastContextLines = ref(3)
const histDiffIgnoreBlankLines = ref(false)
const histDiffIgnoreWhitespace = ref(false)
const histDiffShowFullFile = ref(false)

const histDiffOpts = computed(() => ({
  contextLines: histDiffContextLines.value,
  ignoreBlankLines: histDiffIgnoreBlankLines.value,
  ignoreWhitespace: histDiffIgnoreWhitespace.value,
  showFullFile: histDiffShowFullFile.value
}))

const histDiffHtml = computed(() => {
  const text = histDiffText.value
  if (!text.trim() || text === EMPTY_DIFF_SENTINEL || isBinaryDiffOutput(text)) return ''
  try {
    const out = diff2htmlHtml(text, {
      outputFormat: histDiffShowFullFile.value ? 'line-by-line' : histDiffOutputFormat.value,
      drawFileList: false,
      matching: 'lines',
      colorScheme: histDiffSurfaceDark.value ? ColorSchemeType.DARK : ColorSchemeType.LIGHT
    })
    return out?.trim() ? out : ''
  } catch {
    return ''
  }
})

const histDiffIsBinary = computed(() => {
  const text = histDiffText.value
  return Boolean(text && text !== EMPTY_DIFF_SENTINEL && isBinaryDiffOutput(text))
})

function initHistDiffOptsFromSettings() {
  const s = loadAppSettings()
  histDiffOutputFormat.value = s.diffDefaultFormat
  histDiffContextLines.value = s.diffDefaultContextLines
  histLastContextLines.value = s.diffDefaultContextLines
  histDiffIgnoreBlankLines.value = s.diffDefaultIgnoreBlankLines
  histDiffIgnoreWhitespace.value = s.diffDefaultIgnoreWhitespace
  histDiffShowFullFile.value = s.diffDefaultShowFullFile
}

function toggleHistDiffFormat() {
  histDiffOutputFormat.value = histDiffOutputFormat.value === 'side-by-side' ? 'line-by-line' : 'side-by-side'
}
function toggleHistIgnoreBlankLines() {
  histDiffIgnoreBlankLines.value = !histDiffIgnoreBlankLines.value
}
function toggleHistIgnoreWhitespace() {
  histDiffIgnoreWhitespace.value = !histDiffIgnoreWhitespace.value
}
function decHistContextLines() {
  if (histDiffShowFullFile.value) return
  histDiffContextLines.value = Math.max(0, histDiffContextLines.value - 1)
}
function incHistContextLines() {
  if (histDiffShowFullFile.value) return
  histDiffContextLines.value = Math.min(50, histDiffContextLines.value + 1)
}
function toggleHistShowFullFile() {
  histDiffShowFullFile.value = !histDiffShowFullFile.value
  if (histDiffShowFullFile.value) {
    histLastContextLines.value = histDiffContextLines.value
  } else {
    histDiffContextLines.value = histLastContextLines.value
  }
}

const stashEntries = ref<{ index: number; label: string }[]>([])
const stashDialogOpen = ref(false)
const stashMessage = ref('')
const stashUntracked = ref(false)
const stashOnlyPaths = ref(false)
const stashPathsPick = ref<string[]>([])
const stashBusy = ref(false)

const status = computed(() => mmWs.status.value)

const stashPathOptions = computed(() => {
  const s = status.value
  if (!s) return [] as string[]
  const u = new Set<string>()
  for (const p of s.not_added) u.add(p)
  for (const p of s.created) u.add(p)
  for (const p of s.deleted) u.add(p)
  for (const p of s.modified) u.add(p)
  for (const r of s.renamed) {
    u.add(r.from)
    u.add(r.to)
  }
  for (const p of s.conflicted) u.add(p)
  const st = new Set(s.staged)
  return [...new Set([...u, ...st])].sort()
})

function isStashNothingError(msg: string): boolean {
  const s = msg.toLowerCase()
  if (s.includes('no local changes')) return true
  if (/nothing to stash/i.test(msg)) return true
  if (/没有要保存|沒有要儲存|没有可贮藏|无可贮藏/i.test(msg)) return true
  return false
}

async function refreshBranches() {
  const br = await at.branches(props.repoPath)
  if (!('error' in br)) {
    branches.value = br.all
    currentBranch.value = br.current
  }
}

async function refreshHistory() {
  historyLoading.value = true
  const r = await at.log(props.repoPath, 4000)
  historyLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    historyEntries.value = []
    return
  }
  historyEntries.value = r.entries
}

async function refreshStashList() {
  const r = await at.stashList(props.repoPath)
  if ('error' in r) {
    stashEntries.value = []
    return
  }
  stashEntries.value = r.entries
}

async function refreshAll() {
  await mmWs.refreshAll()
  await refreshBranches()
  await refreshStashList()
  if (innerTab.value === 'history') await refreshHistory()
}

async function onCheckout(br: string) {
  const r = await at.checkout(props.repoPath, br)
  if ('error' in r) ElMessage.error(r.error)
  else {
    ElMessage.success(t('gitMm.checkoutOk'))
    await refreshAll()
  }
}

async function doFetch() {
  const r = await at.fetch(props.repoPath)
  if ('error' in r) ElMessage.error(r.error)
  else {
    ElMessage.success(t('gitMm.fetchOk'))
    await refreshAll()
  }
}

async function doPull() {
  const r = await at.pull(props.repoPath)
  if ('error' in r) ElMessage.error(r.error)
  else {
    ElMessage.success(t('gitMm.pullOk'))
    await refreshAll()
  }
}

async function doPush() {
  const r = await at.push(props.repoPath)
  if ('error' in r) ElMessage.error(r.error)
  else {
    ElMessage.success(t('gitMm.pushOk'))
    await refreshAll()
  }
}

async function doStashPush(opts: {
  message?: string
  includeUntracked?: boolean
  stagedOnly?: boolean
  paths?: string[]
}) {
  stashBusy.value = true
  const r = await at.stashPush(props.repoPath, opts)
  stashBusy.value = false
  if ('error' in r) {
    if (isStashNothingError(r.error)) {
      ElMessage.info(r.error)
      return
    }
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('changes.stashSaved'))
  stashDialogOpen.value = false
  await refreshStashList()
  await mmWs.refreshAll()
}

async function onStashSaveSubmit() {
  if (stashOnlyPaths.value) {
    const paths = stashPathsPick.value.filter(Boolean)
    if (!paths.length) {
      ElMessage.warning(t('syncUi.stashPathsRequired'))
      return
    }
    await doStashPush({
      message: stashMessage.value.trim() || undefined,
      includeUntracked: stashUntracked.value,
      paths
    })
    return
  }
  await doStashPush({
    message: stashMessage.value.trim() || undefined,
    includeUntracked: stashUntracked.value
  })
}

async function onStashApply(ix: number) {
  const r = await at.stashApply(props.repoPath, ix)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('ws.stashApplied'))
  await refreshStashList()
  await mmWs.refreshAll()
}

async function onStashPop(ix: number) {
  try {
    await ElMessageBox.confirm(t('ws.stashPopConfirm', { n: String(ix) }), t('ws.stashPopTitle'), {
      type: 'warning',
      confirmButtonText: t('common.pop'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  const r = await at.stashPop(props.repoPath, ix)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('ws.stashPopped'))
  await refreshStashList()
  await mmWs.refreshAll()
}

async function onStashDrop(ix: number) {
  const entry = stashEntries.value.find((e) => e.index === ix)
  const hint = entry?.label ? `\n「${entry.label}」` : ''
  try {
    await ElMessageBox.confirm(
      t('ws.stashDropConfirm', { n: String(ix), hint }),
      t('ws.stashDropTitle'),
      {
        type: 'warning',
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  const r = await at.stashDrop(props.repoPath, ix)
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('ws.stashDropped'))
  await refreshStashList()
}

function onStashMenuCommand(ix: number, cmd: string | number) {
  const c = String(cmd)
  if (c === 'apply') void onStashApply(ix)
  else if (c === 'pop') void onStashPop(ix)
  else if (c === 'drop') void onStashDrop(ix)
}

async function openDetail(hash: string) {
  selectedHash.value = hash
  detail.value = null
  detailDiffPath.value = null
  histDiffText.value = ''
  detailLoading.value = true
  const r = await at.commitDetail(props.repoPath, hash)
  detailLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  detail.value = r
}

async function loadFileDiffInDetail(filePath: string) {
  if (!selectedHash.value) return
  detailDiffPath.value = filePath
  histDiffLoading.value = true
  const raw = await at.commitDiff(props.repoPath, selectedHash.value, histDiffOpts.value, filePath)
  histDiffLoading.value = false
  histDiffText.value = typeof raw === 'string' ? raw || EMPTY_DIFF_SENTINEL : raw.error
}

function fileExtension(p: string | null): string {
  if (!p) return ''
  const base = p.replace(/\\/g, '/').split('/').pop() || ''
  const i = base.lastIndexOf('.')
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toUpperCase() : ''
}

const mmDetailDiffScrollbarRef = ref<{ wrapRef?: HTMLElement } | null>(null)
const mmDiff2htmlDetailRef = ref<HTMLElement | null>(null)
let mmHistDiffSideCleanup: (() => void) | null = null

function rebindHistDiffSideScroll() {
  mmHistDiffSideCleanup?.()
  mmHistDiffSideCleanup = null
  const root = mmDiff2htmlDetailRef.value
  const wrap = mmDetailDiffScrollbarRef.value?.wrapRef ?? null
  if (root) mmHistDiffSideCleanup = bindDiff2HtmlSideLayoutAndScroll(root, wrap ?? undefined)
}

watch([histDiffHtml, histDiffOutputFormat, histDiffShowFullFile, mmDiff2htmlDetailRef], () => {
  void nextTick(() => rebindHistDiffSideScroll())
}, { flush: 'post' })

watch(() => mmDetailDiffScrollbarRef.value, () => {
  void nextTick(() => rebindHistDiffSideScroll())
}, { flush: 'post' })

watch(
  [histDiffIgnoreBlankLines, histDiffIgnoreWhitespace, histDiffShowFullFile, histDiffContextLines],
  () => {
    if (innerTab.value === 'history' && detailDiffPath.value && selectedHash.value) {
      void loadFileDiffInDetail(detailDiffPath.value)
    }
  }
)

watch(
  () => props.repoPath,
  () => {
    selectedHash.value = null
    detailDiffPath.value = null
    detail.value = null
    histDiffText.value = ''
    innerTab.value = 'changes'
    void refreshAll()
  },
  { immediate: true }
)

watch(innerTab, (v) => {
  if (v === 'history') void refreshHistory()
})

let offThemeEffective: (() => void) | undefined

onMounted(() => {
  initHistDiffOptsFromSettings()
  histDiffSurfaceDark.value = document.documentElement.classList.contains('dark')
  offThemeEffective = onThemeEffectiveChange(() => {
    histDiffSurfaceDark.value = document.documentElement.classList.contains('dark')
  })
  void nextTick(() => rebindHistDiffSideScroll())
})

onUnmounted(() => {
  offThemeEffective?.()
  mmHistDiffSideCleanup?.()
  mmHistDiffSideCleanup = null
})

const statusLoading = computed(
  () => (mmWs as unknown as { statusLoading: import('vue').Ref<boolean> }).statusLoading.value
)

const panelBusy = computed(() => statusLoading.value || historyLoading.value)
</script>

<template>
  <div v-loading="panelBusy" class="mm-sub-root">
    <div class="mm-sub-toolbar">
      <el-select
        :model-value="currentBranch"
        filterable
        size="small"
        class="mm-branch-select"
        :placeholder="t('gitMm.branch')"
        @update:model-value="(v: string) => onCheckout(v)"
      >
        <el-option v-for="b in branches" :key="b" :label="b" :value="b" />
      </el-select>
      <el-button size="small" @click="refreshAll">
        <el-icon class="el-icon--left"><Refresh /></el-icon>
        {{ t('gitMm.refreshRepo') }}
      </el-button>
      <el-button size="small" @click="doFetch">{{ t('ribbon.fetch') }}</el-button>
      <el-button size="small" @click="doPull">
        <el-icon class="el-icon--left"><Bottom /></el-icon>
        {{ t('ribbon.pull') }}
      </el-button>
      <el-button size="small" @click="doPush">
        <el-icon class="el-icon--left"><Top /></el-icon>
        {{ t('ribbon.push') }}
      </el-button>
      <el-text v-if="status" size="small" type="info" class="mm-sync-hint">
        ↑{{ status.ahead }} ↓{{ status.behind }}
      </el-text>
    </div>

    <el-tabs v-model="innerTab" class="mm-inner-tabs">
      <el-tab-pane :label="t('changes.unstaged') + ' / ' + t('changes.staged')" name="changes">
        <div class="mm-changes-embed">
          <ChangesView :git-at-hunk-root="repoPath" class="mm-changes-view" />
          <div class="mm-stash-bar">
            <div class="mm-stash-head">
              <span class="mm-file-head">{{ t('ribbon.stash') }}</span>
              <el-button size="small" class="mm-stash-save-btn" :loading="stashBusy" @click="stashDialogOpen = true">
                {{ t('syncUi.stashSaveBtn') }}
              </el-button>
            </div>
            <el-scrollbar class="mm-stash-scroll">
              <div v-for="row in stashEntries" :key="row.index" class="mm-stash-row">
                <span class="mono mm-stash-idx">#{{ row.index }}</span>
                <span class="mm-stash-label" :title="row.label">{{ row.label }}</span>
                <el-dropdown trigger="click" @command="(cmd: string | number) => onStashMenuCommand(row.index, cmd)">
                  <el-button size="small" text class="mm-stash-more" :aria-label="t('ribbon.stashMore')">
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="apply">{{ t('sidebar.applyStash') }}</el-dropdown-item>
                      <el-dropdown-item command="pop">{{ t('sidebar.popStash') }}</el-dropdown-item>
                      <el-dropdown-item divided command="drop">{{ t('sidebar.dropStash') }}</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <div v-if="!stashEntries.length" class="mm-muted mm-stash-empty">{{ t('sidebar.noStash') }}</div>
            </el-scrollbar>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane :label="t('sidebar.navHistory')" name="history">
        <div class="mm-hist-split">
          <el-table
            v-loading="historyLoading"
            :data="historyEntries"
            size="small"
            height="280"
            highlight-current-row
            class="mm-hist-table"
            @row-click="(row: LogEntry) => openDetail(row.hash)"
          >
            <el-table-column prop="hash" :label="t('gitMm.colHash')" width="108">
              <template #default="{ row }">
                <span class="mono">{{ row.hash.slice(0, 7) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="message" :label="t('gitMm.colSubject')" min-width="160" show-overflow-tooltip />
            <el-table-column prop="author_name" :label="t('gitMm.colAuthor')" width="100" show-overflow-tooltip />
            <el-table-column prop="date" :label="t('gitMm.colDate')" width="148" show-overflow-tooltip />
          </el-table>
          <div class="mm-detail">
            <template v-if="detailLoading">
              <el-text size="small">{{ t('common.loading') }}</el-text>
            </template>
            <template v-else-if="detail">
              <div class="mm-detail-head mono">{{ detail.fullHash.slice(0, 12) }}</div>
              <div class="mm-detail-subj">{{ detail.subject }}</div>
              <div class="mm-detail-meta muted">{{ detail.authorName }} · {{ detail.date }}</div>
              <div class="mm-detail-files">
                <div class="mm-file-head">{{ t('gitMm.changedFiles') }}</div>
                <el-scrollbar class="mm-file-scroll mm-detail-file-scroll">
                  <button
                    v-for="f in detail.files"
                    :key="f.path"
                    type="button"
                    class="mm-file-row"
                    @click="loadFileDiffInDetail(f.path)"
                  >
                    <span class="mono mm-status">{{ f.status }}</span> {{ f.path }}
                  </button>
                </el-scrollbar>
              </div>
              <div class="mm-detail-diff mm-diff-panel">
                <div v-if="!detailDiffPath" class="mm-diff-placeholder">{{ t('gitMm.pickFileFromCommit') }}</div>
                <template v-else>
                  <div class="mm-diff-toolbar-row">
                    <MmDiffOptionsToolbar
                      :diff-output-format="histDiffOutputFormat"
                      :diff-ignore-blank-lines="histDiffIgnoreBlankLines"
                      :diff-ignore-whitespace="histDiffIgnoreWhitespace"
                      :diff-context-lines="histDiffContextLines"
                      :diff-show-full-file="histDiffShowFullFile"
                      :context-disabled="!detailDiffPath || histDiffShowFullFile"
                      @toggle-diff-format="toggleHistDiffFormat"
                      @toggle-ignore-blank-lines="toggleHistIgnoreBlankLines"
                      @toggle-ignore-whitespace="toggleHistIgnoreWhitespace"
                      @dec-context-lines="decHistContextLines"
                      @inc-context-lines="incHistContextLines"
                      @toggle-show-full-file="toggleHistShowFullFile"
                    />
                    <el-tag size="small" effect="plain" type="info" class="mm-diff-scope-tag mono">
                      {{ detail.fullHash.slice(0, 7) }}
                    </el-tag>
                    <el-text v-if="histDiffLoading" type="info" size="small">{{ t('common.loading') }}</el-text>
                  </div>
                  <el-scrollbar ref="mmDetailDiffScrollbarRef" class="mm-diff-changes-scroll mm-detail-diff-scroll">
                    <div v-if="histDiffLoading" class="mm-diff-placeholder">{{ t('common.loading') }}</div>
                    <template v-else>
                      <div v-if="histDiffText === EMPTY_DIFF_SENTINEL" class="mm-diff-placeholder">{{
                        t('changes.noDiff')
                      }}</div>
                      <div v-else-if="histDiffIsBinary" class="change-binary-preview">
                        <el-icon class="change-binary-ico" :size="56"><Document /></el-icon>
                        <div v-if="fileExtension(detailDiffPath)" class="change-binary-ext">{{
                          fileExtension(detailDiffPath)
                        }}</div>
                        <div class="change-binary-size muted">{{ t('changes.binaryNoSize') }}</div>
                        <div class="mm-binary-hint muted">{{ t('changes.binaryNoLineOps') }}</div>
                      </div>
                      <div
                        v-else-if="histDiffHtml"
                        class="change-diff2html-host"
                        @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, histDiffText)"
                      >
                        <div ref="mmDiff2htmlDetailRef" class="diff2html-root" v-html="histDiffHtml" />
                      </div>
                      <pre v-else-if="histDiffText" class="mm-diff-pre mono">{{ histDiffText }}</pre>
                      <div v-else class="mm-diff-placeholder">{{ t('changes.noContent') }}</div>
                    </template>
                  </el-scrollbar>
                </template>
              </div>
            </template>
            <el-text v-else type="info" size="small">{{ t('gitMm.pickCommit') }}</el-text>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="stashDialogOpen"
      :title="t('syncUi.stashSaveTitle')"
      width="440px"
      destroy-on-close
      append-to-body
      class="mm-stash-dlg"
    >
      <p class="mm-stash-dlg-sub">{{ t('syncUi.stashSaveSub') }}</p>
      <el-form label-position="top" class="mm-stash-dlg-form">
        <el-form-item :label="t('syncUi.messageLabel')">
          <el-input v-model="stashMessage" :placeholder="t('syncUi.stashMsgPh')" clearable />
        </el-form-item>
        <div class="mm-stash-dlg-check">
          <el-checkbox v-model="stashUntracked">{{ t('syncUi.stashUntracked') }}</el-checkbox>
          <p class="mm-stash-dlg-hint">{{ t('syncUi.stashUntrackedHint') }}</p>
        </div>
        <el-checkbox v-model="stashOnlyPaths" class="mm-stash-dlg-only">{{
          t('syncUi.stashOnlyPaths')
        }}</el-checkbox>
        <el-select
          v-model="stashPathsPick"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          class="mm-stash-dlg-select"
          :placeholder="t('syncUi.pickStashFiles')"
          :disabled="!stashOnlyPaths"
        >
          <el-option v-for="p in stashPathOptions" :key="p" :label="p" :value="p" />
        </el-select>
      </el-form>
      <template #footer>
        <el-button @click="stashDialogOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="stashBusy" @click="onStashSaveSubmit">{{
          t('syncUi.stashSaveBtn')
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
  </div>
</template>

<style scoped>
.mm-sub-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
}
.mm-sub-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.mm-branch-select {
  width: 200px;
}
.mm-sync-hint {
  margin-left: 4px;
}
.mm-inner-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mm-inner-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.mm-changes-embed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 420px;
  max-height: calc(100vh - 200px);
}
.mm-changes-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mm-stash-bar {
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
  max-height: 140px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mm-stash-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mm-stash-scroll {
  max-height: 96px;
}
.mm-stash-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
}
.mm-stash-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-stash-empty {
  font-size: 12px;
}
.mm-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.mm-hist-split {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 1fr;
  gap: 12px;
  align-items: start;
  min-height: 320px;
}
.mm-hist-table {
  width: 100%;
}
.mm-detail {
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
}
.mm-detail-head {
  font-size: 12px;
  margin-bottom: 6px;
}
.mm-detail-subj {
  font-weight: 600;
  margin-bottom: 4px;
}
.mm-detail-meta {
  font-size: 12px;
  margin-bottom: 10px;
}
.mm-detail-files {
  margin-bottom: 10px;
}
.mm-file-head {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.mm-file-scroll {
  max-height: 120px;
}
.mm-file-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}
.mm-file-row:hover {
  background: var(--el-fill-color-light);
}
.mm-status {
  margin-right: 6px;
}
.mm-diff-panel {
  min-height: 200px;
}
.mm-diff-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.mm-diff-placeholder {
  padding: 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.mm-diff-changes-scroll {
  max-height: min(48vh, 420px);
}
.mm-detail-diff-scroll {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.mm-diff-pre {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.45;
}
.mm-binary-hint {
  font-size: 12px;
  margin-top: 8px;
}
.mm-stash-dlg-sub {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.mm-stash-dlg-check {
  margin-bottom: 8px;
}
.mm-stash-dlg-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mm-stash-dlg-only {
  margin-bottom: 8px;
}
.mm-stash-dlg-select {
  width: 100%;
}
</style>
