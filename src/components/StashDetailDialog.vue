<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const api = window.gitClient
const { t } = useI18n()

const { stashDetailDialogOpen, stashEntries, stashApply, stashPop, dropStash } = useGitWorkspace()

const stashIndex = ref(0)
const patchLoading = ref(false)
const patchText = ref('')

const stashOptions = computed(() => stashEntries.value.map((e) => ({ label: `#${e.index} ${e.label}`, value: e.index })))

watch(stashDetailDialogOpen, (o) => {
  if (!o) {
    patchText.value = ''
    return
  }
  if (stashEntries.value.length) {
    stashIndex.value = stashEntries.value[0]!.index
  }
  void loadPatch()
})

watch(stashIndex, () => {
  if (stashDetailDialogOpen.value) void loadPatch()
})

async function loadPatch() {
  patchLoading.value = true
  patchText.value = ''
  const r = await api.stashShowPatch(stashIndex.value)
  patchLoading.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  patchText.value = r.text || t('stashDetail.noPatch')
}

async function onApply() {
  await stashApply(stashIndex.value)
  stashDetailDialogOpen.value = false
}

async function onPop() {
  await stashPop(stashIndex.value)
  stashDetailDialogOpen.value = false
}

async function onDrop() {
  await dropStash(stashIndex.value)
  stashDetailDialogOpen.value = false
}
</script>

<template>
  <el-dialog
    v-model="stashDetailDialogOpen"
    :title="t('stashDetail.title')"
    width="min(880px, 96vw)"
    class="fork-stash-detail-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <div v-if="!stashEntries.length" class="fork-stash-detail-empty">{{ t('stashDetail.empty') }}</div>
    <template v-else>
      <div class="fork-stash-detail-toolbar">
        <el-select
          v-model="stashIndex"
          filterable
          :placeholder="t('stashDetail.selectStash')"
          class="fork-stash-detail-select"
        >
          <el-option v-for="opt in stashOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-button size="small" :loading="patchLoading" @click="loadPatch">{{ t('stashDetail.refreshDiff') }}</el-button>
        <el-button size="small" type="primary" plain @click="onApply">{{ t('stashDetail.apply') }}</el-button>
        <el-button size="small" type="warning" plain @click="onPop">{{ t('stashDetail.pop') }}</el-button>
        <el-button size="small" type="danger" plain @click="onDrop">{{ t('stashDetail.drop') }}</el-button>
      </div>
      <el-skeleton v-if="patchLoading" :rows="10" animated />
      <el-scrollbar v-else max-height="58vh">
        <pre class="diff-pre fork-stash-detail-pre">{{ patchText }}</pre>
      </el-scrollbar>
    </template>
  </el-dialog>
</template>

<style scoped>
.fork-stash-detail-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.fork-stash-detail-select {
  min-width: 280px;
  flex: 1;
}
.fork-stash-detail-pre {
  margin: 0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.fork-stash-detail-empty {
  padding: 24px;
  text-align: center;
  color: var(--el-text-color-secondary);
}
</style>
