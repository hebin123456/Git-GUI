<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { i18n } from '../i18n/index.ts'
import type { GitOngoingOperation } from '../types/git-client'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()

const {
  repoPath,
  status,
  syncBusy,
  commitBusy,
  stashBusy,
  runMergeContinue,
  runMergeAbort,
  runRebaseContinue,
  runRebaseAbort,
  runRebaseSkip,
  runCherryPickContinue,
  runCherryPickAbort,
  runRevertContinue,
  runRevertAbort,
  runBisectStep
} = useGitWorkspace()

const ongoing = computed(() => status.value?.ongoingOperation ?? null)
const bisectOn = computed(() => status.value?.bisectActive === true)

const conflictHint = computed(() => {
  void i18n.global.locale.value
  const n = status.value?.conflicted?.length ?? 0
  if (n <= 0) return ''
  return t('banner.conflictHint', { n })
})

const title = computed(() => {
  void i18n.global.locale.value
  const op = ongoing.value
  if (!op) return ''
  const map: Record<GitOngoingOperation, string> = {
    merge: t('banner.merge'),
    rebase: t('banner.rebase'),
    'cherry-pick': t('banner.cherryPick'),
    revert: t('banner.revert')
  }
  return map[op]
})

const busy = computed(() => syncBusy.value != null || commitBusy.value || stashBusy.value)
</script>

<template>
  <div v-if="repoPath && ongoing" class="fork-git-op-banner no-drag">
    <el-alert type="warning" :closable="false" show-icon class="fork-git-op-alert">
      <template #title>
        <span class="fork-git-op-title">{{ title }}</span>
        <span v-if="conflictHint" class="fork-git-op-conflict">{{ conflictHint }}</span>
      </template>
      <div class="fork-git-op-actions">
        <template v-if="ongoing === 'merge'">
          <el-button size="small" type="primary" :disabled="busy" @click="runMergeContinue">{{
            t('banner.continue')
          }}</el-button>
          <el-button size="small" :disabled="busy" @click="runMergeAbort">{{ t('banner.mergeAbort') }}</el-button>
        </template>
        <template v-else-if="ongoing === 'rebase'">
          <el-button size="small" type="primary" :disabled="busy" @click="runRebaseContinue">{{
            t('banner.continue')
          }}</el-button>
          <el-button size="small" :disabled="busy" @click="runRebaseSkip">{{ t('banner.rebaseSkip') }}</el-button>
          <el-button size="small" :disabled="busy" @click="runRebaseAbort">{{ t('banner.rebaseAbort') }}</el-button>
        </template>
        <template v-else-if="ongoing === 'cherry-pick'">
          <el-button size="small" type="primary" :disabled="busy" @click="runCherryPickContinue">{{
            t('banner.continue')
          }}</el-button>
          <el-button size="small" :disabled="busy" @click="runCherryPickAbort">{{ t('banner.cherryPickAbort') }}</el-button>
        </template>
        <template v-else-if="ongoing === 'revert'">
          <el-button size="small" type="primary" :disabled="busy" @click="runRevertContinue">{{
            t('banner.continue')
          }}</el-button>
          <el-button size="small" :disabled="busy" @click="runRevertAbort">{{ t('banner.revertAbort') }}</el-button>
        </template>
      </div>
    </el-alert>
  </div>
  <div v-if="repoPath && bisectOn" class="fork-git-op-banner fork-git-bisect-banner no-drag">
    <el-alert type="info" :closable="false" show-icon class="fork-git-op-alert">
      <template #title>
        <span class="fork-git-op-title">{{ t('banner.bisectTitle') }}</span>
        <span class="fork-git-op-conflict">{{ t('banner.bisectHint') }}</span>
      </template>
      <div class="fork-git-op-actions">
        <el-button size="small" type="success" :disabled="busy" @click="() => void runBisectStep('good')">
          {{ t('banner.bisectGood') }}
        </el-button>
        <el-button size="small" type="danger" :disabled="busy" @click="() => void runBisectStep('bad')">
          {{ t('banner.bisectBad') }}
        </el-button>
        <el-button size="small" :disabled="busy" @click="() => void runBisectStep('skip')">{{
          t('banner.bisectSkip')
        }}</el-button>
        <el-button size="small" :disabled="busy" @click="() => void runBisectStep('reset')">{{
          t('banner.bisectReset')
        }}</el-button>
      </div>
    </el-alert>
  </div>
</template>
