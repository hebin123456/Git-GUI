/**
 * `stash drop` / `stash pop` 后栈顶索引变化，计算侧栏「贮藏」选中项应如何更新。
 * 与 `useGitWorkspace` 中 `adjustSidebarStashSelectionAfterRemove` 行为一致。
 */
export type StashSidebarSelection = { kind: 'stash'; index: number }

export type SidebarRefLike =
  | StashSidebarSelection
  | { kind: 'branch' | 'tag' | 'remoteBranch'; name?: string }
  | null

export type StashSidebarAdjustResult =
  | { type: 'noop' }
  | { type: 'clear-linked-detail' }
  | { type: 'set'; selection: StashSidebarSelection }

export function computeStashSidebarAfterRemove(
  selected: SidebarRefLike,
  removedIndex: number
): StashSidebarAdjustResult {
  if (!selected || selected.kind !== 'stash') return { type: 'noop' }
  if (selected.index === removedIndex) return { type: 'clear-linked-detail' }
  if (selected.index > removedIndex) {
    return { type: 'set', selection: { kind: 'stash', index: selected.index - 1 } }
  }
  return { type: 'noop' }
}
