<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** localStorage key for persisting left size */
  storageKey: string
  /** initial left width as percent (0-100) when no persisted value */
  defaultLeftPercent?: number
  /** min/max bounds for left percent */
  minLeftPercent?: number
  maxLeftPercent?: number
}>()

const rootRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const DIVIDER_PX = 6
const leftPercent = ref(Math.round(props.defaultLeftPercent ?? 28))

function clampPercent(n: number) {
  const min = props.minLeftPercent ?? 18
  const max = props.maxLeftPercent ?? 60
  return Math.min(max, Math.max(min, Math.round(n)))
}

function availableWidthPx(): number {
  const root = rootRef.value
  if (!root) return 1
  const w = Math.max(1, root.getBoundingClientRect().width - DIVIDER_PX)
  return w
}

function percentFromLeftPx(px: number): number {
  return clampPercent((px / availableWidthPx()) * 100)
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(props.storageKey)
    if (!raw) return
    const n = Number(JSON.parse(raw))
    if (!Number.isFinite(n)) return
    // Backward compat: old builds stored px; new builds store percent.
    if (n > 100) {
      leftPercent.value = percentFromLeftPx(n)
    } else {
      leftPercent.value = clampPercent(n)
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    localStorage.setItem(props.storageKey, JSON.stringify(leftPercent.value))
  } catch {
    /* ignore */
  }
}

let startX = 0
let startLeftPx = 0

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const dx = e.clientX - startX
  leftPercent.value = percentFromLeftPx(startLeftPx + dx)
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  document.body.classList.remove('fork-resize-dragging')
  persist()
}

function onDividerPointerDown(e: PointerEvent) {
  const root = rootRef.value
  if (!root) return
  dragging.value = true
  startX = e.clientX
  startLeftPx = (availableWidthPx() * leftPercent.value) / 100
  document.body.classList.add('fork-resize-dragging')
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

onMounted(() => {
  loadPersisted()
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

watch(
  () => [props.minLeftPercent, props.maxLeftPercent] as const,
  () => {
    leftPercent.value = clampPercent(leftPercent.value)
  }
)

const gridStyle = computed(() => ({
  // Ensure panes add up to 100% of available width (excluding divider).
  gridTemplateColumns: `calc(${leftPercent.value}% - ${DIVIDER_PX / 2}px) ${DIVIDER_PX}px calc(${100 - leftPercent.value}% - ${DIVIDER_PX / 2}px)`
}))
</script>

<template>
  <div ref="rootRef" class="fork-resize-split" :class="{ 'is-dragging': dragging }" :style="gridStyle">
    <div class="fork-resize-pane fork-resize-pane--left">
      <slot name="left" />
    </div>
    <div class="fork-resize-divider" role="separator" aria-orientation="vertical" tabindex="0" @pointerdown="onDividerPointerDown">
      <span class="fork-resize-divider-grip" aria-hidden="true" />
    </div>
    <div class="fork-resize-pane fork-resize-pane--right">
      <slot name="right" />
    </div>
  </div>
</template>

