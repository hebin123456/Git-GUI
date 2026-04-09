import { ElMessage } from 'element-plus'
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * diff2html 区域右键：复制当前选区；无选区时复制完整原始 diff 文本。
 */
export function useDiff2HtmlCopyMenu() {
  const { t } = useI18n()
  const diff2htmlCopyMenu = ref({ visible: false, x: 0, y: 0 })
  const pendingCopyText = ref('')

  function clampMenuPos(x: number, y: number) {
    const pad = 8
    const w = 200
    const h = 72
    return {
      x: Math.min(x, window.innerWidth - w - pad),
      y: Math.min(y, window.innerHeight - h - pad)
    }
  }

  function closeDiff2HtmlCopyMenu() {
    diff2htmlCopyMenu.value = { visible: false, x: 0, y: 0 }
  }

  function onDiff2HtmlContextMenu(e: MouseEvent, fullPlainDiff: string) {
    e.preventDefault()
    const host = e.currentTarget as HTMLElement | null
    /** 事件可绑在 `.change-diff2html-host` 上，选区与复制仍以内部 `.diff2html-root` 为准（不含悬浮工具条） */
    const root =
      host?.querySelector?.(':scope > .diff2html-root') ?? host?.querySelector?.('.diff2html-root') ?? host
    let text = fullPlainDiff
    const sel = window.getSelection()
    if (sel?.rangeCount && !sel.isCollapsed && root) {
      const an = sel.anchorNode
      const fn = sel.focusNode
      if (an && fn && root.contains(an) && root.contains(fn)) {
        const st = sel.toString()
        if (st.trim()) text = st
      }
    }
    pendingCopyText.value = text
    const p = clampMenuPos(e.clientX, e.clientY)
    diff2htmlCopyMenu.value = { visible: true, x: p.x, y: p.y }
  }

  async function confirmCopyDiff2Html() {
    try {
      await navigator.clipboard.writeText(pendingCopyText.value)
      ElMessage.success(t('common.copied'))
      closeDiff2HtmlCopyMenu()
    } catch {
      ElMessage.error(t('common.copyFailed'))
    }
  }

  function onDocPointerDown(e: MouseEvent) {
    if (!diff2htmlCopyMenu.value.visible || e.button !== 0) return
    const t = e.target
    if (t instanceof Element && t.closest('.fork-native-ctx-menu')) return
    closeDiff2HtmlCopyMenu()
  }

  onMounted(() => document.addEventListener('mousedown', onDocPointerDown, true))
  onUnmounted(() => document.removeEventListener('mousedown', onDocPointerDown, true))

  return {
    diff2htmlCopyMenu,
    onDiff2HtmlContextMenu,
    closeDiff2HtmlCopyMenu,
    confirmCopyDiff2Html
  }
}
