/** 交互式变基 git-rebase-todo 的图形编辑用解析 / 序列化 */

export type RebaseTodoRow =
  | { id: string; kind: 'commit'; command: string; hash: string; subject: string }
  | { id: string; kind: 'exec'; body: string }
  | { id: string; kind: 'break' }
  | { id: string; kind: 'comment'; text: string }
  | { id: string; kind: 'raw'; text: string }

const SHORT_CMD: Record<string, string> = {
  p: 'pick',
  pick: 'pick',
  r: 'reword',
  reword: 'reword',
  e: 'edit',
  edit: 'edit',
  s: 'squash',
  squash: 'squash',
  f: 'fixup',
  fixup: 'fixup',
  d: 'drop',
  drop: 'drop'
}

export const REBASE_GRAPH_COMMANDS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const

function isGraphCommand(cmd: string): cmd is (typeof REBASE_GRAPH_COMMANDS)[number] {
  return (REBASE_GRAPH_COMMANDS as readonly string[]).includes(cmd)
}

export function normalizeRebaseCommand(cmd: string): string {
  const k = cmd.trim().toLowerCase()
  return SHORT_CMD[k] ?? k
}

export function parseRebaseTodo(text: string): RebaseTodoRow[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: RebaseTodoRow[] = []
  let n = 0
  for (const line of lines) {
    const id = `rt-${++n}`
    if (line === '') {
      out.push({ id, kind: 'raw', text: '' })
      continue
    }
    if (/^\s*#/u.test(line)) {
      out.push({ id, kind: 'comment', text: line })
      continue
    }
    const trimmed = line.trim()
    const commitM = trimmed.match(
      /^(\S+)\s+([0-9a-f]{7,40})\s*(.*)$/u
    )
    if (commitM) {
      const cmdRaw = normalizeRebaseCommand(commitM[1]!)
      const cmd = isGraphCommand(cmdRaw) ? cmdRaw : 'pick'
      out.push({
        id,
        kind: 'commit',
        command: cmd,
        hash: commitM[2]!,
        subject: (commitM[3] ?? '').trimEnd()
      })
      continue
    }
    const execM = trimmed.match(/^(?:exec|x)\s+(.+)$/u)
    if (execM) {
      out.push({ id, kind: 'exec', body: execM[1]!.trimEnd() })
      continue
    }
    if (/^(?:break|b)(?:\s|$)/iu.test(trimmed)) {
      out.push({ id, kind: 'break' })
      continue
    }
    out.push({ id, kind: 'raw', text: line })
  }
  return out
}

export function serializeRebaseTodo(rows: RebaseTodoRow[]): string {
  const lines = rows.map((r) => {
    switch (r.kind) {
      case 'commit':
        return `${r.command} ${r.hash}${r.subject ? ` ${r.subject}` : ''}`
      case 'exec':
        return `exec ${r.body}`
      case 'break':
        return 'break'
      case 'comment':
        return r.text
      case 'raw':
        return r.text
      default:
        return ''
    }
  })
  return lines.join('\n')
}

export function newRowId(): string {
  return `rt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
