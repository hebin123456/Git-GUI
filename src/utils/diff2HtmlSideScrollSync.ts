/**
 * diff2html 并排（side-by-side）：为 `.d2h-files-diff` 设高度 + 同步左右 `.d2h-file-side-diff` 的 scroll。
 * 官方 diff2html-ui 的 `synchronisedScroll` 在仅用 `html()` 时不会自动挂上；且默认 `inline-block` 布局易与外层滚动错位。
 */
export function bindDiff2HtmlSideLayoutAndScroll(
  root: HTMLElement | null,
  scrollWrap?: HTMLElement | null
): () => void {
  if (!root) return () => {}

  const cleanups: (() => void)[] = []

  const applyMaxHeight = () => {
    if (!scrollWrap) return
    const wrapRect = scrollWrap.getBoundingClientRect()
    const bottom = wrapRect.bottom - 8
    root.querySelectorAll<HTMLElement>('.d2h-files-diff').forEach((fd) => {
      const top = fd.getBoundingClientRect().top
      const h = Math.max(120, bottom - top)
      fd.style.maxHeight = `${h}px`
    })
  }

  const clearMaxHeight = () => {
    root.querySelectorAll<HTMLElement>('.d2h-files-diff').forEach((fd) => {
      fd.style.maxHeight = ''
    })
  }

  root.querySelectorAll('.d2h-file-wrapper').forEach((wrapperEl) => {
    const filesDiff = wrapperEl.querySelector(':scope > .d2h-files-diff')
    if (!filesDiff) return
    const sides = filesDiff.querySelectorAll(':scope > .d2h-file-side-diff')
    if (sides.length !== 2) return
    const left = sides[0] as HTMLElement
    const right = sides[1] as HTMLElement

    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (t === left) {
        right.scrollTop = left.scrollTop
        right.scrollLeft = left.scrollLeft
      } else if (t === right) {
        left.scrollTop = right.scrollTop
        left.scrollLeft = right.scrollLeft
      }
    }

    left.addEventListener('scroll', onScroll, { passive: true })
    right.addEventListener('scroll', onScroll, { passive: true })
    cleanups.push(() => left.removeEventListener('scroll', onScroll))
    cleanups.push(() => right.removeEventListener('scroll', onScroll))
  })

  applyMaxHeight()
  if (scrollWrap) {
    const roWrap = new ResizeObserver(() => applyMaxHeight())
    roWrap.observe(scrollWrap)
    const roRoot = new ResizeObserver(() => applyMaxHeight())
    roRoot.observe(root)
    const onWin = () => applyMaxHeight()
    window.addEventListener('resize', onWin, { passive: true })
    const onWrapScroll = () => applyMaxHeight()
    scrollWrap.addEventListener('scroll', onWrapScroll, { passive: true })
    cleanups.push(() => scrollWrap.removeEventListener('scroll', onWrapScroll))
    cleanups.push(() => roWrap.disconnect())
    cleanups.push(() => roRoot.disconnect())
    cleanups.push(() => window.removeEventListener('resize', onWin))
  }
  cleanups.push(clearMaxHeight)

  return () => {
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
  }
}
