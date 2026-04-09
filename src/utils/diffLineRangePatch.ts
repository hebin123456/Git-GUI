/**
 * Build unified diff patches from a line range in `diffText.split('\n')`.
 * - `extractPartialLinePatchForLineRange`: only the selected line range inside each @@ hunk
 *   (default **no** extra context lines, so staging does not spill to neighbors).
 *   Pass `contextLines > 0` if `git apply` fails and you need surrounding lines for matching.
 * - `extractCompleteHunkPatchForLineRange`: legacy — full hunks intersecting the range.
 */

/** 默认不加额外上下文行，避免「暂存选区」波及上下邻近行；需要时可传入更大值 */
const DEFAULT_CONTEXT_LINES = 0

function parseGitHunkHeader(line: string): {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  suffix: string
} | null {
  const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
  if (!m) return null
  return {
    oldStart: parseInt(m[1]!, 10),
    oldCount: m[2] ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3]!, 10),
    newCount: m[4] ? parseInt(m[4], 10) : 1,
    suffix: m[5] ?? ''
  }
}

/** 1-based line positions in old/new file at the start of bodyLines[relIndex]. */
function lineNumbersAtBodyIndex(
  oldStart: number,
  newStart: number,
  bodyLines: string[],
  relIndex: number
): { oldLine: number; newLine: number } {
  let o = oldStart
  let n = newStart
  for (let i = 0; i < relIndex; i++) {
    const line = bodyLines[i] ?? ''
    const c = line[0] ?? ' '
    if (c === ' ') {
      o++
      n++
    } else if (c === '-') {
      o++
    } else if (c === '+') {
      n++
    } else if (c === '\\') {
      o++
      n++
    }
  }
  return { oldLine: o, newLine: n }
}

function countOldNewForUnifiedSlice(slice: string[]): { oldC: number; newC: number } {
  let oldC = 0
  let newC = 0
  for (const line of slice) {
    if (!line.length) continue
    const c = line[0]
    if (c === ' ' || c === '-') oldC++
    if (c === ' ' || c === '+') newC++
    if (c === '\\') {
      oldC++
      newC++
    }
  }
  return { oldC, newC }
}

/**
 * 若选区只盖住 `-` 或只盖住 `+` 的一半，补丁不完整，`git apply --cached` 后索引与工作区仍不一致，
 * 未暂存 diff 会与已暂存重复。将范围扩成紧邻的 `-`/`+` 对（unified 里典型的整块替换）。
 */
export function expandPairedChangeLinesInBody(bodyLines: string[], relLo: number, relHi: number): { lo: number; hi: number } {
  let a = Math.max(0, Math.min(relLo, relHi))
  let b = Math.min(bodyLines.length - 1, Math.max(relLo, relHi))
  for (;;) {
    let na = a
    let nb = b
    for (let i = a; i <= b; i++) {
      const c = (bodyLines[i] ?? '')[0] ?? ''
      if (c === '-' && i + 1 < bodyLines.length) {
        const n = (bodyLines[i + 1] ?? '')[0] ?? ''
        if (n === '+') {
          na = Math.min(na, i)
          nb = Math.max(nb, i + 1)
        }
      }
      if (c === '+' && i > 0) {
        const p = (bodyLines[i - 1] ?? '')[0] ?? ''
        if (p === '-') {
          na = Math.min(na, i - 1)
          nb = Math.max(nb, i)
        }
      }
    }
    if (na === a && nb === b) return { lo: a, hi: b }
    a = na
    b = nb
  }
}

/**
 * Build a patch that applies only to lines in [selStart, selEnd] (inclusive),
 * within each @@ hunk, optionally plus `contextLines` of surrounding lines inside that hunk.
 */
export function extractPartialLinePatchForLineRange(
  diffText: string,
  selStart: number,
  selEnd: number,
  contextLines: number = DEFAULT_CONTEXT_LINES
): { patch: string; addedContextLines: boolean } | null {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n')
  const n = lines.length
  if (!n) return null
  const a = Math.max(0, Math.min(selStart, selEnd))
  const b = Math.min(n - 1, Math.max(selStart, selEnd))
  if (a > b) return null

  let firstHunk = -1
  for (let i = 0; i < n; i++) {
    if (/^@@\s/u.test(lines[i]!)) {
      firstHunk = i
      break
    }
  }
  if (firstHunk < 0) return null

  const header = lines.slice(0, firstHunk).join('\n')
  const outHunkLines: string[] = []
  let addedContextLines = false

  let i = firstHunk
  while (i < n) {
    if (!/^@@\s/u.test(lines[i]!)) {
      i++
      continue
    }
    const hunkHeaderLine = lines[i]!
    const parsed = parseGitHunkHeader(hunkHeaderLine)
    if (!parsed) {
      i++
      continue
    }
    i++
    const bodyStart = i
    while (i < n && !/^@@\s/u.test(lines[i]!)) i++
    const bodyEnd = i - 1
    if (bodyStart > bodyEnd) continue

    const rangeLo = Math.max(bodyStart, a)
    const rangeHi = Math.min(bodyEnd, b)
    if (rangeLo > rangeHi) continue

    const bodyLines = lines.slice(bodyStart, bodyEnd + 1)
    const relLoRaw = rangeLo - bodyStart
    const relHiRaw = rangeHi - bodyStart
    const paired = expandPairedChangeLinesInBody(bodyLines, relLoRaw, relHiRaw)
    const relLo = paired.lo
    const relHi = paired.hi
    const expLo = Math.max(0, relLo - contextLines)
    const expHi = Math.min(bodyLines.length - 1, relHi + contextLines)
    if (expLo < relLo || expHi > relHi) addedContextLines = true

    const slice = bodyLines.slice(expLo, expHi + 1)
    const { oldLine, newLine } = lineNumbersAtBodyIndex(
      parsed.oldStart,
      parsed.newStart,
      bodyLines,
      expLo
    )
    const { oldC, newC } = countOldNewForUnifiedSlice(slice)
    if (oldC === 0 && newC === 0) continue

    const newHeader = `@@ -${oldLine},${oldC} +${newLine},${newC} @@${parsed.suffix}`
    outHunkLines.push(newHeader, ...slice)
  }

  if (!outHunkLines.length) return null
  const patch = `${header}\n${outHunkLines.join('\n')}\n`
  return { patch, addedContextLines }
}

/**
 * Build a unified diff patch that contains every complete @@ hunk intersecting
 * the inclusive line range [selStart, selEnd] (0-based indices in `diffText.split('\n')`).
 * Used by tests / callers that need full-hunk expansion.
 */
export function extractCompleteHunkPatchForLineRange(
  diffText: string,
  selStart: number,
  selEnd: number
): { patch: string; expandedToFullHunks: boolean } | null {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n')
  const n = lines.length
  if (!n) return null
  const a = Math.max(0, Math.min(selStart, selEnd))
  const b = Math.min(n - 1, Math.max(selStart, selEnd))
  if (a > b) return null

  let firstHunk = -1
  for (let i = 0; i < n; i++) {
    if (/^@@\s/u.test(lines[i]!)) {
      firstHunk = i
      break
    }
  }
  if (firstHunk < 0) return null

  const header = lines.slice(0, firstHunk).join('\n')
  const hunkRanges: { start: number; end: number }[] = []
  let i = firstHunk
  while (i < n) {
    const hStart = i
    i++
    while (i < n && !/^@@\s/u.test(lines[i]!)) i++
    const hEnd = i - 1
    hunkRanges.push({ start: hStart, end: hEnd })
  }

  const picked: typeof hunkRanges = []
  for (const r of hunkRanges) {
    if (Math.max(r.start, a) <= Math.min(r.end, b)) picked.push(r)
  }
  if (!picked.length) return null

  let expandedToFullHunks = false
  for (const r of picked) {
    if (a > r.start || b < r.end) {
      expandedToFullHunks = true
      break
    }
  }

  const bodyParts: string[] = []
  for (const r of picked) {
    bodyParts.push(...lines.slice(r.start, r.end + 1))
  }
  const patch = `${header}\n${bodyParts.join('\n')}\n`
  return { patch, expandedToFullHunks }
}
