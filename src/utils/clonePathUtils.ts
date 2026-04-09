/** 从远程 URL 推导建议的本地文件夹名（与 `useGitWorkspace` 克隆对话框一致） */
export function deriveCloneFolderFromUrl(url: string): string {
  const u = url.trim()
  if (!u) return ''
  let tail = u.replace(/[/\\]+$/, '').split(/[/\\:]/).pop() ?? ''
  tail = tail.replace(/\.git$/i, '')
  tail = tail.replace(/[/\\:*?"<>|]+/g, '-').replace(/^\.+/, '').trim()
  return tail || 'repo'
}

/** 克隆目标目录名：去掉非法字符，空则 `repo` */
export function sanitizeCloneFolderSegment(name: string): string {
  return name.trim().replace(/[/\\:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'repo'
}

/**
 * 拼接父目录 + 文件夹名，与界面层 `runCloneRepo` 行为一致。
 * `parent` 含 `\` 时使用反斜杠（Windows 对话框返回路径）。
 */
export function joinCloneTargetPath(parent: string, folder: string): string {
  const sep = parent.includes('\\') ? '\\' : '/'
  const f = sanitizeCloneFolderSegment(folder).replace(/^[/\\]+/, '').replace(/\//g, sep)
  return `${parent.replace(/[/\\]+$/, '')}${sep}${f}`
}
