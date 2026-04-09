/**
 * 主窗口与 Git MM 等窗口间：同一仓库 Git 状态变化后通知刷新（BroadcastChannel）。
 * 不依赖 storage 事件，在 Electron 多窗口下可靠。
 */
export const REPO_WORKSPACE_SYNC_CHANNEL = 'git-fork-like.repo-workspace.sync'

export type RepoWorkspaceSyncPayload = {
  type: 'git-state-changed'
  /** 主进程当前仓库根目录绝对路径（与 git:get-root / 子仓路径可比） */
  repoRoot: string
  reason?: 'commit' | string
  /** 发起方：用于避免本窗口处理自己发出的广播 */
  origin?: 'main' | 'git-mm'
}
