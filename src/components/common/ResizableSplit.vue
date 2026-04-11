<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getPersistentStorageItem, setPersistentStorageItem } from '../../utils/persistentStorage.ts'

const props = withDefaults(
  defineProps<{
    /** persistent storage key for pane ratio */
    storageKey: string
    /** split orientation: horizontal = left/right, vertical = top/bottom */
    direction?: 'horizontal' | 'vertical'
    /** initial primary pane ratio in percent (0-100) */
    defaultPrimaryPercent?: number
    /** min/max bounds for primary pane ratio */
    minPrimaryPercent?: number
    maxPrimaryPercent?: number
    /** backward compat for older callers */
    defaultLeftPercent?: number
    minLeftPercent?: number
    maxLeftPercent?: number
  }>(),
  {
    direction: 'horizontal'
  }
)

const rootRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const DIVIDER_PX = 6
const primaryPercent = ref(Math.round(props.defaultPrimaryPercent ?? props.defaultLeftPercent ?? 28))
const isVertical = computed(() => props.direction === 'vertical')
const primarySlotName = computed(() => (isVertical.value ? 'top' : 'left'))
const secondarySlotName = computed(() => (isVertical.value ? 'bottom' : 'right'))

function minPrimaryPercent(): number {
  return props.minPrimaryPercent ?? props.minLeftPercent ?? 18
}

function maxPrimaryPercent(): number {
  return props.maxPrimaryPercent ?? props.maxLeftPercent ?? 60
}

function clampPercent(n: number) {
  const min = minPrimaryPercent()
  const max = maxPrimaryPercent()
  return Math.min(max, Math.max(min, Math.round(n)))
}

function availablePrimarySizePx(): number {
  const root = rootRef.value
  if (!root) return 1
  const rect = root.getBoundingClientRect()
  const size = isVertical.value ? rect.height : rect.width
  return Math.max(1, size - DIVIDER_PX)
}

function percentFromPrimaryPx(px: number): number {
  return clampPercent((px / availablePrimarySizePx()) * 100)
}

function loadPersisted() {
  try {
    const raw = getPersistentStorageItem(props.storageKey)
    if (!raw) return
    const n = Number(JSON.parse(raw))
    if (!Number.isFinite(n)) return
    // Backward compat: old builds stored px; new builds store percent.
    if (n > 100) {
      primaryPercent.value = percentFromPrimaryPx(n)
    } else {
      primaryPercent.value = clampPercent(n)
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    setPersistentStorageItem(props.storageKey, JSON.stringify(primaryPercent.value))
  } catch {
    /* ignore */
  }
}

let startPointer = 0
let startPrimaryPx = 0

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  const delta = (isVertical.value ? e.clientY : e.clientX) - startPointer
  primaryPercent.value = percentFromPrimaryPx(startPrimaryPx + delta)
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  document.body.classList.remove('fork-resize-dragging')
  persist()
  window.dispatchEvent(new Event('resize'))
}

function onDividerPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const root = rootRef.value
  if (!root) return
  dragging.value = true
  startPointer = isVertical.value ? e.clientY : e.clientX
  startPrimaryPx = (availablePrimarySizePx() * primaryPercent.value) / 100
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
  () =>
    [
      props.direction,
      props.minPrimaryPercent,
      props.maxPrimaryPercent,
      props.minLeftPercent,
      props.maxLeftPercent
    ] as const,
  () => {
    primaryPercent.value = clampPercent(primaryPercent.value)
  }
)

const gridStyle = computed(() => {
  const style: Record<string, string> = {
    '--fork-resize-divider-px': `${DIVIDER_PX}px`
  }
  if (isVertical.value) {
    style.gridTemplateColumns = 'minmax(0, 1fr)'
    style.gridTemplateRows = `calc(${primaryPercent.value}% - ${DIVIDER_PX / 2}px) ${DIVIDER_PX}px calc(${100 - primaryPercent.value}% - ${DIVIDER_PX / 2}px)`
  } else {
    style.gridTemplateColumns = `calc(${primaryPercent.value}% - ${DIVIDER_PX / 2}px) ${DIVIDER_PX}px calc(${100 - primaryPercent.value}% - ${DIVIDER_PX / 2}px)`
    style.gridTemplateRows = 'minmax(0, 1fr)'
  }
  return style
})
</script>

<template>
  <div
    ref="rootRef"
    class="fork-resize-split"
    :class="{ 'is-dragging': dragging, 'is-vertical': isVertical, 'is-horizontal': !isVertical }"
    :style="gridStyle"
  >
    <div class="fork-resize-pane fork-resize-pane--primary">
      <slot name="first">
        <slot :name="primarySlotName" />
      </slot>
    </div>
    <div
      class="fork-resize-divider"
      role="separator"
      :aria-orientation="isVertical ? 'horizontal' : 'vertical'"
      tabindex="0"
      @pointerdown="onDividerPointerDown"
    >
      <span class="fork-resize-divider-grip" aria-hidden="true" />
    </div>
    <div class="fork-resize-pane fork-resize-pane--secondary">
      <slot name="second">
        <slot :name="secondarySlotName" />
      </slot>
    </div>
  </div>
</template>

