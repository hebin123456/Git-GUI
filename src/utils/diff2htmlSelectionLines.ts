/**
 * 将 diff2html 表格中的选区映射为 unified diff 文本中的行下标（与 diffText.split('\n') 一致），
 * 供 extractPartialLinePatchForLineRange / applyChangeDiffLineSelection 使用。
 *
 * 并排视图下，左栏只对应 unified 中的 '-' 与上下文，右栏只对应 '+' 与上下文；
 * 单列视图按 unified 顺序与表格行一一扫描对齐。避免仅用「行内容相等」在重复行上匹配到错误位置。
 */

function normNl(s: string) {
  return s.replace(/\r\n/g, '\n')
}

/** 从一行 <tr> 还原 unified diff 中的一行（含前缀 +/−/空格） */
export function reconstructUnifiedLineFromDiff2HtmlTr(tr: HTMLTableRowElement): string | null {
  const cells = tr.querySelectorAll('td')
  if (cells.length < 2) return null
  const lineCell = cells[1] as HTMLTableCellElement
  const wrap = lineCell.querySelector('.d2h-code-line, .d2h-code-side-line') as HTMLElement | null
  if (!wrap) {
    const t = lineCell.innerText.replace(/\r\n/g, '\n').trim()
    if (!t) return null
    if (/^@@\s/u.test(t)) return t
    if (t.startsWith('diff --git') || t.startsWith('index ') || /^---\s/u.test(t) || /^\+\+\+\s/u.test(t)) {
      return t
    }
    return null
  }
  const prefixEl = wrap.querySelector('.d2h-code-line-prefix')
  const ctnEl = wrap.querySelector('.d2h-code-line-ctn')
  let prefix = ' '
  if (prefixEl) {
    const raw = prefixEl.textContent ?? ''
    if (raw === '\u00a0' || raw === '' || raw === ' ') prefix = ' '
    else prefix = raw.charAt(0)
  }
  const content = (ctnEl?.textContent ?? '').replace(/\r\n/g, '\n')
  if (prefix === '+' || prefix === '-' || prefix === ' ') {
    return prefix + content
  }
  return null
}

function closestTr(node: Node | null, root: HTMLElement): HTMLTableRowElement | null {
  let el: Node | null = node
  if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement
  if (!(el instanceof Element)) return null
  const tr = el.closest('tr')
  if (!tr || !root.contains(tr)) return null
  return tr as HTMLTableRowElement
}

function collectTrInRange(root: HTMLElement, range: Range): HTMLTableRowElement[] {
  const startTr = closestTr(range.startContainer, root)
  const endTr = closestTr(range.endContainer, root)
  if (!startTr || !endTr) return []
  const tbody = startTr.closest('tbody')
  if (!tbody || tbody !== endTr.closest('tbody')) return []
  const all = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLTableRowElement[]
  const si = all.indexOf(startTr)
  const ei = all.indexOf(endTr)
  if (si < 0 || ei < 0) return []
  const a = Math.min(si, ei)
  const b = Math.max(si, ei)
  return all.slice(a, b + 1)
}

/** 并排：左栏 tbody 对应 unified 中 '-' 与 ' '；右栏对应 '+' 与 ' '；单列对应 @@ 与 hunk 内全部 */
type AlignSide = 'lineByLine' | 'left' | 'right'

function detectAlignSide(root: HTMLElement, tbody: HTMLElement): AlignSide {
  const filesDiff = root.querySelector('.d2h-files-diff')
  if (!filesDiff?.contains(tbody)) return 'lineByLine'
  const sideWrap = tbody.closest('.d2h-file-side-diff')
  if (!sideWrap || !filesDiff.contains(sideWrap)) return 'lineByLine'
  const sides = filesDiff.querySelectorAll(':scope > .d2h-file-side-diff')
  if (sides.length < 2) return 'lineByLine'
  return sides[0] === sideWrap ? 'left' : 'right'
}

function diffLineUsedBySide(L: string, side: AlignSide): boolean {
  if (/^diff --git/u.test(L) || /^index\s/u.test(L) || /^---\s/u.test(L) || /^\+\+\+\s/u.test(L)) {
    return false
  }
  if (/^@@\s/u.test(L)) return true
  const c = L[0] ?? ''
  if (c === '\\') return true
  if (side === 'lineByLine') return c === ' ' || c === '+' || c === '-'
  if (side === 'left') return c === ' ' || c === '-'
  return c === ' ' || c === '+'
}

/**
 * 将某个 tbody 内按 DOM 顺序的每一行 <tr> 对齐到 diffLines 下标；对不上的行为 null。
 */
export function assignDiffIndicesToTbodyTrs(
  trs: HTMLTableRowElement[],
  diffLines: string[],
  side: AlignSide
): (number | null)[] | null {
  let di = 0
  const out: (number | null)[] = []

  for (const tr of trs) {
    const want = reconstructUnifiedLineFromDiff2HtmlTr(tr)
    if (want == null) {
      out.push(null)
      continue
    }
    let matched = false
    while (di < diffLines.length) {
      const L = diffLines[di]!
      if (!diffLineUsedBySide(L, side)) {
        di++
        continue
      }
      if (L === want) {
        out.push(di)
        di++
        matched = true
        break
      }
      return null
    }
    if (!matched) return null
  }

  return out
}

/**
 * 仅根据选中的若干 <tr>，在 diff 中按顺序找子序列匹配（不要求整表对齐成功）。
 * 用于全表对齐失败时的回退，避免浮窗/行操作完全不可用。
 */
function mapSelectionTrsToDiffIndicesSequential(
  trs: HTMLTableRowElement[],
  diffLines: string[],
  side: AlignSide
): number[] | null {
  const wants: string[] = []
  for (const tr of trs) {
    const w = reconstructUnifiedLineFromDiff2HtmlTr(tr)
    if (w != null) wants.push(w)
  }
  if (!wants.length) return null
  let di = 0
  const indices: number[] = []
  for (const want of wants) {
    let found = -1
    let scan = di
    while (scan < diffLines.length) {
      const L = diffLines[scan]!
      if (!diffLineUsedBySide(L, side)) {
        scan++
        continue
      }
      if (L === want) {
        found = scan
        break
      }
      scan++
    }
    if (found < 0) return null
    indices.push(found)
    di = found + 1
  }
  return indices
}

/**
 * @returns inclusive line indices into normNl(diffText).split('\n')
 */
export function getDiffTextLineRangeFromDiff2HtmlSelection(
  root: HTMLElement,
  diffText: string
): { startLine: number; endLine: number } | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const raw = range.getBoundingClientRect()
  if (raw.width <= 0 && raw.height <= 0) return null

  const trs = collectTrInRange(root, range)
  if (!trs.length) return null

  const startTr = trs[0]!
  const tbody = startTr.closest('tbody')
  if (!tbody) return null

  const side = detectAlignSide(root, tbody)
  const full = normNl(diffText)
  const diffLines = full.split('\n')

  const allTrsInTbody = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLTableRowElement[]
  const assign = assignDiffIndicesToTbodyTrs(allTrsInTbody, diffLines, side)

  let indices: number[] = []
  if (assign) {
    for (const tr of trs) {
      const idx = allTrsInTbody.indexOf(tr)
      if (idx < 0) continue
      const d = assign[idx]
      if (d != null) indices.push(d)
    }
  }
  if (!indices.length) {
    const fallback = mapSelectionTrsToDiffIndicesSequential(trs, diffLines, side)
    if (!fallback?.length) return null
    indices = fallback
  }

  const startLine = Math.min(...indices)
  const endLine = Math.max(...indices)
  return { startLine, endLine }
}
