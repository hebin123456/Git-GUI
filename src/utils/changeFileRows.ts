import type { GitStatusPlain } from '../types/git-client.ts'

/** 与 useGitWorkspace 中 Row 一致，供变更树与 Git MM 复用 */
export type ChangeFileRow = {
  path: string
  label: string
  staged: boolean
  unstaged: boolean
  index: string
  workingDir: string
  amendCommitStatus?: string
}

export type ChangeFileTreeNode = {
  id: string
  label: string
  children?: ChangeFileTreeNode[]
  path?: string
  row?: ChangeFileRow
}

type DirMap = { dirs: Map<string, DirMap>; files: ChangeFileRow[] }

/** 提交里 `old → new` 仅用于 diff/选中 id；建树分层必须用新路径拆目录 */
export function pathForCommitTreeLayout(spec: string): string {
  const s = spec.trim()
  const arrow = ' → '
  if (s.includes(arrow)) {
    const tail = s.split(arrow).pop()?.trim()
    if (tail) return tail
  }
  return s
}

function mergeFileRowsForSamePath(a: ChangeFileRow, b: ChangeFileRow): ChangeFileRow {
  const staged = a.staged || b.staged
  const unstaged = a.unstaged || b.unstaged
  const aUnt = a.index === '?' && a.workingDir === '?'
  const bUnt = b.index === '?' && b.workingDir === '?'
  const aDel = a.index === 'D'
  const bDel = b.index === 'D'
  const ix = aDel || bDel ? 'D' : aUnt || bUnt ? '?' : b.index || a.index
  const wd = aUnt || bUnt ? '?' : b.workingDir || a.workingDir || ''
  const ixF = ix
  const wdF = wd
  const label =
    ixF === '?' && wdF === '?'
      ? '??'
      : ixF === 'D' && wdF === '?'
        ? 'D / ??'
        : [ixF, wdF].filter(Boolean).join(' / ') || '—'
  return {
    path: a.path,
    label,
    staged,
    unstaged,
    index: ixF,
    workingDir: wdF,
    amendCommitStatus: a.amendCommitStatus ?? b.amendCommitStatus
  }
}

/** 从 status 构建变更文件行（与 useGitWorkspace 的 fileRows 一致） */
export function buildChangeFileRowsFromStatus(s: GitStatusPlain | null): ChangeFileRow[] {
  if (!s) return []
  const map = new Map<string, ChangeFileRow>()
  for (const f of s.files) {
    const staged =
      s.staged.includes(f.path) ||
      s.renamed.some(
        (r) =>
          r.to === f.path ||
          r.from === f.path ||
          pathForCommitTreeLayout(r.to) === pathForCommitTreeLayout(f.path) ||
          pathForCommitTreeLayout(r.from) === pathForCommitTreeLayout(f.path)
      )
    const wd = f.working_dir.trim()
    const unstaged =
      (wd !== '' && wd !== '?') || s.not_added.includes(f.path) || (!staged && f.index === '?')
    const ix = f.index !== ' ' && f.index ? f.index : ''
    const wdx = f.working_dir !== ' ' && f.working_dir ? f.working_dir : ''
    const label = ix === '?' && wdx === '?' ? '??' : [ix, wdx].filter(Boolean).join(' / ') || '—'
    const next: ChangeFileRow = {
      path: f.path,
      label,
      staged,
      unstaged,
      index: ix,
      workingDir: wdx
    }
    const prev = map.get(f.path)
    map.set(f.path, prev ? mergeFileRowsForSamePath(prev, next) : next)
  }
  for (const p of s.not_added) {
    if (!map.has(p))
      map.set(p, {
        path: p,
        label: '??',
        staged: false,
        unstaged: true,
        index: '?',
        workingDir: '?'
      })
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function commitFileGlyphs(status: string): { plus: boolean; minus: boolean; modified: boolean } {
  const c = (status.trim()[0] || '').toUpperCase()
  if (c === 'A') return { plus: true, minus: false, modified: false }
  if (c === 'D') return { plus: false, minus: true, modified: false }
  if (c === 'M') return { plus: false, minus: false, modified: true }
  if (c === 'R' || c === 'C' || c === 'T' || c === 'U') return { plus: false, minus: false, modified: true }
  return { plus: false, minus: false, modified: false }
}

/** 与 useGitWorkspace.statusGlyphsForRow 一致 */
export function statusGlyphsForChangeRow(
  row: ChangeFileRow,
  scope: 'staged' | 'unstaged'
): { plus: boolean; minus: boolean; modified: boolean } {
  if (scope === 'staged' && row.amendCommitStatus) {
    return commitFileGlyphs(row.amendCommitStatus)
  }
  const ix = row.index || ' '
  const wd = row.workingDir || ' '
  if (scope === 'unstaged') {
    if (ix === 'D' && wd === '?') return { plus: true, minus: false, modified: false }
    if (wd === 'D') return { plus: false, minus: true, modified: false }
    if (ix === '?' && wd === '?') return { plus: true, minus: false, modified: false }
    if (wd === 'M') return { plus: false, minus: false, modified: true }
    if (wd === 'A') return { plus: true, minus: false, modified: false }
    if (wd === 'R' || wd === 'C' || wd === 'U') return { plus: false, minus: false, modified: true }
    return { plus: false, minus: false, modified: false }
  }
  if (ix === 'D') return { plus: false, minus: true, modified: false }
  if (ix === 'A') return { plus: true, minus: false, modified: false }
  if (ix === 'M') return { plus: false, minus: false, modified: true }
  if (ix === 'R' || ix === 'C') return { plus: false, minus: false, modified: true }
  return { plus: false, minus: false, modified: false }
}

function addRowToDirMap(root: DirMap, row: ChangeFileRow) {
  const parts = pathForCommitTreeLayout(row.path).split(/[/\\]/).filter(Boolean)
  let cur = root
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]
    if (i === parts.length - 1) {
      cur.files.push(row)
    } else {
      if (!cur.dirs.has(seg!)) cur.dirs.set(seg!, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(seg!)!
    }
  }
}

function dirMapToTreeNodes(dm: DirMap, idPrefix: string): ChangeFileTreeNode[] {
  const nodes: ChangeFileTreeNode[] = []
  const dirEntries = [...dm.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [name, sub] of dirEntries) {
    const segPath = idPrefix ? `${idPrefix}/${name}` : name
    const children = dirMapToTreeNodes(sub, segPath)
    nodes.push({
      id: `dir:${segPath}`,
      label: name,
      children
    })
  }
  const files = [...dm.files].sort((a, b) => a.path.localeCompare(b.path))
  for (const row of files) {
    const name = pathForCommitTreeLayout(row.path).split(/[/\\]/).filter(Boolean).pop()!
    nodes.push({
      id: row.path,
      label: name,
      path: row.path,
      row
    })
  }
  return nodes
}

export function rowsToPathTreeForChanges(rows: ChangeFileRow[]): ChangeFileTreeNode[] {
  const root: DirMap = { dirs: new Map(), files: [] }
  for (const row of rows) addRowToDirMap(root, row)
  return dirMapToTreeNodes(root, '')
}
