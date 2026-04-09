export const WORKSPACE_STORAGE_KEY = 'git-fork-like.workspace.v1'

export type PersistedWorkspaceV1 = {
  v: 1
  repoTabs: Array<{ id: string; path: string; title: string; selectedRemote?: string }>
  activeTabId: string | null
  /** 旧版可能存过 `workflow`，恢复时会当作 `changes` */
  activeView?: 'changes' | 'history' | 'workflow'
  /**
   * 按规范化路径记住工程显示名；标签关闭后仍保留，再次打开同一路径时复用。
   * key：normRepoPath(path) 小写、正斜杠、无末尾斜杠
   */
  repoDisplayNames?: Record<string, string>
}

export function loadPersistedWorkspace(): PersistedWorkspaceV1 | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PersistedWorkspaceV1
    if (data?.v !== 1 || !Array.isArray(data.repoTabs)) return null
    return data
  } catch {
    return null
  }
}

export function savePersistedWorkspace(data: PersistedWorkspaceV1): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedWorkspace(): void {
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY)
  } catch {
    /* empty */
  }
}
