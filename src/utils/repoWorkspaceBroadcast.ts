import {
  REPO_WORKSPACE_SYNC_CHANNEL,
  type RepoWorkspaceSyncPayload
} from '../constants/repoWorkspaceSync.ts'

let channel: BroadcastChannel | null = null

/** 通知其他窗口：某仓库根目录下 Git 状态已变（主窗口 ↔ Git MM 双向） */
export function broadcastRepoWorkspaceChanged(
  repoRoot: string,
  reason: string,
  origin: 'main' | 'git-mm'
): void {
  if (!repoRoot.trim() || typeof BroadcastChannel === 'undefined') return
  try {
    if (!channel) channel = new BroadcastChannel(REPO_WORKSPACE_SYNC_CHANNEL)
    const payload: RepoWorkspaceSyncPayload = {
      type: 'git-state-changed',
      repoRoot,
      reason,
      origin
    }
    channel.postMessage(payload)
  } catch {
    /* ignore */
  }
}
