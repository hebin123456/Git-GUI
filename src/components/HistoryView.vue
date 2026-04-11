<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { Search, FolderOpened, Plus, Minus, ArrowDown, Document, Download } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useDiff2HtmlCopyMenu } from '../composables/useDiff2HtmlCopyMenu.ts'
import { EMPTY_DIFF_SENTINEL } from '../constants/diffSentinel.ts'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'
import HistoryGitgraph from './HistoryGitgraph.vue'
import ResizableSplit from './common/ResizableSplit.vue'

const { t } = useI18n()

const {
  activeView,
  displayHistoryGitgraph,
  historySearchLoading,
  runHistoryLogSearch,
  clearHistoryLogSearch,
  historySearchActive,
  historyTotalLogLimit,
  loadMoreHistoryCommits,
  currentBranch,
  repoPath,
  remotes,
  selectedHistoryHash,
  selectHistoryByHash,
  detailTab,
  commitDetailLoading,
  commitDetail,
  sortedCommitDetailFiles,
  commitOverviewCollapseName,
  historyCommitDiffLoading,
  historyCommitDiffHtml,
  historyCommitDiffText,
  commitFileGlyphs,
  historyChangeFileSearch,
  historySnapshotTreeSearch,
  commitFilesTreeForChangesTab,
  commitFilesTreeDataFiltered,
  selectedCommitDiffPath,
  onCommitChangeTreeClick,
  diffIgnoreBlankLines,
  diffIgnoreWhitespace,
  toggleIgnoreBlankLines,
  toggleIgnoreWhitespace,
  diffContextLines,
  diffShowFullFile,
  decContextLines,
  incContextLines,
  toggleShowFullFile,
  commitFilesTreeData,
  commitSnapshotTreeLoading,
  diffOutputFormat,
  toggleDiffFormat,
  mergeIntoHead,
  rebaseOnto,
  cherryPickCommit,
  revertCommit,
  resetToCommit,
  openBlameDialog,
  openFileHistoryDialog,
  openCompareDialog
} = useGitWorkspace()

const {
  diff2htmlCopyMenu,
  onDiff2HtmlContextMenu,
  confirmCopyDiff2Html
} = useDiff2HtmlCopyMenu()

const logSearchGrep = ref('')
const logSearchPickaxe = ref('')
const logSearchRegexp = ref(false)
const logSearchAllMatch = ref(false)
const logSearchIgnoreCase = ref(false)
const snapshotTreeExporting = ref(false)

function submitLogSearch() {
  void runHistoryLogSearch({
    grep: logSearchGrep.value.trim() || undefined,
    pickaxe: logSearchPickaxe.value.trim() || undefined,
    regexp: logSearchRegexp.value,
    allMatch: logSearchAllMatch.value,
    ignoreCase: logSearchIgnoreCase.value
  })
}

function onClearLogSearch() {
  clearHistoryLogSearch()
}

/** 提交详情里的路径可能是重命名「a → b」，Blame/历史用当前树路径（取右侧） */
function workingPathFromCommitPath(spec: string): string {
  const s = spec.trim()
  const arrow = ' → '
  if (s.includes(arrow)) return s.split(arrow).pop()!.trim()
  return s
}

function onGraphSelect(hash: string) {
  selectHistoryByHash(hash)
}

function onGraphMerge(hash: string) {
  void mergeIntoHead(hash)
}

function onGraphRebase(hash: string) {
  void rebaseOnto(hash)
}

function onGraphCherryPick(hash: string) {
  void cherryPickCommit(hash)
}

function onGraphRevert(hash: string) {
  void revertCommit(hash)
}

function onGraphReset(hash: string, mode: 'soft' | 'mixed' | 'hard') {
  void resetToCommit(hash, mode)
}

function compareSelectionWithHead() {
  const h = (commitDetail.value?.fullHash ?? selectedHistoryHash.value ?? '').trim()
  if (!h) return
  openCompareDialog(h, 'HEAD')
}

function openBlameSelectedCommitFile() {
  const p = selectedCommitDiffPath.value
  if (!p) return
  openBlameDialog(workingPathFromCommitPath(p))
}

function openFileHistorySelectedCommitFile() {
  const p = selectedCommitDiffPath.value
  if (!p) return
  openFileHistoryDialog(workingPathFromCommitPath(p))
}

function basenamePath(p: string | null): string {
  const raw = String(p ?? '').replace(/[/\\]+$/, '')
  if (!raw) return 'repo'
  const i = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return i >= 0 ? raw.slice(i + 1) || 'repo' : raw
}

function sanitizeFileStem(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  return clean || 'repo'
}

async function exportSnapshotTree() {
  const hash = selectedHistoryHash.value?.trim() ?? ''
  if (!hash || !commitFilesTreeData.value.length || snapshotTreeExporting.value) return
  snapshotTreeExporting.value = true
  try {
    const rootName = basenamePath(repoPath.value)
    const fileName = `${sanitizeFileStem(rootName)}-snapshot-${hash.slice(0, 7)}.zip`
    const r = await window.gitClient.exportCommitArchive({
      hash,
      title: t('history.exportSnapshotTreeSaveTitle'),
      defaultPath: fileName
    })
    if ('error' in r) {
      ElMessage.error(r.error)
      return
    }
    if (r.ok) ElMessage.success(t('history.exportSnapshotTreeSaved'))
  } finally {
    snapshotTreeExporting.value = false
  }
}
</script>

<template>
  <div class="history-view">
    <ResizableSplit
      class="history-main-split"
      direction="vertical"
      storage-key="fork-layout-history-main"
      :default-primary-percent="46"
      :min-primary-percent="20"
      :max-primary-percent="78"
    >
      <template #top>
        <div class="history-flow-wrap history-graph-only">
          <div v-if="displayHistoryGitgraph.length" class="history-graph-toolbar">
            <span class="history-graph-toolbar-title">{{ t('history.toolbarTitle') }}</span>
            <span class="history-graph-toolbar-hint">{{ t('history.toolbarHint') }}</span>
          </div>
          <div v-if="displayHistoryGitgraph.length" class="history-log-search-bar">
            <el-input
              v-model="logSearchGrep"
              size="small"
              clearable
              :placeholder="t('history.grepPlaceholder')"
              class="history-log-search-input"
              @keyup.enter="submitLogSearch"
            />
            <el-input
              v-model="logSearchPickaxe"
              size="small"
              clearable
              :placeholder="t('history.pickaxePlaceholder')"
              class="history-log-search-input"
              @keyup.enter="submitLogSearch"
            />
            <el-checkbox v-model="logSearchIgnoreCase" size="small">{{ t('history.ignoreCase') }}</el-checkbox>
            <el-checkbox v-model="logSearchRegexp" size="small">{{ t('history.extendedRegexp') }}</el-checkbox>
            <el-checkbox v-model="logSearchAllMatch" size="small">{{ t('history.allMatch') }}</el-checkbox>
            <el-button size="small" type="primary" :loading="historySearchLoading" @click="submitLogSearch">
              {{ t('history.search') }}
            </el-button>
            <el-button size="small" :disabled="historySearchLoading" @click="onClearLogSearch">
              {{ t('history.showAll') }}
            </el-button>
          </div>
          <div
            v-if="!historySearchActive && displayHistoryGitgraph.length"
            class="history-log-perf-bar"
          >
            <span class="history-log-perf-hint" v-html="t('history.perfHint', { n: historyTotalLogLimit })" />
            <el-button size="small" type="primary" plain @click="loadMoreHistoryCommits">{{
              t('history.loadMore')
            }}</el-button>
          </div>
          <div v-if="displayHistoryGitgraph.length" class="history-graph-scrollbar">
            <HistoryGitgraph
              :rows="displayHistoryGitgraph"
              :selected-hash="selectedHistoryHash"
              :history-active="activeView === 'history'"
              :current-branch="currentBranch"
              :remotes="remotes"
              @select="onGraphSelect"
              @merge="onGraphMerge"
              @rebase="onGraphRebase"
              @cherry-pick="onGraphCherryPick"
              @revert="onGraphRevert"
              @reset="onGraphReset"
            />
          </div>
          <el-empty v-else class="history-flow-empty" :description="t('history.emptyCommits')" :image-size="64" />
        </div>
      </template>

      <template #bottom>
        <div class="commit-detail-pane-outer">
      <div class="commit-detail-pane">
      <el-tabs v-model="detailTab" class="detail-tabs">
        <el-tab-pane :label="t('history.tabCommit')" name="commit" class="detail-tab-pane-commit">
          <div class="detail-pane-scroll-host">
            <div class="detail-pane-scroll-inner detail-commit-tab-scroll">
            <div v-if="!selectedHistoryHash" class="detail-tab-empty">{{ t('history.selectCommitInGraph') }}</div>
            <el-skeleton v-else :loading="commitDetailLoading" animated :rows="6">
              <div v-if="commitDetail" class="detail-commit">
                <p class="detail-subject">{{ commitDetail.subject }}</p>
                <p class="detail-meta">
                  <span class="mono">{{ commitDetail.fullHash }}</span>
                  · {{ commitDetail.date }}
                </p>
                <p class="detail-author">
                  {{ commitDetail.authorName }}
                  <span class="email">&lt;{{ commitDetail.authorEmail }}&gt;</span>
                </p>
                <p v-if="commitDetail.body" class="detail-body">{{ commitDetail.body }}</p>
                <div class="detail-commit-actions">
                  <el-button size="small" @click="compareSelectionWithHead">{{ t('history.compareWithHead') }}</el-button>
                  <el-button size="small" @click="cherryPickCommit(commitDetail.fullHash)">{{
                    t('history.cherryPick')
                  }}</el-button>
                  <el-button size="small" @click="revertCommit(commitDetail.fullHash)">{{ t('history.revert') }}</el-button>
                  <el-button size="small" @click="resetToCommit(commitDetail.fullHash, 'soft')">{{
                    t('history.resetSoft')
                  }}</el-button>
                  <el-button size="small" @click="resetToCommit(commitDetail.fullHash, 'mixed')">{{
                    t('history.resetMixed')
                  }}</el-button>
                  <el-button size="small" type="danger" plain @click="resetToCommit(commitDetail.fullHash, 'hard')">
                    {{ t('history.resetHard') }}
                  </el-button>
                </div>
                <div v-if="commitDetail.parents.length" class="detail-parents">
                  <span class="lbl">{{ t('history.parentCommit') }}</span>
                  <el-tag
                    v-for="(p, i) in commitDetail.parents"
                    :key="i"
                    size="small"
                    class="mono detail-parent-tag"
                    effect="plain"
                    role="button"
                    tabindex="0"
                    :title="t('history.parentCommitTitle', { hash: p })"
                    @click.stop="selectHistoryByHash(p)"
                    @keydown.enter.prevent="selectHistoryByHash(p)"
                  >
                    {{ p.slice(0, 7) }}
                  </el-tag>
                </div>
                <el-divider content-position="left">{{ t('history.changedFilesHint') }}</el-divider>
                <div v-if="sortedCommitDetailFiles.length" class="detail-commit-overview-collapse-wrap">
                  <el-collapse v-model="commitOverviewCollapseName" accordion class="detail-commit-file-collapse">
                    <el-collapse-item
                      v-for="f in sortedCommitDetailFiles"
                      :key="f.path"
                      :name="f.path"
                    >
                      <template #title>
                        <span class="detail-commit-collapse-title">
                          <span class="detail-file-glyphs">
                            <template v-for="g in [commitFileGlyphs(f.status)]" :key="f.path">
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
                          <span class="detail-commit-collapse-path" :title="f.path">{{ f.path }}</span>
                          <span class="detail-file-quick-actions">
                            <el-button
                              link
                              type="primary"
                              size="small"
                              @click.stop="openBlameDialog(workingPathFromCommitPath(f.path))"
                            >
                              Blame
                            </el-button>
                            <el-button
                              link
                              type="primary"
                              size="small"
                              @click.stop="openFileHistoryDialog(workingPathFromCommitPath(f.path))"
                            >
                              {{ t('history.historyShort') }}
                            </el-button>
                          </span>
                        </span>
                      </template>
                      <div class="detail-commit-collapse-diff">
                        <div
                          v-if="String(commitOverviewCollapseName) === f.path && historyCommitDiffLoading"
                          class="diff-placeholder"
                        >
                          {{ t('history.inlineLoading') }}
                        </div>
                        <div
                          v-else-if="String(commitOverviewCollapseName) === f.path && historyCommitDiffHtml"
                          class="detail-commit-collapse-diff-body"
                        >
                          <div
                            class="diff2html-root"
                            v-html="historyCommitDiffHtml"
                            @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, historyCommitDiffText)"
                          />
                        </div>
                        <pre
                          v-else-if="
                            String(commitOverviewCollapseName) === f.path &&
                            historyCommitDiffText &&
                            historyCommitDiffText !== EMPTY_DIFF_SENTINEL
                          "
                          class="diff-pre detail-commit-collapse-diff-body detail-commit-collapse-diff-pre"
                        >{{ historyCommitDiffText }}</pre>
                        <div
                          v-else-if="String(commitOverviewCollapseName) === f.path"
                          class="diff-placeholder"
                        >
                          {{ t('changes.noDiff') }}
                        </div>
                      </div>
                    </el-collapse-item>
                  </el-collapse>
                </div>
                <div v-else class="detail-commit-no-files-hint">{{ t('history.noFileChanges') }}</div>
              </div>
              <div v-else class="detail-tab-empty">{{ t('history.loadCommitFailed') }}</div>
            </el-skeleton>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="t('history.tabChanges')" name="changes" class="detail-tab-pane-fill">
          <div v-if="!selectedHistoryHash" class="detail-tab-empty">{{ t('history.selectCommitInGraph') }}</div>
          <div v-else-if="commitDetailLoading" class="diff-placeholder">{{ t('history.loadingCommitDetail') }}</div>
          <div v-else-if="commitDetail && !commitDetail.files.length" class="diff-placeholder">{{
            t('history.noFileChanges')
          }}</div>
          <ResizableSplit
            v-else-if="commitDetail && commitDetail.files.length"
            class="detail-commit-diff-split"
            storage-key="fork-layout-history-changes"
            :default-primary-percent="28"
            :min-primary-percent="14"
            :max-primary-percent="46"
          >
            <template #left>
            <div class="detail-commit-diff-sidebar">
              <el-input
                v-model="historyChangeFileSearch"
                size="small"
                clearable
                :placeholder="t('history.searchFilesPlaceholder')"
                class="detail-commit-file-search"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <div class="detail-pane-scroll-host">
                <div class="detail-pane-scroll-inner detail-commit-diff-tree-inner">
                <el-tree
                  v-if="commitFilesTreeForChangesTab.length"
                  :data="commitFilesTreeForChangesTab"
                  node-key="id"
                  :indent="20"
                  :props="{ label: 'label', children: 'children' }"
                  highlight-current
                  :current-node-key="selectedCommitDiffPath ?? undefined"
                  default-expand-all
                  class="detail-file-tree detail-commit-change-tree"
                  @node-click="onCommitChangeTreeClick"
                >
                  <template #default="{ data }">
                    <span class="file-tree-node detail-commit-tree-node">
                      <span v-if="data.children" class="file-tree-dir-ico">
                        <el-icon><FolderOpened /></el-icon>
                      </span>
                      <span v-else-if="data.status" class="detail-file-glyphs">
                        <template v-for="g in [commitFileGlyphs(data.status)]" :key="data.id">
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
                      <span v-else class="detail-file-leaf-ico">
                        <el-icon><Document /></el-icon>
                      </span>
                      <span class="file-tree-label" :title="data.path ?? data.id">{{ data.label }}</span>
                    </span>
                  </template>
                </el-tree>
                <el-empty v-else :description="t('history.noMatchingFiles')" :image-size="48" />
                </div>
              </div>
            </div>
            </template>
            <template #right>
            <div class="detail-commit-diff-main">
              <div class="diff-actions detail-commit-diff-actions">
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffIgnoreBlankLines ? 'primary' : 'default'"
                  :title="t('changes.ignoreBlankLines')"
                  @click="toggleIgnoreBlankLines"
                >
                  {{ t('changes.ignoreBlankLines') }}
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffIgnoreWhitespace ? 'primary' : 'default'"
                  :title="t('changes.ignoreWhitespace')"
                  @click="toggleIgnoreWhitespace"
                >
                  {{ t('changes.ignoreWhitespace') }}
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath || diffShowFullFile"
                  :title="t('changes.lessContext')"
                  @click="decContextLines"
                >
                  <el-icon><Minus /></el-icon>
                </el-button>
                <span
                  class="diff-context"
                  :title="
                    t('history.contextLinesTitle', {
                      state: diffShowFullFile ? t('history.contextAll') : String(diffContextLines)
                    })
                  "
                >
                  {{ diffShowFullFile ? t('history.contextAll') : diffContextLines }}
                </span>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath || diffShowFullFile"
                  :title="t('changes.moreContext', { n: diffContextLines })"
                  @click="incContextLines"
                >
                  <el-icon><Plus /></el-icon>
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffShowFullFile ? 'primary' : 'default'"
                  :title="t('changes.fullFile')"
                  @click="toggleShowFullFile"
                >
                  {{ t('changes.fullFile') }}
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
                          diffOutputFormat === 'side-by-side'
                            ? t('changes.diffLineByLine')
                            : t('changes.diffSideBySide')
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleIgnoreBlankLines">
                        {{ diffIgnoreBlankLines ? '✓ ' : '' }}{{ t('changes.ignoreBlankLines') }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleIgnoreWhitespace">
                        {{ diffIgnoreWhitespace ? '✓ ' : '' }}{{ t('changes.ignoreWhitespace') }}
                      </el-dropdown-item>
                      <el-dropdown-item divided :disabled="!selectedCommitDiffPath || diffShowFullFile" @click="decContextLines">
                        {{ t('changes.lessContext') }}
                      </el-dropdown-item>
                      <el-dropdown-item :disabled="!selectedCommitDiffPath || diffShowFullFile" @click="incContextLines">
                        {{
                          t('changes.moreContext', {
                            n: diffShowFullFile ? t('history.contextAll') : diffContextLines
                          })
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleShowFullFile">
                        {{ diffShowFullFile ? '✓ ' : '' }}{{ t('changes.fullFile') }}
                      </el-dropdown-item>
                      <el-dropdown-item divided :disabled="!selectedCommitDiffPath" @click="openBlameSelectedCommitFile">
                        {{ t('changes.blameFile') }}
                      </el-dropdown-item>
                      <el-dropdown-item :disabled="!selectedCommitDiffPath" @click="openFileHistorySelectedCommitFile">
                        {{ t('changes.fileHistory') }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-text v-if="historyCommitDiffLoading" type="info" size="small">{{
                  t('history.inlineLoading')
                }}</el-text>
              </div>
              <div class="detail-pane-scroll-host">
                <div class="detail-pane-scroll-inner detail-commit-diff-scroll-inner">
                <div v-if="!selectedCommitDiffPath" class="diff-placeholder">{{ t('history.pickFileLeft') }}</div>
                <div v-else-if="historyCommitDiffLoading" class="diff-placeholder">{{ t('history.inlineLoading') }}</div>
                <div
                  v-else-if="historyCommitDiffHtml"
                  class="diff2html-root"
                  v-html="historyCommitDiffHtml"
                  @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, historyCommitDiffText)"
                />
                <pre
                  v-else-if="historyCommitDiffText && historyCommitDiffText !== EMPTY_DIFF_SENTINEL"
                  class="diff-pre"
                >{{ historyCommitDiffText }}</pre>
                <div v-else class="diff-placeholder">{{ t('changes.noDiff') }}</div>
                </div>
              </div>
            </div>
            </template>
          </ResizableSplit>
        </el-tab-pane>
        <el-tab-pane :label="t('history.tabFiles')" name="files" class="detail-tab-pane-fill">
          <div v-if="!selectedHistoryHash" class="detail-tab-empty">{{ t('history.selectCommitInGraph') }}</div>
          <div v-else-if="commitSnapshotTreeLoading" class="diff-placeholder">{{ t('common.loading') }}</div>
          <div v-else-if="!commitFilesTreeData.length" class="diff-placeholder">{{ t('history.snapshotTreeEmpty') }}</div>
          <ResizableSplit
            v-else
            class="detail-commit-diff-split"
            storage-key="fork-layout-history-files"
            :default-primary-percent="30"
            :min-primary-percent="14"
            :max-primary-percent="48"
          >
            <template #left>
            <div class="detail-commit-diff-sidebar detail-files-tab-sidebar">
              <el-input
                v-model="historySnapshotTreeSearch"
                size="small"
                clearable
                :placeholder="t('history.searchFilesPlaceholder')"
                class="detail-commit-file-search detail-files-tab-search"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <div class="detail-files-tab-actions">
                <el-button
                  size="small"
                  class="detail-files-tab-export-btn"
                  :loading="snapshotTreeExporting"
                  :disabled="commitSnapshotTreeLoading || !commitFilesTreeData.length"
                  :title="t('history.exportSnapshotTreeHint')"
                  @click="exportSnapshotTree"
                >
                  <el-icon class="el-icon--left"><Download /></el-icon>
                  {{ t('history.exportSnapshotTree') }}
                </el-button>
              </div>
              <div class="detail-pane-scroll-host">
                <div class="detail-pane-scroll-inner detail-commit-diff-tree-inner">
                <el-tree
                  v-if="commitFilesTreeDataFiltered.length"
                  :data="commitFilesTreeDataFiltered"
                  node-key="id"
                  :indent="20"
                  :props="{ label: 'label', children: 'children' }"
                  highlight-current
                  :current-node-key="selectedCommitDiffPath ?? undefined"
                  default-expand-all
                  class="detail-file-tree detail-commit-change-tree"
                  @node-click="onCommitChangeTreeClick"
                >
                  <template #default="{ data }">
                    <span class="file-tree-node detail-commit-tree-node">
                      <span v-if="data.children" class="file-tree-dir-ico">
                        <el-icon><FolderOpened /></el-icon>
                      </span>
                      <span v-else-if="data.status" class="detail-file-glyphs">
                        <template v-for="g in [commitFileGlyphs(data.status)]" :key="data.id">
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
                      <span v-else class="detail-file-leaf-ico">
                        <el-icon><Document /></el-icon>
                      </span>
                      <span class="file-tree-label" :title="data.path ?? data.id">{{ data.label }}</span>
                    </span>
                  </template>
                </el-tree>
                <el-empty
                  v-else-if="historySnapshotTreeSearch.trim()"
                  :description="t('history.noMatchingFiles')"
                  :image-size="48"
                />
                </div>
              </div>
            </div>
            </template>
            <template #right>
            <div class="detail-commit-diff-main">
              <div class="diff-actions detail-commit-diff-actions">
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffIgnoreBlankLines ? 'primary' : 'default'"
                  :title="t('changes.ignoreBlankLines')"
                  @click="toggleIgnoreBlankLines"
                >
                  {{ t('changes.ignoreBlankLines') }}
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffIgnoreWhitespace ? 'primary' : 'default'"
                  :title="t('changes.ignoreWhitespace')"
                  @click="toggleIgnoreWhitespace"
                >
                  {{ t('changes.ignoreWhitespace') }}
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath || diffShowFullFile"
                  :title="t('changes.lessContext')"
                  @click="decContextLines"
                >
                  <el-icon><Minus /></el-icon>
                </el-button>
                <span
                  class="diff-context"
                  :title="
                    t('history.contextLinesTitle', {
                      state: diffShowFullFile ? t('history.contextAll') : String(diffContextLines)
                    })
                  "
                >
                  {{ diffShowFullFile ? t('history.contextAll') : diffContextLines }}
                </span>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath || diffShowFullFile"
                  :title="t('changes.moreContext', { n: diffContextLines })"
                  @click="incContextLines"
                >
                  <el-icon><Plus /></el-icon>
                </el-button>
                <el-button
                  size="small"
                  text
                  :disabled="!selectedCommitDiffPath"
                  :type="diffShowFullFile ? 'primary' : 'default'"
                  :title="t('changes.fullFile')"
                  @click="toggleShowFullFile"
                >
                  {{ t('changes.fullFile') }}
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
                          diffOutputFormat === 'side-by-side'
                            ? t('changes.diffLineByLine')
                            : t('changes.diffSideBySide')
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleIgnoreBlankLines">
                        {{ diffIgnoreBlankLines ? '✓ ' : '' }}{{ t('changes.ignoreBlankLines') }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleIgnoreWhitespace">
                        {{ diffIgnoreWhitespace ? '✓ ' : '' }}{{ t('changes.ignoreWhitespace') }}
                      </el-dropdown-item>
                      <el-dropdown-item divided :disabled="!selectedCommitDiffPath || diffShowFullFile" @click="decContextLines">
                        {{ t('changes.lessContext') }}
                      </el-dropdown-item>
                      <el-dropdown-item :disabled="!selectedCommitDiffPath || diffShowFullFile" @click="incContextLines">
                        {{
                          t('changes.moreContext', {
                            n: diffShowFullFile ? t('history.contextAll') : diffContextLines
                          })
                        }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="toggleShowFullFile">
                        {{ diffShowFullFile ? '✓ ' : '' }}{{ t('changes.fullFile') }}
                      </el-dropdown-item>
                      <el-dropdown-item divided :disabled="!selectedCommitDiffPath" @click="openBlameSelectedCommitFile">
                        {{ t('changes.blameFile') }}
                      </el-dropdown-item>
                      <el-dropdown-item :disabled="!selectedCommitDiffPath" @click="openFileHistorySelectedCommitFile">
                        {{ t('changes.fileHistory') }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-text v-if="historyCommitDiffLoading" type="info" size="small">{{
                  t('history.inlineLoading')
                }}</el-text>
              </div>
              <div class="detail-pane-scroll-host">
                <div class="detail-pane-scroll-inner detail-commit-diff-scroll-inner">
                <div v-if="!selectedCommitDiffPath" class="diff-placeholder">{{ t('history.pickFileLeft') }}</div>
                <div v-else-if="historyCommitDiffLoading" class="diff-placeholder">{{ t('history.inlineLoading') }}</div>
                <div
                  v-else-if="historyCommitDiffHtml"
                  class="diff2html-root"
                  v-html="historyCommitDiffHtml"
                  @contextmenu.prevent="(e) => onDiff2HtmlContextMenu(e, historyCommitDiffText)"
                />
                <pre
                  v-else-if="historyCommitDiffText && historyCommitDiffText !== EMPTY_DIFF_SENTINEL"
                  class="diff-pre"
                >{{ historyCommitDiffText }}</pre>
                <div v-else class="diff-placeholder">{{ t('changes.noDiff') }}</div>
                </div>
              </div>
            </div>
            </template>
          </ResizableSplit>
        </el-tab-pane>
      </el-tabs>
      </div>
        </div>
      </template>
    </ResizableSplit>
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
.detail-commit-collapse-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.detail-commit-collapse-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-file-quick-actions {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.detail-file-leaf-ico {
  display: inline-flex;
  align-items: center;
  margin-right: 4px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
</style>
