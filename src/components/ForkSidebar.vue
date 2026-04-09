<script setup lang="ts">
import { computed, nextTick, reactive, ref, unref, watch } from 'vue'
import { ArrowRight, CaretRight, EditPen, Clock, Search, Check, MoreFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DropdownInstance } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { forkCreateDialogFns, useGitWorkspace } from '../composables/useGitWorkspace.ts'
import SidebarCreateDialogs from './SidebarCreateDialogs.vue'

const { t } = useI18n()

/** 侧栏各分组展开状态（默认展开） */
const sectionOpen = reactive({
  branches: true,
  remotes: true,
  tags: true,
  stash: true,
  submodules: true
})

const {
  repoTitle,
  repoPath,
  renameActiveRepoTab,
  activeView,
  changeCount,
  sidebarSearch,
  filteredBranches,
  localBranchTracking,
  setBranchUpstream,
  prefetchRemoteBranchesForTrackMenu,
  filteredRemoteSidebarBranches,
  remoteDetails,
  remoteDetailsFiltered,
  filteredGitTags,
  filteredStashEntries,
  filteredSubmoduleItems,
  currentBranch,
  onBranchSelect,
  onBranchChange,
  renameLocalBranch,
  deleteLocalBranch,
  remoteSidebarBranches,
  remoteSidebarExpanded,
  remoteSidebarLoadingBranchList,
  copyRemoteFetchUrl,
  fetchRemoteForSidebar,
  removeRemoteFromSidebar,
  toggleRemoteBranchesExpanded,
  gitTags,
  stashEntries,
  submoduleItems,
  shortSha,
  selectedSidebarRef,
  selectHistoryFromLocalBranch,
  selectHistoryFromTag,
  selectHistoryFromRemoteBranch,
  selectHistoryFromStash,
  dropStash,
  stashApply,
  stashPop,
  mergeIntoHead,
  rebaseOnto,
  openTagDeleteDialog,
  openSubmoduleInExplorer,
  openSubmoduleInGitTerminal,
  copySubmodulePathToClipboard,
  removeSubmodule,
  runSubmoduleUpdateSync,
  runSubmoduleSync,
  runSubmoduleUpdateRemote,
  runSubmoduleForeachPreset
} = useGitWorkspace()

function submoduleAbsDisplayPath(rel: string): string {
  const r = repoPath.value?.replace(/[/\\]+$/, '') ?? ''
  if (!r) return rel
  const sep = r.includes('\\') ? '\\' : '/'
  return r + sep + rel.replace(/\//g, sep)
}

function isSidebarBranchSelected(b: string) {
  const s = selectedSidebarRef.value
  return s?.kind === 'branch' && s.name === b
}

function isSidebarTagSelected(t: string) {
  const s = selectedSidebarRef.value
  return s?.kind === 'tag' && s.name === t
}

function isSidebarRemoteBranchSelected(remote: string, branch: string) {
  const s = selectedSidebarRef.value
  return s?.kind === 'remoteBranch' && s.remote === remote && s.branch === branch
}

function isSidebarStashSelected(index: number) {
  const s = selectedSidebarRef.value
  return s?.kind === 'stash' && s.index === index
}

/**
 * 侧栏「提交图选中」全局只能有一项高亮（selectedSidebarRef）。
 * 当选中的是 tag / 远程分支 / 其它本地分支时，检出分支行去掉 .current 整块高亮，只保留打勾。
 * 仅当选中项就是当前检出分支（本地）时，保留 .current。
 */
const isCurrentBranchRowStyleMuted = computed(() => {
  const s = selectedSidebarRef.value
  if (!s) return false
  if (s.kind === 'branch' && s.name.trim() === currentBranch.value.trim()) {
    return false
  }
  return true
})

async function copyBranchName(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    ElMessage.success(t('sidebar.copiedBranch'))
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = name
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success(t('sidebar.copiedBranch'))
    } catch {
      ElMessage.error(t('sidebar.copyFailed'))
    }
  }
}

async function copyTagName(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    ElMessage.success(t('sidebar.copiedTag'))
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = name
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success(t('sidebar.copiedTag'))
    } catch {
      ElMessage.error(t('sidebar.copyFailed'))
    }
  }
}

/** 分支行右键菜单：嵌套 Popover 需 hide-on-click=false，否则点击会关闭菜单导致二级面板无法出现 */
const branchRowDropdownRefs = ref<Record<string, DropdownInstance | null>>({})

function setBranchRowDropdownRef(branch: string, el: unknown) {
  if (el) branchRowDropdownRefs.value[branch] = el as DropdownInstance
  else delete branchRowDropdownRefs.value[branch]
}

function branchMenuDropdownRef(branch: string) {
  return (el: unknown) => setBranchRowDropdownRef(branch, el)
}

function closeBranchRowMenu(branch: string) {
  branchRowDropdownRefs.value[branch]?.handleClose()
}

/** 使用各菜单项的 @click，避免 v-for + el-dropdown @command 在部分环境下不派发 */
function branchMenuCheckout(branch: string) {
  closeBranchRowMenu(branch)
  void onBranchChange(branch)
}

function branchMenuMergeInto(branch: string) {
  closeBranchRowMenu(branch)
  void mergeIntoHead(branch)
}

function branchMenuRebaseOnto(branch: string) {
  closeBranchRowMenu(branch)
  void rebaseOnto(branch)
}

async function copyBranchNameFromBranchMenu(name: string) {
  closeBranchRowMenu(name)
  await copyBranchName(name)
}

async function openRenameBranchFromMenu(from: string) {
  closeBranchRowMenu(from)
  await openRenameBranch(from)
}

async function confirmDeleteBranchFromMenu(name: string) {
  closeBranchRowMenu(name)
  await confirmDeleteBranch(name)
}

async function openRenameBranch(from: string) {
  try {
    const { value } = await ElMessageBox.prompt(t('sidebar.promptNewBranchName'), t('sidebar.promptRenameBranchTitle', { name: from }), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValue: from,
      inputPattern: /\S/,
      inputErrorMessage: t('sidebar.nameRequired')
    })
    await renameLocalBranch(from, String(value).trim())
  } catch {
    /* 取消 */
  }
}

async function onRepoHeadCommand(cmd: string | number) {
  if (String(cmd) !== 'rename') return
  try {
    const { value } = await ElMessageBox.prompt(t('sidebar.promptNewProjectName'), t('sidebar.promptRenameProjectTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputValue: unref(repoTitle),
      inputPattern: /\S/,
      inputErrorMessage: t('sidebar.nameRequired')
    })
    renameActiveRepoTab(String(value).trim())
    ElMessage.success(t('sidebar.projectRenamed'))
  } catch {
    /* 取消 */
  }
}

function onLocalBranchHeadCommand(cmd: string | number) {
  if (String(cmd) === 'new') forkCreateDialogFns.openNewBranch()
}

function onRemoteHeadCommand(cmd: string | number) {
  if (String(cmd) === 'new') forkCreateDialogFns.openAddRemote()
}

function onTagHeadCommand(cmd: string | number) {
  if (String(cmd) === 'new') forkCreateDialogFns.openCreateTag()
}

function onSubmoduleHeadCommand(cmd: string | number) {
  const c = String(cmd)
  if (c === 'new') forkCreateDialogFns.openAddSubmodule()
  else if (c === 'update') void runSubmoduleUpdateSync()
  else if (c === 'sync') void runSubmoduleSync()
  else if (c === 'update-remote-merge') void runSubmoduleUpdateRemote({ rebase: false })
  else if (c === 'update-remote-rebase') void runSubmoduleUpdateRemote({ rebase: true })
  else if (c === 'foreach-fetch') void runSubmoduleForeachPreset('fetch')
  else if (c === 'foreach-pull') void runSubmoduleForeachPreset('pull')
  else if (c === 'foreach-pull-rebase') void runSubmoduleForeachPreset('pullRebase')
  else if (c === 'foreach-status') void runSubmoduleForeachPreset('status')
}

/** 有搜索且存在匹配的远程分支时，展开「远程仓库」分组，并展开各远程下的分支列表（二级）以便看到结果 */
watch(
  () => [sidebarSearch.value, remoteDetailsFiltered.value] as const,
  ([q, rds]) => {
    if (!String(q).trim() || !rds.length) return
    sectionOpen.remotes = true
  }
)

function branchAheadBehindText(branchName: string): string {
  const t = localBranchTracking.value.get(branchName)
  if (!t?.upstream) return ''
  const parts: string[] = []
  if (t.ahead > 0) parts.push(`${t.ahead}↑`)
  if (t.behind > 0) parts.push(`${t.behind}↓`)
  return parts.join(' ')
}

const trackRemoteFilter = ref('')
const trackRemoteAccordion = ref<string[]>([])

function onTrackPopoverShow() {
  trackRemoteFilter.value = ''
  void nextTick(() => {
    trackRemoteAccordion.value = remoteDetails.value.map((r) => r.name)
  })
}

function trackBranchesForRemote(remoteName: string): string[] {
  const raw = remoteSidebarBranches.value[remoteName] ?? []
  const q = trackRemoteFilter.value.trim().toLowerCase()
  if (!q) return raw
  const rmn = remoteName.toLowerCase()
  return raw.filter(
    (br) =>
      br.toLowerCase().includes(q) ||
      `${remoteName}/${br}`.toLowerCase().includes(q) ||
      rmn.includes(q)
  )
}

const trackRemotesToShow = computed(() => {
  const q = trackRemoteFilter.value.trim().toLowerCase()
  const list = remoteDetails.value
  if (!q) return list
  return list.filter((rm) => {
    if (rm.name.toLowerCase().includes(q)) return true
    const branches = remoteSidebarBranches.value[rm.name] ?? []
    return branches.some(
      (br) =>
        br.toLowerCase().includes(q) || `${rm.name}/${br}`.toLowerCase().includes(q)
    )
  })
})

function trackVisibleBranchCount(remoteName: string): number {
  return trackBranchesForRemote(remoteName).length
}

function pickTrackRemote(localBranch: string, remote: string, br: string) {
  closeBranchRowMenu(localBranch)
  void setBranchUpstream(localBranch, `${remote}/${br}`)
}

async function confirmDeleteBranch(name: string) {
  try {
    await ElMessageBox.confirm(t('sidebar.deleteBranchConfirm', { name }), t('sidebar.deleteBranchTitle'), {
      type: 'warning',
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  const err = await deleteLocalBranch(name, false)
  if (!err) return
  try {
    await ElMessageBox.confirm(
      t('sidebar.forceDeleteBranchConfirm', { error: err.error }),
      t('sidebar.forceDeleteBranchTitle'),
      {
        type: 'warning',
        confirmButtonText: t('sidebar.forceDelete'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  await deleteLocalBranch(name, true)
}
</script>

<template>
  <SidebarCreateDialogs />
  <el-aside width="272px" class="fork-sidebar">
    <div class="sidebar-repo-row">
      <span class="sidebar-repo-name" :title="repoPath ?? undefined">{{ repoTitle }}</span>
      <el-dropdown trigger="click" class="sidebar-repo-dropdown" @command="onRepoHeadCommand">
        <el-button
          text
          class="sidebar-repo-menu-btn"
          :title="t('sidebar.repoMenuTitle')"
          @click.stop
        >
          <el-icon :size="16"><MoreFilled /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="rename">{{ t('sidebar.renameProject') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <button
      type="button"
      class="sidebar-nav"
      :class="{ active: activeView === 'changes' }"
      @click="activeView = 'changes'"
    >
      <el-icon :size="16"><EditPen /></el-icon>
      <span>{{ t('sidebar.navChanges') }}</span>
      <el-badge v-if="changeCount > 0" :value="changeCount" class="nav-badge" />
    </button>
    <button
      type="button"
      class="sidebar-nav"
      :class="{ active: activeView === 'history' }"
      @click="activeView = 'history'"
    >
      <el-icon :size="16"><Clock /></el-icon>
      <span>{{ t('sidebar.navHistory') }}</span>
    </button>
    <el-input
      v-model="sidebarSearch"
      size="small"
      clearable
      :placeholder="t('sidebar.searchPlaceholder')"
      class="sidebar-search"
    >
      <template #prefix>
        <el-icon><Search /></el-icon>
      </template>
    </el-input>
    <el-scrollbar class="sidebar-tree-scroll">
      <div class="sidebar-collapsible">
        <div class="sidebar-section-head">
          <button
            type="button"
            class="sidebar-section-toggle"
            :class="{ 'is-open': sectionOpen.branches }"
            :aria-expanded="sectionOpen.branches"
            :aria-label="t('sidebar.ariaBranches')"
            @click.stop="sectionOpen.branches = !sectionOpen.branches"
          >
            <el-icon :size="12"><CaretRight /></el-icon>
          </button>
          <el-dropdown
            trigger="contextmenu"
            class="sidebar-section-head-dropdown"
            @command="onLocalBranchHeadCommand"
          >
            <span class="sidebar-section-title sidebar-section-title--ctx" :title="t('sidebar.ctxMenuTitle')">
              {{ t('sidebar.sectionBranches') }}
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new">{{ t('sidebar.newBranch') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-show="sectionOpen.branches" class="sidebar-collapsible-body">
          <div class="branch-list">
            <el-dropdown
              v-for="b in filteredBranches"
              :key="b"
              :ref="branchMenuDropdownRef(b)"
              trigger="contextmenu"
              class="branch-item-dropdown"
              popper-class="fork-branch-ctx-dropdown-popper"
              :hide-on-click="false"
              @visible-change="(vis: boolean) => vis && void prefetchRemoteBranchesForTrackMenu()"
            >
              <button
                type="button"
                class="branch-item"
                :class="{
                  current: b === currentBranch && !isCurrentBranchRowStyleMuted,
                  'sidebar-ref-selected':
                    isSidebarBranchSelected(b) && b !== currentBranch
                }"
                :title="t('sidebar.branchRowTitle')"
                @click="selectHistoryFromLocalBranch(b)"
                @dblclick="onBranchSelect(b)"
              >
                <el-icon v-if="b === currentBranch" class="branch-check"><Check /></el-icon>
                <span class="branch-name">{{ b }}</span>
                <span
                  v-if="branchAheadBehindText(b)"
                  class="branch-ahead-behind"
                  :title="t('sidebar.branchAheadBehindHint')"
                  >{{ branchAheadBehindText(b) }}</span
                >
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :disabled="b === currentBranch" @click.stop="branchMenuCheckout(b)">
                    {{ t('sidebar.checkout', { branch: b }) }}
                  </el-dropdown-item>
                  <el-dropdown-item :disabled="b === currentBranch" @click.stop="branchMenuMergeInto(b)">
                    {{ t('sidebar.mergeIntoCurrent', { branch: b }) }}
                  </el-dropdown-item>
                  <el-dropdown-item :disabled="b === currentBranch" @click.stop="branchMenuRebaseOnto(b)">
                    {{ t('sidebar.rebaseOntoBranch', { branch: b }) }}
                  </el-dropdown-item>
                  <el-dropdown-item class="fork-branch-track-submenu-item" @click.stop>
                    <el-popover
                      placement="right-start"
                      trigger="click"
                      :teleported="false"
                      :width="320"
                      :show-arrow="true"
                      popper-class="fork-track-remote-popper"
                      @show="onTrackPopoverShow"
                    >
                      <template #reference>
                        <span class="fork-submenu-entry fork-submenu-entry--block">
                          {{ t('sidebar.trackRemoteBranch') }}
                          <el-icon :size="12"><ArrowRight /></el-icon>
                        </span>
                      </template>
                      <div
                        class="fork-track-remote-panel"
                        @mousedown.stop
                        @click.stop
                        @pointerdown.stop
                      >
                        <el-input
                          v-model="trackRemoteFilter"
                          size="small"
                          clearable
                          :placeholder="t('sidebar.trackRemoteSearchPh')"
                          class="fork-track-remote-search-input"
                        />
                        <p class="fork-track-remote-fold-hint">{{ t('sidebar.trackRemoteFoldHint') }}</p>
                        <template v-if="!remoteDetails.length">
                          <div class="fork-track-remote-empty">{{ t('sidebar.noRemotes') }}</div>
                        </template>
                        <template v-else-if="!trackRemotesToShow.length">
                          <div class="fork-track-remote-empty">{{ t('sidebar.trackRemoteNoMatch') }}</div>
                        </template>
                        <el-scrollbar v-else max-height="380" class="fork-track-remote-scroll">
                          <el-collapse
                            v-model="trackRemoteAccordion"
                            class="fork-track-remote-collapse"
                            @mousedown.stop
                            @click.stop
                          >
                            <el-collapse-item
                              v-for="rm in trackRemotesToShow"
                              :key="b + '-tr-' + rm.name"
                              :name="rm.name"
                            >
                              <template #title>
                                <span class="fork-track-collapse-title"
                                  >{{ rm.name }}
                                  <span class="fork-track-collapse-count"
                                    >({{ trackVisibleBranchCount(rm.name) }})</span
                                  ></span
                                >
                              </template>
                              <div v-if="remoteSidebarLoadingBranchList[rm.name]" class="fork-track-remote-hint">
                                {{ t('sidebar.remoteLoading') }}
                              </div>
                              <div
                                v-else-if="!(remoteSidebarBranches[rm.name]?.length)"
                                class="fork-track-remote-hint"
                              >
                                {{ t('sidebar.trackRemoteEmpty') }}
                              </div>
                              <div v-else-if="!trackBranchesForRemote(rm.name).length" class="fork-track-remote-hint">
                                {{ t('sidebar.trackRemoteNoMatch') }}
                              </div>
                              <div v-else class="fork-track-branch-list">
                                <button
                                  v-for="br in trackBranchesForRemote(rm.name)"
                                  :key="b + '-' + rm.name + '/' + br"
                                  type="button"
                                  class="fork-track-branch-btn"
                                  @click="pickTrackRemote(b, rm.name, br)"
                                >
                                  {{ rm.name }}/{{ br }}
                                </button>
                              </div>
                            </el-collapse-item>
                          </el-collapse>
                        </el-scrollbar>
                      </div>
                    </el-popover>
                  </el-dropdown-item>
                  <el-dropdown-item @click.stop="copyBranchNameFromBranchMenu(b)">{{ t('sidebar.copyBranchName') }}</el-dropdown-item>
                  <el-dropdown-item divided @click.stop="openRenameBranchFromMenu(b)">{{
                    t('sidebar.renameBranch', { name: b })
                  }}</el-dropdown-item>
                  <el-dropdown-item :disabled="b === currentBranch" divided @click.stop="confirmDeleteBranchFromMenu(b)">
                    {{ t('sidebar.deleteBranch', { name: b }) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>

      <div class="sidebar-collapsible">
        <div class="sidebar-section-head">
          <button
            type="button"
            class="sidebar-section-toggle"
            :class="{ 'is-open': sectionOpen.remotes }"
            :aria-expanded="sectionOpen.remotes"
            :aria-label="t('sidebar.ariaRemotes')"
            @click.stop="sectionOpen.remotes = !sectionOpen.remotes"
          >
            <el-icon :size="12"><CaretRight /></el-icon>
          </button>
          <el-dropdown
            trigger="contextmenu"
            class="sidebar-section-head-dropdown"
            @command="onRemoteHeadCommand"
          >
            <span class="sidebar-section-title sidebar-section-title--ctx" :title="t('sidebar.ctxMenuTitle')">
              {{ t('sidebar.sectionRemotes') }}
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new">{{ t('sidebar.addRemote') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-show="sectionOpen.remotes" class="sidebar-collapsible-body">
          <div class="remote-list">
            <div
              v-for="rm in remoteDetailsFiltered"
              :key="rm.name"
              class="remote-detail remote-detail--nested"
            >
              <div class="remote-detail-row">
                <button
                  type="button"
                  class="remote-nested-toggle"
                  :class="{
                    'is-open': !!sidebarSearch.trim() || remoteSidebarExpanded[rm.name]
                  }"
                  :aria-expanded="!!(sidebarSearch.trim() || remoteSidebarExpanded[rm.name])"
                  :aria-label="t('sidebar.ariaRemoteBranches', { remote: rm.name })"
                  @click.stop="toggleRemoteBranchesExpanded(rm.name)"
                >
                  <el-icon :size="10"><CaretRight /></el-icon>
                </button>
                <el-dropdown trigger="contextmenu" class="remote-item-dropdown">
                  <div class="remote-detail-inner">
                    <div class="remote-name">{{ rm.name }}</div>
                    <div v-if="rm.fetchUrl" class="remote-url" :title="rm.fetchUrl">{{ rm.fetchUrl }}</div>
                  </div>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click.stop="fetchRemoteForSidebar(rm.name)">{{ t('sidebar.fetch') }}</el-dropdown-item>
                      <el-dropdown-item @click.stop="forkCreateDialogFns.openEditRemote(rm)">{{ t('sidebar.edit') }}</el-dropdown-item>
                      <el-dropdown-item @click.stop="removeRemoteFromSidebar(rm.name)">{{ t('sidebar.delete') }}</el-dropdown-item>
                      <el-dropdown-item divided @click.stop="copyRemoteFetchUrl(rm)">{{ t('sidebar.copyUrl') }}</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <div
                v-show="!!sidebarSearch.trim() || remoteSidebarExpanded[rm.name]"
                class="remote-branches-nested"
              >
                <div v-if="remoteSidebarLoadingBranchList[rm.name]" class="remote-branch-hint">{{ t('sidebar.remoteLoading') }}</div>
                <template v-else>
                  <el-dropdown
                    v-for="br in filteredRemoteSidebarBranches[rm.name] ?? []"
                    :key="rm.name + '/' + br"
                    trigger="contextmenu"
                    class="remote-branch-item-dropdown"
                  >
                    <div
                      class="remote-branch-item mono"
                      :class="{ 'sidebar-ref-selected': isSidebarRemoteBranchSelected(rm.name, br) }"
                      :title="t('sidebar.remoteBranchTitle', { remote: rm.name, branch: br })"
                      role="button"
                      tabindex="0"
                      @click="selectHistoryFromRemoteBranch(rm.name, br)"
                      @keydown.enter.prevent="selectHistoryFromRemoteBranch(rm.name, br)"
                    >
                      {{ br }}
                    </div>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item @click.stop="mergeIntoHead(`${rm.name}/${br}`)">
                          {{ t('sidebar.mergeIntoCurrentShort') }}
                        </el-dropdown-item>
                        <el-dropdown-item @click.stop="rebaseOnto(`${rm.name}/${br}`)">
                          {{ t('sidebar.rebaseOntoHere') }}
                        </el-dropdown-item>
                        <el-dropdown-item divided @click.stop="copyBranchName(`${rm.name}/${br}`)">
                          {{ t('sidebar.copyBranchName') }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <div
                    v-if="(remoteSidebarBranches[rm.name]?.length ?? 0) === 0"
                    class="remote-branch-hint"
                  >
                    {{ t('sidebar.noRemoteBranches') }}
                  </div>
                  <div
                    v-else-if="
                      (filteredRemoteSidebarBranches[rm.name]?.length ?? 0) === 0 &&
                      sidebarSearch.trim()
                    "
                    class="remote-branch-hint"
                  >
                    {{ t('sidebar.noMatch') }}
                  </div>
                </template>
              </div>
            </div>
            <div v-if="!remoteDetails.length" class="remote-empty">{{ t('sidebar.noRemotes') }}</div>
            <div
              v-else-if="sidebarSearch.trim() && !remoteDetailsFiltered.length"
              class="remote-empty"
            >
              {{ t('sidebar.noMatchingRemoteBranch') }}
            </div>
          </div>
        </div>
      </div>

      <div class="sidebar-collapsible">
        <div class="sidebar-section-head">
          <button
            type="button"
            class="sidebar-section-toggle"
            :class="{ 'is-open': sectionOpen.tags }"
            :aria-expanded="sectionOpen.tags"
            :aria-label="t('sidebar.ariaTags')"
            @click.stop="sectionOpen.tags = !sectionOpen.tags"
          >
            <el-icon :size="12"><CaretRight /></el-icon>
          </button>
          <el-dropdown
            trigger="contextmenu"
            class="sidebar-section-head-dropdown"
            @command="onTagHeadCommand"
          >
            <span class="sidebar-section-title sidebar-section-title--ctx" :title="t('sidebar.ctxMenuTitle')">
              {{ t('sidebar.sectionTags') }}
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new">{{ t('sidebar.createTag') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-show="sectionOpen.tags" class="sidebar-collapsible-body">
          <div class="sidebar-tag-list">
            <el-dropdown
              v-for="tagName in filteredGitTags"
              :key="tagName"
              trigger="contextmenu"
              class="sidebar-tag-item-dropdown"
            >
              <div
                class="sidebar-item-row mono sidebar-tag-clickable"
                :class="{ 'sidebar-ref-selected': isSidebarTagSelected(tagName) }"
                role="button"
                tabindex="0"
                :title="t('sidebar.tagLocateTitle', { tag: tagName })"
                @click="selectHistoryFromTag(tagName)"
              >
                {{ tagName }}
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click.stop="mergeIntoHead(tagName)">{{ t('sidebar.mergeIntoCurrentFromTag') }}</el-dropdown-item>
                  <el-dropdown-item @click.stop="rebaseOnto(tagName)">{{ t('sidebar.rebaseOntoTag') }}</el-dropdown-item>
                  <el-dropdown-item divided @click.stop="openTagDeleteDialog(tagName)">{{ t('sidebar.deleteTag') }}</el-dropdown-item>
                  <el-dropdown-item @click.stop="copyTagName(tagName)">{{ t('sidebar.copyName') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div v-if="!gitTags.length" class="remote-empty">{{ t('sidebar.noTags') }}</div>
            <div
              v-else-if="sidebarSearch.trim() && !filteredGitTags.length"
              class="remote-empty"
            >
              {{ t('sidebar.noMatch') }}
            </div>
          </div>
        </div>
      </div>

      <div class="sidebar-collapsible">
        <div class="sidebar-section-head">
          <button
            type="button"
            class="sidebar-section-toggle"
            :class="{ 'is-open': sectionOpen.stash }"
            :aria-expanded="sectionOpen.stash"
            :aria-label="t('sidebar.ariaStash')"
            @click.stop="sectionOpen.stash = !sectionOpen.stash"
          >
            <el-icon :size="12"><CaretRight /></el-icon>
          </button>
          <span class="sidebar-section-title">{{ t('sidebar.sectionStash') }}</span>
        </div>
        <div v-show="sectionOpen.stash" class="sidebar-collapsible-body">
          <div class="sidebar-stash-list">
            <el-dropdown
              v-for="stashRow in filteredStashEntries"
              :key="stashRow.index"
              trigger="contextmenu"
              class="sidebar-stash-item-dropdown"
            >
              <div
                class="sidebar-stash-row sidebar-stash-clickable"
                :class="{ 'sidebar-ref-selected': isSidebarStashSelected(stashRow.index) }"
                role="button"
                tabindex="0"
                :title="t('sidebar.stashRowTitle', { label: stashRow.label })"
                @click="selectHistoryFromStash(stashRow.index)"
              >
                <span class="stash-idx">#{{ stashRow.index }}</span>
                <span class="stash-label">{{ stashRow.label }}</span>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click.stop="stashApply(stashRow.index)">{{ t('sidebar.applyStash') }}</el-dropdown-item>
                  <el-dropdown-item @click.stop="stashPop(stashRow.index)">{{ t('sidebar.popStash') }}</el-dropdown-item>
                  <el-dropdown-item divided @click.stop="dropStash(stashRow.index)">{{ t('sidebar.dropStash') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div v-if="!stashEntries.length" class="remote-empty">{{ t('sidebar.noStash') }}</div>
            <div
              v-else-if="sidebarSearch.trim() && !filteredStashEntries.length"
              class="remote-empty"
            >
              {{ t('sidebar.noMatch') }}
            </div>
          </div>
        </div>
      </div>

      <div class="sidebar-collapsible">
        <div class="sidebar-section-head">
          <button
            type="button"
            class="sidebar-section-toggle"
            :class="{ 'is-open': sectionOpen.submodules }"
            :aria-expanded="sectionOpen.submodules"
            :aria-label="t('sidebar.ariaSubmodules')"
            @click.stop="sectionOpen.submodules = !sectionOpen.submodules"
          >
            <el-icon :size="12"><CaretRight /></el-icon>
          </button>
          <el-dropdown
            trigger="contextmenu"
            class="sidebar-section-head-dropdown"
            @command="onSubmoduleHeadCommand"
          >
            <span class="sidebar-section-title sidebar-section-title--ctx" :title="t('sidebar.ctxMenuTitle')">
              {{ t('sidebar.sectionSubmodules') }}
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new">{{ t('sidebar.addSubmodule') }}</el-dropdown-item>
                <el-dropdown-item command="update">{{ t('sidebar.subUpdate') }}</el-dropdown-item>
                <el-dropdown-item command="sync">{{ t('sidebar.subSync') }}</el-dropdown-item>
                <el-dropdown-item command="update-remote-merge">{{ t('sidebar.subUpdateRemoteMerge') }}</el-dropdown-item>
                <el-dropdown-item command="update-remote-rebase">{{ t('sidebar.subUpdateRemoteRebase') }}</el-dropdown-item>
                <el-dropdown-item divided command="foreach-fetch">{{ t('sidebar.subForeachFetch') }}</el-dropdown-item>
                <el-dropdown-item command="foreach-pull">{{ t('sidebar.subForeachPull') }}</el-dropdown-item>
                <el-dropdown-item command="foreach-pull-rebase">{{ t('sidebar.subForeachPullRebase') }}</el-dropdown-item>
                <el-dropdown-item command="foreach-status">{{ t('sidebar.subForeachStatus') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-show="sectionOpen.submodules" class="sidebar-collapsible-body">
          <div class="sidebar-submodule-list">
            <el-dropdown
              v-for="sm in filteredSubmoduleItems"
              :key="sm.path"
              trigger="contextmenu"
              class="sidebar-submodule-item-dropdown"
            >
              <div
                class="sidebar-submodule-row"
                :title="t('sidebar.submoduleRowTitle', { path: submoduleAbsDisplayPath(sm.path) })"
              >
                <span class="mono sm-path">{{ sm.path }}</span>
                <span class="mono sm-sha">{{ shortSha(sm.sha) }}</span>
                <span v-if="sm.ref" class="sm-ref">({{ sm.ref }})</span>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click.stop="openSubmoduleInGitTerminal(sm.path)">
                    {{ t('sidebar.openInGitTerminal') }}
                  </el-dropdown-item>
                  <el-dropdown-item @click.stop="openSubmoduleInExplorer(sm.path)">
                    {{ t('sidebar.openInExplorer') }}
                  </el-dropdown-item>
                  <el-dropdown-item @click.stop="copySubmodulePathToClipboard(sm.path)">
                    {{ t('sidebar.copyPath') }}
                  </el-dropdown-item>
                  <el-dropdown-item divided @click.stop="removeSubmodule(sm.path)">
                    {{ t('sidebar.remove') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <div v-if="!submoduleItems.length" class="remote-empty">{{ t('sidebar.noSubmodules') }}</div>
            <div
              v-else-if="sidebarSearch.trim() && !filteredSubmoduleItems.length"
              class="remote-empty"
            >
              {{ t('sidebar.noMatch') }}
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </el-aside>
</template>
