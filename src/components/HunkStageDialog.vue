<script setup lang="ts">
import { computed, inject, ref, unref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { CHANGES_WORKSPACE_INJECTION_KEY } from '../composables/changesWorkspaceInjection.ts'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'
import { splitUnifiedDiffIntoHunkPatches } from '../utils/splitUnifiedDiffHunks.ts'

const api = window.gitClient
const at = window.gitAt
const { t } = useI18n()

const ws = inject(CHANGES_WORKSPACE_INJECTION_KEY, null) ?? useGitWorkspace()

const props = defineProps<{
  modelValue: boolean
  relPath: string | null
  scope: 'unstaged' | 'staged'
  /** 子仓（Git MM）时传入仓库根，使用 gitAt 而非主窗口 gitClient */
  gitAtRoot?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
}>()

const loading = ref(false)
const rawDiff = ref('')
const applyingIdx = ref<number | null>(null)

const hunks = computed(() => splitUnifiedDiffIntoHunkPatches(rawDiff.value))

const dialogTitle = computed(() =>
  props.scope === 'staged' ? t('hunk.titleStaged') : t('hunk.titleUnstaged')
)

watch(
  () => [props.modelValue, props.relPath, props.scope, props.gitAtRoot] as const,
  async ([open, path, scope, root]) => {
    rawDiff.value = ''
    if (!open || !path?.trim()) return
    loading.value = true
    try {
      const opts = unref(ws.diffOptions)
      const p = path.trim()
      let d: string | { error: string }
      if (root?.trim()) {
        const rr = root.trim()
        d =
          scope === 'staged' ? await at.diffStaged(rr, p, opts) : await at.diff(rr, p, opts)
      } else {
        d = scope === 'staged' ? await api.diffStaged(p, opts) : await api.diff(p, opts)
      }
      rawDiff.value = typeof d === 'string' ? d : ''
      if (typeof d === 'object' && 'error' in d) {
        ElMessage.error(d.error)
        rawDiff.value = ''
      }
    } finally {
      loading.value = false
    }
  }
)

function close() {
  emit('update:modelValue', false)
}

async function applyHunk(idx: number) {
  const h = hunks.value[idx]
  if (!h?.patch.trim()) return
  applyingIdx.value = idx
  const reverse = props.scope === 'staged'
  const root = props.gitAtRoot?.trim()
  let err: string | undefined
  if (root) {
    const r = await at.applyPatch(root, h.patch, { cached: true, reverse })
    if ('error' in r) err = r.error
  } else {
    const r = await api.applyCachedPatch(h.patch, reverse)
    if ('error' in r) err = r.error
  }
  applyingIdx.value = null
  if (err) {
    ElMessage.error(err)
    return
  }
  ElMessage.success(reverse ? t('hunk.unstageOk') : t('hunk.stageOk'))
  await ws.refreshAll()
  if ('loadDiff' in ws && typeof (ws as { loadDiff?: () => void }).loadDiff === 'function') {
    void (ws as { loadDiff: () => void }).loadDiff()
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="min(720px, 96vw)"
    class="fork-hunk-stage-dlg"
    align-center
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="relPath" class="fork-hunk-stage-path mono">{{ relPath }}</p>
    <p v-else class="muted">{{ t('hunk.unstagedHint') }}</p>
    <el-skeleton v-if="loading" :rows="4" animated />
    <template v-else-if="!hunks.length">
      <p class="muted">{{ t('hunk.noHunks') }}</p>
    </template>
    <el-scrollbar v-else max-height="56vh">
      <div v-for="(h, i) in hunks" :key="i" class="fork-hunk-block">
        <div class="fork-hunk-head">
          <code class="fork-hunk-summary">{{ h.summary }}</code>
          <el-button
            size="small"
            type="primary"
            :loading="applyingIdx === i"
            :disabled="applyingIdx !== null && applyingIdx !== i"
            @click="applyHunk(i)"
          >
            {{ scope === 'staged' ? t('hunk.unstageThis') : t('hunk.stageThis') }}
          </el-button>
        </div>
        <pre class="diff-pre fork-hunk-pre">{{ h.patch }}</pre>
      </div>
    </el-scrollbar>
    <template #footer>
      <el-button @click="close">{{ t('hunk.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fork-hunk-stage-path {
  margin: 0 0 12px;
  font-size: 12px;
  word-break: break-all;
}
.muted {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.fork-hunk-block {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}
.fork-hunk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
}
.fork-hunk-summary {
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fork-hunk-pre {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  padding: 8px 10px;
  font-size: 11px;
}
.mono {
  font-family: ui-monospace, monospace;
}
</style>
