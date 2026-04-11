<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GitgraphImportRow } from '../types/git-client'
import {
  buildForkCommitGraphLayout,
  FORK_COMMIT_ROW_HEIGHT
} from '../utils/forkCommitGraphLayout.ts'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    rows: GitgraphImportRow[]
    selectedHash: string | null
    /** 历史视图在 v-show 下可能不可见，需等可见后再 scrollToIndex */
    historyActive?: boolean
    currentBranch: string
    remotes?: string[]
  }>(),
  { remotes: () => [], historyActive: true }
)

const emit = defineEmits<{
  (e: 'select', hash: string): void
  (e: 'merge', hash: string): void
  (e: 'rebase', hash: string): void
  (e: 'cherryPick', hash: string): void
  (e: 'revert', hash: string): void
  (e: 'reset', hash: string, mode: 'soft' | 'mixed' | 'hard'): void
}>()

const parentRef = ref<HTMLElement | null>(null)

const layout = computed(() => buildForkCommitGraphLayout(props.rows))

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.rows.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => FORK_COMMIT_ROW_HEIGHT,
    overscan: 56
  }))
)

function scrollSelectedIntoView() {
  const h = props.selectedHash
  if (!h || !props.historyActive) return
  const idx = props.rows.findIndex((r) => r.hash === h)
  if (idx < 0) return
  const run = () => {
    if (!parentRef.value) return
    virtualizer.value.scrollToIndex(idx, { align: 'center', behavior: 'auto' })
  }
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
  })
}

watch(() => props.selectedHash, scrollSelectedIntoView, { flush: 'post' })
watch(() => props.rows, scrollSelectedIntoView, { flush: 'post' })
watch(() => props.historyActive, scrollSelectedIntoView, { flush: 'post' })

onMounted(() => scrollSelectedIntoView())

function formatGraphDate(iso: string | undefined): string {
  if (!iso?.trim()) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.length > 16 ? iso.slice(0, 16) : iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function refPillKind(ref: string): 'tag' | 'remote' | 'branch' {
  if (ref.startsWith('tag: ')) return 'tag'
  const m = ref.match(/^([^/]+)\/(.+)$/)
  if (m?.[1] && props.remotes.includes(m[1])) return 'remote'
  return 'branch'
}

function refLabel(ref: string): string {
  if (ref.startsWith('tag: ')) return ref.slice(5).trim()
  return ref
}

function isCurrentBranchRef(ref: string): boolean {
  if (ref.startsWith('tag: ')) return false
  if (refPillKind(ref) === 'remote') return false
  return ref === props.currentBranch
}

type GraphRefSlice = {
  visible: string[]
  hidden: string[]
}

const HISTORY_GRAPH_INLINE_REF_LIMIT = 4
const HISTORY_GRAPH_INLINE_REF_BUDGET_PX = 318
const HISTORY_GRAPH_INLINE_REF_GAP_PX = 6
const HISTORY_GRAPH_INLINE_REF_MIN_PX = 42
const HISTORY_GRAPH_INLINE_REF_MAX_PX = 156
const HISTORY_GRAPH_INLINE_REF_CHAR_PX = 6.6
const HISTORY_GRAPH_INLINE_REF_BASE_PX = 24
const HISTORY_GRAPH_INLINE_REF_CHECK_PX = 14
const HISTORY_GRAPH_INLINE_MORE_PX = 30

function estimateGraphRefPillWidth(ref: string): number {
  const label = refLabel(ref)
  const width = Math.ceil(
    label.length * HISTORY_GRAPH_INLINE_REF_CHAR_PX +
      HISTORY_GRAPH_INLINE_REF_BASE_PX +
      (isCurrentBranchRef(ref) ? HISTORY_GRAPH_INLINE_REF_CHECK_PX : 0)
  )
  return Math.min(HISTORY_GRAPH_INLINE_REF_MAX_PX, Math.max(HISTORY_GRAPH_INLINE_REF_MIN_PX, width))
}

function estimateGraphRefMoreWidth(hiddenCount: number): number {
  return HISTORY_GRAPH_INLINE_MORE_PX + String(hiddenCount).length * 8
}

function estimateGraphRefSliceWidth(visible: string[], hiddenCount: number): number {
  if (!visible.length && !hiddenCount) return 0
  let total = 0
  for (const ref of visible) total += estimateGraphRefPillWidth(ref)
  total += Math.max(0, visible.length - 1) * HISTORY_GRAPH_INLINE_REF_GAP_PX
  if (hiddenCount > 0) {
    total += (visible.length ? HISTORY_GRAPH_INLINE_REF_GAP_PX : 0) + estimateGraphRefMoreWidth(hiddenCount)
  }
  return total
}

function splitGraphRefsInline(refs: string[]): GraphRefSlice {
  if (!refs.length) return { visible: [], hidden: [] }

  let visibleCount = Math.min(HISTORY_GRAPH_INLINE_REF_LIMIT, refs.length)
  while (visibleCount > 1) {
    const hiddenCount = refs.length - visibleCount
    if (estimateGraphRefSliceWidth(refs.slice(0, visibleCount), hiddenCount) <= HISTORY_GRAPH_INLINE_REF_BUDGET_PX) {
      break
    }
    visibleCount -= 1
  }

  return {
    visible: refs.slice(0, visibleCount),
    hidden: refs.slice(visibleCount)
  }
}

const graphRefSlices = computed<GraphRefSlice[]>(() => props.rows.map((row) => splitGraphRefsInline(row.refs ?? [])))

function graphRefListTitle(refs: string[]): string {
  return refs.map((ref) => refLabel(ref)).join(', ')
}

function onRowClick(hash: string) {
  emit('select', hash)
}

function onGraphCommand(cmd: string, hash: string) {
  if (cmd === 'merge') emit('merge', hash)
  else if (cmd === 'rebase') emit('rebase', hash)
  else if (cmd === 'cherryPick') emit('cherryPick', hash)
  else if (cmd === 'revert') emit('revert', hash)
  else if (cmd === 'reset-soft') emit('reset', hash, 'soft')
  else if (cmd === 'reset-mixed') emit('reset', hash, 'mixed')
  else if (cmd === 'reset-hard') emit('reset', hash, 'hard')
}
</script>

<template>
  <div v-if="layout" class="history-gitgraph-root">
    <div ref="parentRef" class="history-graph-virtual-scroll">
      <div
        class="history-graph-layout"
        :style="{
          height: `${layout.svgHeight}px`,
          '--history-graph-w': layout.graphWidth + 'px'
        }"
      >
        <svg
          class="history-graph-svg"
          :width="layout.graphWidth"
          :height="layout.svgHeight"
          aria-hidden="true"
        >
          <g :transform="`translate(${layout.dotPad}, ${layout.dotPad})`">
            <path
              v-for="(p, pi) in layout.paths"
              :key="'p' + pi"
              :d="p.d"
              fill="none"
              :stroke="p.stroke"
              :stroke-width="p.strokeWidth"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <template v-for="(d, i) in layout.dots" :key="'dot' + i">
              <circle
                v-if="d && selectedHash === rows[i]?.hash"
                class="history-graph-dot-ring"
                :cx="d.x"
                :cy="d.y"
                :r="d.dotSize / 2 + 3"
                fill="none"
                stroke="#2b7ce8"
                stroke-width="2"
              />
              <circle
                v-if="d"
                :cx="d.x"
                :cy="d.y"
                :r="d.dotSize / 2"
                :fill="d.color"
                :stroke="d.strokeColor"
                :stroke-width="d.strokeWidth"
              />
            </template>
          </g>
        </svg>
        <div class="history-graph-rows">
          <el-dropdown
            v-for="v in virtualizer.getVirtualItems()"
            :key="`${v.index}-${rows[v.index]?.hash ?? ''}`"
            trigger="contextmenu"
            class="history-graph-row-dropdown"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${v.size}px`,
              transform: `translateY(${v.start}px)`
            }"
            @command="(cmd: string | number) => onGraphCommand(String(cmd), rows[v.index]!.hash)"
          >
            <div
              class="history-graph-row"
              :class="{ 'history-graph-row-selected': selectedHash === rows[v.index]?.hash }"
              role="button"
              tabindex="0"
              @click="onRowClick(rows[v.index]!.hash)"
              @keydown.enter.prevent="onRowClick(rows[v.index]!.hash)"
            >
              <div class="history-graph-row-cells">
              <div class="history-graph-col-msg">
                <div class="history-graph-msg-line">
                  <div v-if="graphRefSlices[v.index]?.visible.length" class="history-graph-refs-inline">
                    <span
                      v-for="ref in graphRefSlices[v.index]!.visible"
                      :key="ref"
                      class="ref-pill"
                      :class="{
                        'ref-pill-tag': refPillKind(ref) === 'tag',
                        'ref-pill-remote': refPillKind(ref) === 'remote',
                        'ref-pill-branch': refPillKind(ref) === 'branch'
                      }"
                      :title="refLabel(ref)"
                    >
                      <el-icon v-if="isCurrentBranchRef(ref)" class="ref-pill-check" :size="12">
                        <Check />
                      </el-icon>
                      {{ refLabel(ref) }}
                    </span>
                    <el-tooltip
                      v-if="graphRefSlices[v.index]!.hidden.length"
                      effect="dark"
                      placement="top"
                      :content="graphRefListTitle(graphRefSlices[v.index]!.hidden)"
                    >
                      <span class="ref-pill ref-pill-more">
                        +{{ graphRefSlices[v.index]!.hidden.length }}
                      </span>
                    </el-tooltip>
                  </div>
                  <div
                    class="history-graph-subject-line"
                    :title="rows[v.index]!.subject?.trim() || t('history.graphSubjectFallback')"
                  >
                    {{
                      rows[v.index]!.subject?.trim() ? rows[v.index]!.subject : t('history.graphSubjectFallback')
                    }}
                  </div>
                </div>
              </div>
              <div class="history-graph-author history-graph-col-fixed" :title="rows[v.index]!.author.name">{{
                rows[v.index]!.author.name
              }}</div>
              <div class="history-graph-sha history-graph-col-fixed mono">{{ rows[v.index]!.hash.slice(0, 7) }}</div>
              <div class="history-graph-date history-graph-col-fixed">{{ formatGraphDate(rows[v.index]!.date) }}</div>
            </div>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="merge">{{ t('graph.mergeIntoCurrent') }}</el-dropdown-item>
                <el-dropdown-item command="rebase">{{ t('graph.rebaseCurrentHere') }}</el-dropdown-item>
                <el-dropdown-item divided command="cherryPick">{{ t('graph.cherryPick') }}</el-dropdown-item>
                <el-dropdown-item command="revert">{{ t('graph.revert') }}</el-dropdown-item>
                <el-dropdown-item divided command="reset-soft">{{ t('graph.resetSoft') }}</el-dropdown-item>
                <el-dropdown-item command="reset-mixed">{{ t('graph.resetMixed') }}</el-dropdown-item>
                <el-dropdown-item command="reset-hard">{{ t('graph.resetHard') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
  </div>
</template>
