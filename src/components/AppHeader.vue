<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const {
  repoPath,
  currentBranch,
  status,
  remotes,
  selectedRemote
} = useGitWorkspace()
</script>

<template>
      <el-header class="fork-header-wrap" height="auto">
        <!-- Fetch/Pull/Push/Stash 与仓库名在 AppRibbon；此处为分支、同步状态与远程 -->
        <div class="fork-toolbar">
          <div class="tb-center tb-center-compact drag-region">
            <el-tag v-if="currentBranch" type="info" effect="plain" class="branch-pill" size="small">
              {{ currentBranch }}
            </el-tag>
            <el-text v-if="repoPath" class="repo-path-hint" truncated type="info" size="small" :title="repoPath ?? ''">
              {{ repoPath }}
            </el-text>
            <span v-if="!repoPath" class="repo-title-muted">{{ t('header.openRepoHint') }}</span>
          </div>
          <div class="tb-right no-drag">
            <template v-if="status">
              <el-tag v-if="status.ahead || status.behind" type="warning" size="small" effect="plain">
                ↑{{ status.ahead }} ↓{{ status.behind }}
              </el-tag>
              <el-tag v-else type="success" size="small" effect="plain">{{ t('header.inSync') }}</el-tag>
            </template>
            <el-button size="small" plain disabled>{{ t('header.newBranch') }}</el-button>
            <el-tooltip :content="t('header.remoteTooltip')" placement="bottom">
              <el-select
                v-model="selectedRemote"
                clearable
                :placeholder="t('header.remotePh')"
                size="small"
                class="remote-select"
                :disabled="!repoPath"
              >
                <el-option v-for="n in remotes" :key="n" :label="n" :value="n" />
              </el-select>
            </el-tooltip>
          </div>
        </div>
      </el-header>

</template>

