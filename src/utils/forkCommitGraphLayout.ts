import type { GitgraphImportRow } from '../types/git-client'

/** 与 HistoryGitgraph 虚拟行高、视觉一致；Fork 类工具多为正交折线 */
export const FORK_GRAPH_TEMPLATE = {
  colors: [
    '#2b7ce8',
    '#6e7781',
    '#1a7f37',
    '#9a6700',
    '#8250df',
    '#cf222e',
    '#57606a'
  ],
  branch: {
    lineWidth: 1.75,
    spacing: 13
  },
  commit: {
    /** 与 HistoryGitgraph 单行（分支标签 + 说明）行高一致 */
    spacing: 32,
    dot: {
      size: 5,
      strokeWidth: 1.5,
      strokeColor: '#ffffff'
    }
  }
} as const

/** 与虚拟列表、行高一致 */
export const FORK_COMMIT_ROW_HEIGHT = FORK_GRAPH_TEMPLATE.commit.spacing

const INIT_COMMIT_OFFSET_X = 4

export type ForkGraphDot = {
  x: number
  y: number
  color: string
  dotSize: number
  strokeWidth: number
  strokeColor: string
}

export type ForkGraphPath = {
  d: string
  stroke: string
  strokeWidth: number
}

export type ForkCommitGraphLayout = {
  rowHeight: number
  graphWidth: number
  svgHeight: number
  /** 与 rows 顺序一致（最新在上） */
  dots: (ForkGraphDot | null)[]
  paths: ForkGraphPath[]
  /** paths / dots 的 g 上使用 translate(dotPad, dotPad) */
  dotPad: number
}

function laneX(lane: number): number {
  return INIT_COMMIT_OFFSET_X + lane * FORK_GRAPH_TEMPLATE.branch.spacing
}

function rowCenterY(row: number, rowHeight: number): number {
  return row * rowHeight + rowHeight / 2
}

/** 子在上、父在下：正交折线（竖再横），同列则竖线 */
function orthoChildToParent(
  xChild: number,
  yChild: number,
  xParent: number,
  yParent: number
): string {
  if (yParent <= yChild + 0.5) return ''
  if (Math.abs(xChild - xParent) < 0.5) {
    return `M ${xChild} ${yChild} L ${xParent} ${yParent}`
  }
  return `M ${xChild} ${yChild} L ${xChild} ${yParent} L ${xParent} ${yParent}`
}

/**
 * 紧凑 Fork / git log 风格：首父延续同一条竖线，旁支从该线向右分叉。
 * 不采用「每个分支名一列」的 gitgraph 模型。
 */
export function buildForkCommitGraphLayout(rows: GitgraphImportRow[]): ForkCommitGraphLayout | null {
  if (!rows.length) return null

  const n = rows.length
  const rowHeight = FORK_GRAPH_TEMPLATE.commit.spacing
  const dotPad = FORK_GRAPH_TEMPLATE.commit.dot.size
  const svgHeight = n * rowHeight
  const colors = FORK_GRAPH_TEMPLATE.colors

  const hashToRow = new Map<string, number>()
  for (let k = 0; k < n; k++) {
    hashToRow.set(rows[k].hash, k)
  }

  /** 同一首父下的子提交，按行序（最新在前 = 索引升序） */
  const childrenByFirstParent = new Map<string, number[]>()
  for (let k = 0; k < n; k++) {
    const p0 = rows[k].parents[0]
    if (!p0) continue
    if (!childrenByFirstParent.has(p0)) childrenByFirstParent.set(p0, [])
    childrenByFirstParent.get(p0)!.push(k)
  }
  for (const arr of childrenByFirstParent.values()) {
    arr.sort((a, b) => a - b)
  }

  const forkRank = new Map<number, number>()
  for (const children of childrenByFirstParent.values()) {
    children.forEach((childIdx, r) => forkRank.set(childIdx, r))
  }

  /**
   * Fork / git log --graph：最左一列是「主线」——从当前列表第一条（最新提交）沿首父链一直连到可见历史底部，
   * 形成一根从顶到底的竖线；旁支从该线向右分叉。
   */
  const onMainTrunk = new Set<number>()
  {
    let k = 0
    while (k < n) {
      onMainTrunk.add(k)
      const p0 = rows[k].parents[0]
      if (!p0) break
      const pr = hashToRow.get(p0)
      if (pr === undefined) break
      k = pr
    }
  }

  const lane = new Array<number>(n).fill(0)

  for (let k = n - 1; k >= 0; k--) {
    const c = rows[k]
    if (onMainTrunk.has(k)) {
      lane[k] = 0
      continue
    }
    if (!c.parents.length) {
      lane[k] = 0
      continue
    }
    const pr = hashToRow.get(c.parents[0])
    if (pr === undefined) {
      lane[k] = 0
      continue
    }
    if (c.parents.length > 1) {
      lane[k] = lane[pr]
      continue
    }
    const r = forkRank.get(k) ?? 0
    if (r === 0) {
      lane[k] = lane[pr]
    } else {
      lane[k] = lane[pr] + r
    }
  }

  const dots: (ForkGraphDot | null)[] = new Array(n)
  let maxX = 0
  for (let k = 0; k < n; k++) {
    const l = lane[k]
    const x = laneX(l)
    const y = rowCenterY(k, rowHeight)
    const color = colors[l % colors.length]
    const ds = FORK_GRAPH_TEMPLATE.commit.dot.size
    maxX = Math.max(maxX, x + ds)
    dots[k] = {
      x,
      y,
      color,
      dotSize: ds,
      strokeWidth: FORK_GRAPH_TEMPLATE.commit.dot.strokeWidth,
      strokeColor: FORK_GRAPH_TEMPLATE.commit.dot.strokeColor
    }
  }

  const paths: ForkGraphPath[] = []
  for (let k = 0; k < n; k++) {
    const c = rows[k]
    const parents = c.parents
    if (!parents.length) continue

    const yChild = rowCenterY(k, rowHeight)
    const xChild = laneX(lane[k])

    for (let pi = 0; pi < parents.length; pi++) {
      const pHash = parents[pi]
      const pr = hashToRow.get(pHash)
      if (pr === undefined) continue

      const xParent = laneX(lane[pr])
      const yParent = rowCenterY(pr, rowHeight)
      const d = orthoChildToParent(xChild, yChild, xParent, yParent)
      if (!d) continue

      const stroke =
        pi === 0 ? colors[lane[k] % colors.length] : colors[lane[pr] % colors.length]
      paths.push({ d, stroke, strokeWidth: FORK_GRAPH_TEMPLATE.branch.lineWidth })
    }
  }

  const graphWidth = Math.max(maxX + dotPad * 2 + 8, 88)

  return {
    rowHeight,
    graphWidth,
    svgHeight,
    dots,
    paths,
    dotPad
  }
}
