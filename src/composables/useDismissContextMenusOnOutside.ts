import { onMounted, onUnmounted } from 'vue'

/**
 * Element Plus 的 el-dropdown（trigger=contextmenu）通过 tooltip 内的 onClickOutside 关闭，
 * 主要监听 click；右键在外侧不会触发 click，菜单会一直悬着。
 *
 * 另：多个 el-dropdown 各自独立，在 A 处右击打开菜单后再在 B 处右击，A 的菜单不会自动关。
 * 在 contextmenu 捕获阶段、在新菜单打开前同步补发一次合成 click，先收起已打开的浮层。
 */
function isInsidePopper(path: EventTarget[]): boolean {
  return path.some((node) => node instanceof Element && node.classList?.contains('el-popper'))
}

/** 仍在「下拉触发区域」内（未点到已弹出的菜单） */
function isInsideDropdownTriggerOnly(path: EventTarget[]): boolean {
  return path.some((node) => {
    if (!(node instanceof Element)) return false
    const drop = node.closest('.el-dropdown')
    if (!drop) return false
    return node.closest('.el-popper') === null
  })
}

/** 仅在 window 上派发，避免误触发光标下的按钮、链接 */
function emitSyntheticClickForClickOutside() {
  window.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      detail: 1
    })
  )
}

/** 是否已有处于打开状态的 el-popper（下拉菜单浮层） */
function hasVisiblePopper(): boolean {
  return Array.from(document.querySelectorAll('.el-popper')).some((el) => {
    if (!(el instanceof HTMLElement)) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0
  })
}

export function useDismissContextMenusOnOutside() {
  let scheduled = false

  /**
   * 仅在「已有菜单打开」时，再右击另一处触发区才派发合成 click。
   * 若每次右击都派发，会在首次打开菜单前干扰内部状态，导致菜单项点击无反应。
   */
  const onContextMenuCapture = (e: MouseEvent) => {
    const path = e.composedPath()
    if (!isInsideDropdownTriggerOnly(path)) return
    if (!hasVisiblePopper()) return
    emitSyntheticClickForClickOutside()
  }

  const onPointerDown = (e: MouseEvent) => {
    // 左键：沿用 Element Plus 对原生 click 的监听；仅右键不会触发 click，需补发
    if (e.button !== 2) return
    const path = e.composedPath()
    if (isInsidePopper(path)) return
    if (isInsideDropdownTriggerOnly(path)) return
    // 与 onContextMenuCapture 一致：无已打开浮层时不要补发 click，否则会先于 contextmenu
    // 干扰侧栏「分组标题右击新建」等逻辑（合成 click 在微任务中早于 contextmenu）。
    if (!hasVisiblePopper()) return
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      emitSyntheticClickForClickOutside()
    })
  }

  onMounted(() => {
    document.addEventListener('contextmenu', onContextMenuCapture, true)
    document.addEventListener('mousedown', onPointerDown, true)
  })

  onUnmounted(() => {
    document.removeEventListener('contextmenu', onContextMenuCapture, true)
    document.removeEventListener('mousedown', onPointerDown, true)
  })
}
