<script setup lang="ts">
import { Box } from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const api = window.gitClient
const { t } = useI18n()

const {
  fetchDialogOpen,
  pullDialogOpen,
  pushDialogOpen,
  stashDialogOpen,
  remotes,
  selectedRemote,
  currentBranch,
  branches,
  unstagedRows,
  displayStagedRows,
  status,
  runFetch,
  runPull,
  runPush,
  runStashPush,
  syncBusy,
  stashBusy
} = useGitWorkspace()

function stashDefaultIncludeUntracked(): boolean {
  const s = status.value
  if (!s || s.isClean) return false
  if (!s.not_added.length) return false
  return (
    s.conflicted.length +
      s.created.length +
      s.deleted.length +
      s.modified.length +
      s.staged.length +
      s.renamed.length ===
    0
  )
}

/* —— Fetch —— */
const fetchRemote = ref('')
const fetchAllRemotes = ref(false)
const fetchPrune = ref(false)

watch(
  () => fetchDialogOpen.value,
  (open) => {
    if (!open) return
    fetchAllRemotes.value = false
    fetchPrune.value = false
    fetchRemote.value = selectedRemote.value || remotes.value[0] || ''
  }
)

watch(fetchAllRemotes, (all) => {
  if (all) fetchRemote.value = ''
})

const canFetch = computed(() => fetchAllRemotes.value || !!fetchRemote.value.trim())

function onFetchSubmit() {
  void runFetch({
    all: fetchAllRemotes.value,
    remote: fetchAllRemotes.value ? undefined : fetchRemote.value.trim() || undefined,
    prune: fetchPrune.value || undefined
  })
}

/* —— Pull —— */
const pullRemote = ref('')
const pullBranch = ref('')
const pullRebase = ref(false)
const pullAutostash = ref(false)
const pullBranchesLoading = ref(false)
const pullRemoteBranchList = ref<string[]>([])

async function loadPullBranches() {
  const r = pullRemote.value.trim()
  if (!r) {
    pullRemoteBranchList.value = []
    return
  }
  pullBranchesLoading.value = true
  const res = await api.remoteBranches(r)
  pullBranchesLoading.value = false
  if ('error' in res) {
    pullRemoteBranchList.value = []
    return
  }
  pullRemoteBranchList.value = res.branches
}

watch(
  () => pullDialogOpen.value,
  (open) => {
    if (!open) return
    pullRemote.value = selectedRemote.value || remotes.value[0] || ''
    pullBranch.value = ''
    pullRebase.value = false
    pullAutostash.value = false
    void loadPullBranches().then(() => {
      const cur = currentBranch.value
      if (cur && pullRemoteBranchList.value.includes(cur)) pullBranch.value = cur
      else if (pullRemoteBranchList.value.length) pullBranch.value = pullRemoteBranchList.value[0]!
    })
  }
)

watch(() => pullRemote.value, () => {
  if (!pullDialogOpen.value) return
  void loadPullBranches().then(() => {
    if (pullBranch.value && !pullRemoteBranchList.value.includes(pullBranch.value)) {
      pullBranch.value = pullRemoteBranchList.value[0] ?? ''
    }
  })
})

const canPull = computed(() => !!pullRemote.value.trim())

function onPullSubmit() {
  void runPull({
    remote: pullRemote.value.trim(),
    branch: pullBranch.value.trim() || undefined,
    rebase: pullRebase.value,
    autostash: pullAutostash.value
  })
}

/* —— Push —— */
const pushLocalBranch = ref('')
const pushRemote = ref('')
const pushToBranch = ref('')
const pushSetUpstream = ref(true)
const pushTags = ref(false)
const pushForce = ref(false)
const pushForceWithLease = ref(false)
const pushPrune = ref(false)
const pushDryRun = ref(false)
const pushMode = ref<'branch' | 'tag'>('branch')
const pushSingleTagName = ref('')
const pushRemoteBranchList = ref<string[]>([])
const pushBranchesLoading = ref(false)

async function loadPushRemoteBranches() {
  const r = pushRemote.value.trim()
  if (!r) {
    pushRemoteBranchList.value = []
    return
  }
  pushBranchesLoading.value = true
  const res = await api.remoteBranches(r)
  pushBranchesLoading.value = false
  if ('error' in res) {
    pushRemoteBranchList.value = []
    return
  }
  pushRemoteBranchList.value = res.branches
}

watch(
  () => pushDialogOpen.value,
  (open) => {
    if (!open) return
    pushRemote.value = selectedRemote.value || remotes.value[0] || ''
    const loc = currentBranch.value || branches.value[0] || ''
    pushLocalBranch.value = loc
    pushToBranch.value = loc
    pushSetUpstream.value = true
    pushTags.value = false
    pushForce.value = false
    pushForceWithLease.value = false
    pushPrune.value = false
    pushDryRun.value = false
    pushMode.value = 'branch'
    pushSingleTagName.value = ''
    void loadPushRemoteBranches().then(() => {
      if (loc && pushRemoteBranchList.value.includes(loc)) pushToBranch.value = loc
      else if (pushRemoteBranchList.value.length) pushToBranch.value = pushRemoteBranchList.value[0]!
    })
  }
)

watch(
  () => pushRemote.value,
  () => {
    if (!pushDialogOpen.value) return
    void loadPushRemoteBranches().then(() => {
      const t = pushToBranch.value
      const loc = pushLocalBranch.value
      if (t && pushRemoteBranchList.value.includes(t)) return
      if (loc && pushRemoteBranchList.value.includes(loc)) {
        pushToBranch.value = loc
        return
      }
      if (pushRemoteBranchList.value.length) pushToBranch.value = pushRemoteBranchList.value[0]!
    })
  }
)

const canPush = computed(() => {
  const r = pushRemote.value.trim()
  if (!r) return false
  if (pushMode.value === 'tag') return !!pushSingleTagName.value.trim()
  return !!pushLocalBranch.value.trim()
})

watch(pushForce, (v) => {
  if (v) pushForceWithLease.value = false
})
watch(pushForceWithLease, (v) => {
  if (v) pushForce.value = false
})

function onPushSubmit() {
  const rem = pushRemote.value.trim()
  if (pushMode.value === 'tag') {
    void runPush({
      remote: rem,
      tagOnly: pushSingleTagName.value.trim(),
      dryRun: pushDryRun.value || undefined
    })
    return
  }
  const loc = pushLocalBranch.value.trim()
  const to = pushToBranch.value.trim()
  void runPush({
    remote: rem,
    localBranch: loc,
    remoteBranch: to && to !== loc ? to : undefined,
    setUpstream: pushSetUpstream.value,
    tags: pushTags.value,
    force: pushForce.value && !pushForceWithLease.value,
    forceWithLease: pushForceWithLease.value || undefined,
    prune: pushPrune.value || undefined,
    dryRun: pushDryRun.value || undefined
  })
}

/* —— Stash —— */
const stashMessage = ref('')
const stashStageNewFiles = ref(false)
const stashOnlySelectedPaths = ref(false)
const stashPathsPick = ref<string[]>([])

const stashPathOptions = computed(() => {
  const set = new Set<string>()
  for (const r of unstagedRows.value) set.add(r.path)
  for (const r of displayStagedRows.value) set.add(r.path)
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
})

watch(
  () => stashDialogOpen.value,
  (open) => {
    if (!open) return
    stashMessage.value = ''
    stashStageNewFiles.value = stashDefaultIncludeUntracked()
    stashOnlySelectedPaths.value = false
    stashPathsPick.value = []
  }
)

function onStashSubmit() {
  if (stashOnlySelectedPaths.value) {
    const paths = stashPathsPick.value.filter(Boolean)
    if (!paths.length) {
      ElMessage.warning(t('syncUi.stashPathsRequired'))
      return
    }
    void runStashPush({
      message: stashMessage.value.trim() || undefined,
      includeUntracked: stashStageNewFiles.value,
      paths
    })
    return
  }
  void runStashPush({
    message: stashMessage.value.trim() || undefined,
    includeUntracked: stashStageNewFiles.value
  })
}
</script>

<template>
  <el-dialog
    v-model="fetchDialogOpen"
    width="440px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path
              fill="currentColor"
              d="M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z"
            />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('syncUi.fetchTitle') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('syncUi.fetchSub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('syncUi.remoteLabel') }}</label>
        <el-select
          v-model="fetchRemote"
          class="fork-sync-field"
          :placeholder="t('syncUi.pickRemote')"
          :disabled="fetchAllRemotes || !remotes.length"
          filterable
        >
          <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
        </el-select>
      </div>
      <el-checkbox v-model="fetchAllRemotes" class="fork-sync-check">{{ t('syncUi.fetchAll') }}</el-checkbox>
      <el-checkbox v-model="fetchPrune" class="fork-sync-check">{{ t('syncUi.fetchPrune') }}</el-checkbox>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button
          type="primary"
          :disabled="!canFetch"
          :loading="syncBusy === 'fetch'"
          @click="onFetchSubmit"
        >
          {{ t('syncUi.fetchBtn') }}
        </el-button>
        <el-button @click="fetchDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="pullDialogOpen"
    width="440px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path
              fill="currentColor"
              d="M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z"
            />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('syncUi.pullTitle') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('syncUi.pullSub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('syncUi.remoteLabel') }}</label>
        <el-select v-model="pullRemote" class="fork-sync-field" :placeholder="t('syncUi.pickRemote')" filterable>
          <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
        </el-select>
      </div>
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('syncUi.branchLabel') }}</label>
        <el-select
          v-model="pullBranch"
          class="fork-sync-field"
          :placeholder="t('syncUi.pickBranch')"
          filterable
          allow-create
          default-first-option
          :loading="pullBranchesLoading"
        >
          <el-option v-for="b in pullRemoteBranchList" :key="b" :label="b" :value="b" />
        </el-select>
      </div>
      <div class="fork-sync-into">{{ t('syncUi.options') }}</div>
      <div class="fork-sync-indent">
        <el-checkbox v-model="pullRebase" class="fork-sync-check">{{ t('syncUi.pullRebase') }}</el-checkbox>
        <el-checkbox v-model="pullAutostash" class="fork-sync-check">{{ t('syncUi.pullAutostash') }}</el-checkbox>
      </div>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button
          type="primary"
          :disabled="!canPull"
          :loading="syncBusy === 'pull'"
          @click="onPullSubmit"
        >
          {{ t('syncUi.pullBtn') }}
        </el-button>
        <el-button @click="pullDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="pushDialogOpen"
    width="440px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path
              fill="currentColor"
              d="M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z"
            />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('syncUi.pushTitle') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('syncUi.pushSub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row fork-sync-push-mode-row">
        <label class="fork-sync-label">{{ t('syncUi.modeLabel') }}</label>
        <el-radio-group v-model="pushMode" size="small">
          <el-radio-button value="branch">{{ t('syncUi.pushModeBranch') }}</el-radio-button>
          <el-radio-button value="tag">{{ t('syncUi.pushModeTag') }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('syncUi.remoteLabel') }}</label>
        <el-select v-model="pushRemote" class="fork-sync-field" :placeholder="t('syncUi.pickRemote')" filterable>
          <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
        </el-select>
      </div>
      <template v-if="pushMode === 'tag'">
        <div class="fork-sync-row">
          <label class="fork-sync-label">{{ t('syncUi.tagNameLabel') }}</label>
          <el-input v-model="pushSingleTagName" class="fork-sync-field" :placeholder="t('syncUi.tagNamePh')" clearable />
        </div>
        <p class="fork-sync-hint">{{ t('syncUi.pushTagHint') }}</p>
      </template>
      <template v-else>
        <div class="fork-sync-row">
          <label class="fork-sync-label">{{ t('syncUi.localBranchLabel') }}</label>
          <el-select v-model="pushLocalBranch" class="fork-sync-field" :placeholder="t('syncUi.pickLocalBranch')" filterable>
            <el-option v-for="b in branches" :key="b" :label="b" :value="b" />
          </el-select>
        </div>
        <div class="fork-sync-row">
          <label class="fork-sync-label">{{ t('syncUi.remoteBranchLabel') }}</label>
          <el-select
            v-model="pushToBranch"
            class="fork-sync-field"
            :placeholder="t('syncUi.pickRemoteBranch')"
            filterable
            allow-create
            default-first-option
            :loading="pushBranchesLoading"
          >
            <el-option v-for="b in pushRemoteBranchList" :key="'to-' + b" :label="b" :value="b" />
          </el-select>
        </div>
        <div class="fork-sync-indent fork-sync-push-opts">
          <el-checkbox v-model="pushSetUpstream" class="fork-sync-check">{{ t('syncUi.setUpstream') }}</el-checkbox>
          <el-checkbox v-model="pushTags" class="fork-sync-check">{{ t('syncUi.pushAllTags') }}</el-checkbox>
          <el-checkbox v-model="pushForce" class="fork-sync-check" :disabled="pushForceWithLease">
            {{ t('syncUi.pushForce') }}
          </el-checkbox>
          <el-checkbox v-model="pushForceWithLease" class="fork-sync-check" :disabled="pushForce">
            {{ t('syncUi.pushForceLease') }}
          </el-checkbox>
          <el-checkbox v-model="pushPrune" class="fork-sync-check">{{ t('syncUi.pushPrune') }}</el-checkbox>
        </div>
      </template>
      <el-checkbox v-model="pushDryRun" class="fork-sync-check fork-sync-dry-run">{{ t('syncUi.pushDryRun') }}</el-checkbox>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button
          type="primary"
          :disabled="!canPush"
          :loading="syncBusy === 'push'"
          @click="onPushSubmit"
        >
          {{ t('syncUi.pushBtn') }}
        </el-button>
        <el-button @click="pushDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <el-dialog
    v-model="stashDialogOpen"
    width="440px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path
              fill="currentColor"
              d="M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z"
            />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('syncUi.stashSaveTitle') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('syncUi.stashSaveSub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row fork-sync-row-msg">
        <label class="fork-sync-label">{{ t('syncUi.messageLabel') }}</label>
        <el-input
          v-model="stashMessage"
          class="fork-sync-field"
          :placeholder="t('syncUi.stashMsgPh')"
          clearable
        >
          <template #prefix>
            <el-icon class="fork-sync-msg-ico"><Box /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="fork-sync-stash-opt">
        <el-checkbox v-model="stashStageNewFiles" class="fork-sync-check">{{ t('syncUi.stashUntracked') }}</el-checkbox>
        <div class="fork-sync-stash-hint">{{ t('syncUi.stashUntrackedHint') }}</div>
      </div>
      <el-checkbox v-model="stashOnlySelectedPaths" class="fork-sync-check fork-sync-stash-paths">{{
        t('syncUi.stashOnlyPaths')
      }}</el-checkbox>
      <el-select
        v-model="stashPathsPick"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        class="fork-sync-stash-select"
        :placeholder="t('syncUi.pickStashFiles')"
        :disabled="!stashOnlySelectedPaths"
      >
        <el-option v-for="p in stashPathOptions" :key="p" :label="p" :value="p" />
      </el-select>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button type="primary" :loading="stashBusy" @click="onStashSubmit">{{ t('syncUi.stashSaveBtn') }}</el-button>
        <el-button @click="stashDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.fork-sync-stash-select {
  width: 100%;
  margin-top: 8px;
}
.fork-sync-stash-paths {
  margin-top: 10px;
}
</style>
