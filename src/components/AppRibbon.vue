<script setup lang="ts">
import {
  ArrowDown,
  Bottom,
  Box,
  Refresh,
  Share,
  Top
} from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const {
  repoPath,
  repoTitle,
  syncBusy,
  stashBusy,
  openFetchSyncDialog,
  openPullSyncDialog,
  openPushSyncDialog,
  openStashSyncDialog,
  openStashDetailDialog,
  openPartialStashPushInTerminal,
  openHostingCompareInBrowser,
  openRepoInExplorer,
  openRepoInGitTerminal,
  quickStashAll
} = useGitWorkspace()

function onOpenCommand(cmd: string) {
  if (cmd === 'explorer') void openRepoInExplorer()
  if (cmd === 'git_terminal') void openRepoInGitTerminal()
}

function onStashCommand(cmd: string) {
  if (cmd === 'stash_dialog') void openStashSyncDialog()
  if (cmd === 'stash_detail') openStashDetailDialog()
  if (cmd === 'stash_patch') void openPartialStashPushInTerminal()
}
</script>

<template>
  <div class="fork-ribbon no-drag">
    <div class="fork-ribbon-left">
      <el-button
        class="fork-ribbon-icon-btn"
        size="small"
        :title="t('ribbon.fetch')"
        :loading="syncBusy === 'fetch'"
        :disabled="!repoPath || !!syncBusy || stashBusy"
        @click="openFetchSyncDialog"
      >
        <el-icon :size="18"><Refresh /></el-icon>
      </el-button>
      <el-button
        class="fork-ribbon-icon-btn"
        size="small"
        :title="t('ribbon.pull')"
        :loading="syncBusy === 'pull'"
        :disabled="!repoPath || !!syncBusy || stashBusy"
        @click="openPullSyncDialog"
      >
        <el-icon :size="18"><Bottom /></el-icon>
      </el-button>
      <el-button
        class="fork-ribbon-icon-btn"
        size="small"
        :title="t('ribbon.push')"
        :loading="syncBusy === 'push'"
        :disabled="!repoPath || !!syncBusy || stashBusy"
        @click="openPushSyncDialog"
      >
        <el-icon :size="18"><Top /></el-icon>
      </el-button>
      <el-dropdown
        split-button
        class="fork-ribbon-stash-split"
        size="small"
        trigger="click"
        :disabled="!repoPath || !!syncBusy || stashBusy"
        :title="t('ribbon.stashMore')"
        @click="quickStashAll"
        @command="onStashCommand"
      >
        <span class="fork-ribbon-split-main" :title="t('ribbon.stashQuick')">
          <el-icon :size="18"><Box /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="stash_dialog">{{ t('ribbon.stashMenu') }}</el-dropdown-item>
            <el-dropdown-item command="stash_detail">{{ t('ribbon.stashDetail') }}</el-dropdown-item>
            <el-dropdown-item command="stash_patch">{{ t('ribbon.stashPatch') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button
        class="fork-ribbon-icon-btn fork-ribbon-compare-btn"
        size="small"
        type="primary"
        plain
        :disabled="!repoPath || !!syncBusy || stashBusy"
        :title="t('ribbon.comparePrTitle')"
        @click="openHostingCompareInBrowser"
      >
        <el-icon :size="18"><Share /></el-icon>
      </el-button>
    </div>
    <div class="fork-ribbon-center drag-region">
      <span v-if="repoPath" class="fork-ribbon-repo-name" :title="repoPath">{{ repoTitle }}</span>
      <span v-else class="fork-ribbon-repo-placeholder">{{ t('ribbon.noRepo') }}</span>
    </div>
    <div class="fork-ribbon-right">
      <el-dropdown trigger="click" :disabled="!repoPath" @command="onOpenCommand">
        <el-button size="small" type="primary" plain :disabled="!repoPath">
          {{ t('ribbon.open') }}
          <el-icon class="fork-ribbon-dd-ico"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="git_terminal">{{ t('ribbon.openGitTerminal') }}</el-dropdown-item>
            <el-dropdown-item command="explorer">{{ t('ribbon.openExplorer') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<style scoped>
.fork-ribbon-icon-btn {
  padding: 6px 10px;
  min-width: 34px;
}
.fork-ribbon-compare-btn {
  padding: 6px 10px;
  min-width: 34px;
}
.fork-ribbon-stash-split {
  vertical-align: top;
}
.fork-ribbon-stash-split :deep(.el-button-group .el-button) {
  padding: 6px 10px;
  min-height: 32px;
}
.fork-ribbon-stash-split :deep(.el-button-group .el-button--default:first-child) {
  min-width: 34px;
}
.fork-ribbon-split-main {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
