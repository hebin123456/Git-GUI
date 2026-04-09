<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const { onMenuCommand, repoPath, syncBusy, stashBusy } = useGitWorkspace()
</script>

<template>
  <div class="fork-menubar-outer no-drag">
    <div class="menubar-menus">
      <el-dropdown trigger="click" @command="onMenuCommand">
        <span class="menu-label">{{ t('menu.file') }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="file:open">{{ t('menu.fileOpen') }}</el-dropdown-item>
            <el-dropdown-item command="file:clone">{{ t('menu.fileClone') }}</el-dropdown-item>
            <el-dropdown-item command="file:refresh" :disabled="!repoPath">{{ t('menu.fileRefresh') }}</el-dropdown-item>
            <el-dropdown-item divided command="file:exit">{{ t('menu.fileExit') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onMenuCommand">
        <span class="menu-label">{{ t('menu.edit') }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="edit:refresh" :disabled="!repoPath">{{ t('menu.editRefresh') }}</el-dropdown-item>
            <el-dropdown-item command="edit:settings">{{ t('menu.editSettings') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onMenuCommand">
        <span class="menu-label">{{ t('menu.view') }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="view:changes">{{ t('menu.viewChanges') }}</el-dropdown-item>
            <el-dropdown-item command="view:history">{{ t('menu.viewHistory') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onMenuCommand">
        <span class="menu-label">{{ t('menu.repo') }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="repo:fetch" :disabled="!repoPath || !!syncBusy || stashBusy">{{
              t('menu.repoFetch')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:pull" :disabled="!repoPath || !!syncBusy || stashBusy">{{
              t('menu.repoPull')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:push" :disabled="!repoPath || !!syncBusy || stashBusy">{{
              t('menu.repoPush')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:hosting-compare" :disabled="!repoPath">
              {{ t('menu.repoHostingCompare') }}
            </el-dropdown-item>
            <el-dropdown-item divided command="repo:compare" :disabled="!repoPath">{{ t('menu.repoCompare') }}</el-dropdown-item>
            <el-dropdown-item command="repo:reflog" :disabled="!repoPath">{{ t('menu.repoReflog') }}</el-dropdown-item>
            <el-dropdown-item command="repo:worktree" :disabled="!repoPath">{{ t('menu.repoWorktree') }}</el-dropdown-item>
            <el-dropdown-item command="repo:bisect" :disabled="!repoPath">{{ t('menu.repoBisect') }}</el-dropdown-item>
            <el-dropdown-item command="repo:rebase-todo" :disabled="!repoPath">{{ t('menu.repoRebaseTodo') }}</el-dropdown-item>
            <el-dropdown-item command="repo:rebase-interactive-start" :disabled="!repoPath">
              {{ t('menu.repoRebaseInteractiveStart') }}
            </el-dropdown-item>
            <el-dropdown-item command="repo:rebase-interactive-hint" :disabled="!repoPath">
              {{ t('menu.repoRebaseInteractiveHint') }}
            </el-dropdown-item>
            <el-dropdown-item command="repo:blame" :disabled="!repoPath">{{ t('menu.repoBlame') }}</el-dropdown-item>
            <el-dropdown-item command="repo:file-history" :disabled="!repoPath">{{ t('menu.repoFileHistory') }}</el-dropdown-item>
            <el-dropdown-item command="repo:add-partial-hint" :disabled="!repoPath">{{
              t('menu.repoAddPartialHint')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:stash-push-patch" :disabled="!repoPath">{{
              t('menu.repoStashPushPatch')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:stash-detail" :disabled="!repoPath">{{ t('menu.repoStashDetail') }}</el-dropdown-item>
            <el-dropdown-item command="repo:remote-prune" :disabled="!repoPath">{{ t('menu.repoRemotePrune') }}</el-dropdown-item>
            <el-dropdown-item command="repo:push-delete" :disabled="!repoPath">{{ t('menu.repoPushDelete') }}</el-dropdown-item>
            <el-dropdown-item divided command="repo:lfs-install" :disabled="!repoPath">{{
              t('menu.repoLfsInstall')
            }}</el-dropdown-item>
            <el-dropdown-item command="repo:lfs-pull" :disabled="!repoPath">{{ t('menu.repoLfsPull') }}</el-dropdown-item>
            <el-dropdown-item command="repo:lfs-tools" :disabled="!repoPath">{{ t('menu.repoLfsTools') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="onMenuCommand">
        <span class="menu-label">{{ t('menu.help') }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="help:about">{{ t('menu.helpAbout') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>
