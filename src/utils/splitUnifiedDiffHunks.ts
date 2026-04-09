/**
 * Split a single-file unified diff into patches that each contain one @@ hunk
 * (suitable for `git apply --cached`).
 */
export function splitUnifiedDiffIntoHunkPatches(fullDiff: string): { summary: string; patch: string }[] {
  const t = fullDiff.replace(/\r\n/g, '\n')
  if (!t.trim() || t.includes('Binary files ') && !t.includes('@@')) {
    return []
  }
  const lines = t.split('\n')
  let firstHunk = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^@@\s/u.test(lines[i]!)) {
      firstHunk = i
      break
    }
  }
  if (firstHunk < 0) return []

  const header = lines.slice(0, firstHunk).join('\n').replace(/\n+$/, '')
  const rest = lines.slice(firstHunk)
  const hunks: string[][] = []
  let cur: string[] = []
  for (const line of rest) {
    if (cur.length && /^@@/u.test(line)) {
      hunks.push(cur)
      cur = [line]
    } else {
      cur.push(line)
    }
  }
  if (cur.length) hunks.push(cur)

  return hunks.map((hunkLines, idx) => {
    const head = hunkLines[0] ?? ''
    const patch = [header, ...hunkLines].join('\n') + '\n'
    return { summary: head.trim() || `#${idx + 1}`, patch }
  })
}
