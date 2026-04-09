/**
 * 按 unified diff 与「旧版」文件内容做行级合并，不经过 `git apply`。
 * - applySelected：只把选区内的 -/+ 从 old 推向 new（暂存：old=索引）
 * - applyUnselected：对其余行推 delta（取消暂存：old=HEAD；丢弃未暂存：old=索引 → 写工作区）
 */

import { expandPairedChangeLinesInBody } from './diffLineRangePatch.ts'

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

export type PartialLineDeltaMode = 'applySelected' | 'applyUnselected'

function splitLinesNoArtifact(text: string): string[] {
  const t = text.replace(/\r\n/g, '\n')
  if (t === '') return []
  const parts = t.split('\n')
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/**
 * @param oldText minus 侧（---）文件完整文本，须与生成该 diff 的 old 版一致
 * @param diffText 与界面相同的 unified diff（单文件）
 */
export function mergePartialUsingUnifiedDiff(
  oldText: string,
  diffText: string,
  selStart: number,
  selEnd: number,
  deltaMode: PartialLineDeltaMode
): { text: string; addedContextLines: boolean } | null {
  const lines = splitLinesNoArtifact(diffText.replace(/\r\n/g, '\n'))
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

  const oldNorm = oldText.replace(/\r\n/g, '\n')
  const oldLines = splitLinesNoArtifact(oldNorm)
  const out: string[] = []
  let ptr = 0
  let addedContextLines = false

  let i = firstHunk
  while (i < n) {
    if (!/^@@\s/u.test(lines[i]!)) {
      i++
      continue
    }
    const parsed = parseGitHunkHeader(lines[i]!)
    if (!parsed) {
      i++
      continue
    }
    i++
    const bodyStart = i
    while (i < n && !/^@@\s/u.test(lines[i]!)) i++
    const bodyEnd = i - 1
    if (bodyStart > bodyEnd) continue

    const bodyLines = lines.slice(bodyStart, bodyEnd + 1)
    const rangeLo = Math.max(bodyStart, a)
    const rangeHi = Math.min(bodyEnd, b)

    let pairedLo: number
    let pairedHi: number
    if (rangeLo <= rangeHi) {
      const relLoRaw = rangeLo - bodyStart
      const relHiRaw = rangeHi - bodyStart
      const paired = expandPairedChangeLinesInBody(bodyLines, relLoRaw, relHiRaw)
      pairedLo = paired.lo
      pairedHi = paired.hi
      if (pairedLo < relLoRaw || pairedHi > relHiRaw) addedContextLines = true
    } else {
      pairedLo = bodyLines.length
      pairedHi = -1
    }

    if (parsed.oldStart > 0) {
      while (ptr < parsed.oldStart - 1) {
        out.push(oldLines[ptr] ?? '')
        ptr++
      }
    }

    for (let j = 0; j < bodyLines.length; j++) {
      const line = bodyLines[j] ?? ''
      const c = line[0] ?? ' '
      const rest = line.slice(1)
      if (c === '\\') continue
      const inPaired = j >= pairedLo && j <= pairedHi
      const active = deltaMode === 'applySelected' ? inPaired : !inPaired

      if (c === ' ') {
        out.push(oldLines[ptr] ?? '')
        ptr++
      } else if (c === '-') {
        if (active) {
          ptr++
        } else {
          out.push(oldLines[ptr] ?? '')
          ptr++
        }
      } else if (c === '+') {
        if (active) {
          out.push(rest)
        }
      }
    }
  }

  while (ptr < oldLines.length) {
    out.push(oldLines[ptr] ?? '')
    ptr++
  }

  const text = out.join('\n')

  return { text, addedContextLines }
}
