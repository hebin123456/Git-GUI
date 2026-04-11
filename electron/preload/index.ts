import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close')
})

contextBridge.exposeInMainWorld('gitMm', {
  openWindow: () => ipcRenderer.invoke('window:open-git-mm'),
  exec: (opts: { cwd: string; args: string[] }) => ipcRenderer.invoke('git-mm:exec', opts),
  execInteractive: (opts: { cwd: string; args: string[] }) =>
    ipcRenderer.invoke('git-mm:exec-interactive', opts),
  onOutput: (handler: (payload: { stream: 'stdout' | 'stderr'; text: string }) => void) => {
    const fn = (_evt: unknown, payload: { stream: 'stdout' | 'stderr'; text: string }) => handler(payload)
    ipcRenderer.on('git-mm:output', fn as (e: unknown, p: unknown) => void)
    return () => ipcRenderer.removeListener('git-mm:output', fn as (e: unknown, p: unknown) => void)
  },
  onPrompt: (handler: (payload: { id: string; promptText: string }) => void) => {
    const fn = (_evt: unknown, payload: { id: string; promptText: string }) => handler(payload)
    ipcRenderer.on('git-mm:prompt', fn as (e: unknown, p: unknown) => void)
    return () => ipcRenderer.removeListener('git-mm:prompt', fn as (e: unknown, p: unknown) => void)
  },
  answerPrompt: (id: string, line: string) => ipcRenderer.send('git-mm:prompt-answer', { id, line }),
  listSubrepos: (root: string, maxDepth?: number) =>
    ipcRenderer.invoke('git-mm:list-subrepos', root, maxDepth),
  openAbsolutePath: (absPath: string) => ipcRenderer.invoke('shell:open-absolute-path', absPath)
})

contextBridge.exposeInMainWorld('gitAt', {
  status: (root: string) => ipcRenderer.invoke('git-at:status', root),
  stage: (root: string, paths: string[]) => ipcRenderer.invoke('git-at:stage', root, paths),
  unstage: (root: string, paths: string[], opts?: { amend?: boolean }) =>
    ipcRenderer.invoke('git-at:unstage', root, paths, opts ?? {}),
  commit: (root: string, payload: { subject: string; body?: string; amend?: boolean }) =>
    ipcRenderer.invoke('git-at:commit', root, payload),
  branches: (root: string) => ipcRenderer.invoke('git-at:branches', root),
  checkout: (root: string, name: string) => ipcRenderer.invoke('git-at:checkout', root, name),
  fetch: (root: string, remote?: string) => ipcRenderer.invoke('git-at:fetch', root, remote),
  pull: (root: string) => ipcRenderer.invoke('git-at:pull', root),
  push: (root: string) => ipcRenderer.invoke('git-at:push', root),
  log: (root: string, maxCount?: number) => ipcRenderer.invoke('git-at:log', root, maxCount),
  diff: (root: string, filePath: string, opts: unknown) =>
    ipcRenderer.invoke('git-at:diff', root, filePath, opts),
  diffStaged: (root: string, filePath: string, opts: unknown) =>
    ipcRenderer.invoke('git-at:diff-staged', root, filePath, opts),
  partialLineMerge: (
    root: string,
    opts: {
      relPath: string
      diffText: string
      startLine: number
      endLine: number
      mode: 'stage' | 'unstage' | 'discard-unstaged'
    }
  ) => ipcRenderer.invoke('git-at:partial-line-merge', root, opts),
  applyPatch: (
    root: string,
    patchText: string,
    opts: {
      cached: boolean
      reverse: boolean
      ignoreSpaceChange?: boolean
      recount?: boolean
      ignoreWhitespace?: boolean
    }
  ) => ipcRenderer.invoke('git-at:apply-patch', root, patchText, opts),
  workingFileMeta: (root: string, relPath: string) =>
    ipcRenderer.invoke('git-at:working-file-meta', root, relPath),
  commitDetail: (root: string, hash: string) => ipcRenderer.invoke('git-at:commit-detail', root, hash),
  commitDiff: (root: string, rev: string, opts: unknown, filePath: string) =>
    ipcRenderer.invoke('git-at:commit-diff', root, rev, opts, filePath),
  stashList: (root: string) => ipcRenderer.invoke('git-at:stash-list', root),
  stashPush: (
    root: string,
    opts?: { message?: string; includeUntracked?: boolean; stagedOnly?: boolean; paths?: string[] }
  ) => ipcRenderer.invoke('git-at:stash-push', root, opts),
  stashDrop: (root: string, index: number) => ipcRenderer.invoke('git-at:stash-drop', root, index),
  stashApply: (root: string, index: number) => ipcRenderer.invoke('git-at:stash-apply', root, index),
  stashPop: (root: string, index: number) => ipcRenderer.invoke('git-at:stash-pop', root, index),
  stashShowPatch: (root: string, index: number) =>
    ipcRenderer.invoke('git-at:stash-show-patch', root, index),
  restoreWorktree: (root: string, paths: string[]) =>
    ipcRenderer.invoke('git-at:restore-worktree', root, paths),
  checkoutOurs: (root: string, relPath: string) =>
    ipcRenderer.invoke('git-at:checkout-ours', root, relPath),
  checkoutTheirs: (root: string, relPath: string) =>
    ipcRenderer.invoke('git-at:checkout-theirs', root, relPath),
  mergetool: (root: string, relPath?: string, opts?: { preset?: string; toolPath?: string }) =>
    ipcRenderer.invoke('git-at:mergetool', root, relPath, opts)
})

contextBridge.exposeInMainWorld('gitClient', {
  openRepoDialog: () => ipcRenderer.invoke('dialog:open-repo'),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectExecutable: () => ipcRenderer.invoke('dialog:select-executable'),
  selectPatchFile: (opts?: { title?: string }) => ipcRenderer.invoke('dialog:select-patch-file', opts ?? {}),
  appStorageGet: (key: string) => ipcRenderer.sendSync('app-storage:get-sync', key) as string | null,
  appStorageSet: (key: string, value: string) => {
    ipcRenderer.sendSync('app-storage:set-sync', { key, value })
  },
  appStorageRemove: (key: string) => {
    ipcRenderer.sendSync('app-storage:remove-sync', key)
  },
  saveTextFile: (opts: { title?: string; defaultPath?: string; text: string }) =>
    ipcRenderer.invoke('dialog:save-text-file', opts),
  cloneRepo: (opts: { url: string; directory: string }) => ipcRenderer.invoke('git:clone', opts),
  setRepo: (p: string) => ipcRenderer.invoke('git:set-repo', p),
  focusMainWithRepo: (p: string) => ipcRenderer.invoke('window:focus-main-with-repo', p),
  onExternalRepoSet: (handler: (path: string) => void) => {
    const fn = (_e: unknown, payload: unknown) => handler(String(payload ?? ''))
    ipcRenderer.on('workspace:external-set-repo', fn as (e: unknown, ...args: unknown[]) => void)
    return () => ipcRenderer.removeListener('workspace:external-set-repo', fn as (e: unknown, ...args: unknown[]) => void)
  },
  clearRepo: () => ipcRenderer.invoke('git:clear-repo'),
  getRoot: () => ipcRenderer.invoke('git:get-root'),
  gitConfigGetMany: (opts: { scope: 'global' | 'local'; keys: string[] }) =>
    ipcRenderer.invoke('git:config-get-many', opts),
  gitConfigSetMany: (opts: { scope: 'global' | 'local'; entries: { key: string; value?: string | null }[] }) =>
    ipcRenderer.invoke('git:config-set-many', opts),
  status: () => ipcRenderer.invoke('git:status'),
  stage: (paths: string[]) => ipcRenderer.invoke('git:stage', paths),
  unstage: (paths: string[], opts?: { amend?: boolean }) =>
    ipcRenderer.invoke('git:unstage', paths, opts ?? {}),
  commit: (payload: string | { subject: string; body?: string; amend?: boolean }) =>
    ipcRenderer.invoke('git:commit', payload),
  workingFileMeta: (relPath: string) => ipcRenderer.invoke('git:working-file-meta', relPath),
  branches: () => ipcRenderer.invoke('git:branches'),
  branchSetUpstream: (opts: { localBranch: string; upstreamRef: string }) =>
    ipcRenderer.invoke('git:branch-set-upstream', opts),
  localBranchesTracking: () => ipcRenderer.invoke('git:local-branches-tracking'),
  checkout: (name: string) => ipcRenderer.invoke('git:checkout', name),
  merge: (ref: string) => ipcRenderer.invoke('git:merge', ref),
  rebase: (ref: string) => ipcRenderer.invoke('git:rebase', ref),
  cherryPick: (rev: string) => ipcRenderer.invoke('git:cherry-pick', rev),
  revert: (opts: { hash: string; mainline?: number }) => ipcRenderer.invoke('git:revert', opts),
  reset: (opts: { ref: string; mode: 'soft' | 'mixed' | 'hard' }) =>
    ipcRenderer.invoke('git:reset', opts),
  mergeContinue: () => ipcRenderer.invoke('git:merge-continue'),
  mergeAbort: () => ipcRenderer.invoke('git:merge-abort'),
  rebaseContinue: () => ipcRenderer.invoke('git:rebase-continue'),
  rebaseAbort: () => ipcRenderer.invoke('git:rebase-abort'),
  rebaseSkip: () => ipcRenderer.invoke('git:rebase-skip'),
  cherryPickContinue: () => ipcRenderer.invoke('git:cherry-pick-continue'),
  cherryPickAbort: () => ipcRenderer.invoke('git:cherry-pick-abort'),
  revertContinue: () => ipcRenderer.invoke('git:revert-continue'),
  revertAbort: () => ipcRenderer.invoke('git:revert-abort'),
  branchRename: (from: string, to: string) => ipcRenderer.invoke('git:branch-rename', from, to),
  branchDelete: (name: string, force?: boolean) => ipcRenderer.invoke('git:branch-delete', name, force),
  branchCreate: (opts: { name: string; startPoint?: string; checkoutAfter?: boolean }) =>
    ipcRenderer.invoke('git:branch-create', opts),
  remoteAdd: (name: string, url: string) => ipcRenderer.invoke('git:remote-add', name, url),
  remoteRemove: (name: string) => ipcRenderer.invoke('git:remote-remove', name),
  remoteRename: (from: string, to: string) => ipcRenderer.invoke('git:remote-rename', from, to),
  remoteSetUrl: (name: string, url: string) => ipcRenderer.invoke('git:remote-set-url', name, url),
  remoteTest: (url: string) => ipcRenderer.invoke('git:remote-test', url),
  tagCreate: (opts: {
    name: string
    message?: string
    ref?: string
    push?: boolean
    remote?: string
  }) => ipcRenderer.invoke('git:tag-create', opts),
  tagDelete: (opts: { name: string; remote?: string }) =>
    ipcRenderer.invoke('git:tag-delete', opts),
  submoduleAdd: (opts: { url: string; path: string; recursive?: boolean }) =>
    ipcRenderer.invoke('git:submodule-add', opts),
  submoduleRemove: (relPath: string) => ipcRenderer.invoke('git:submodule-remove', relPath),
  log: (maxCount?: number) => ipcRenderer.invoke('git:log', maxCount),
  logSearch: (opts: {
    grep?: string
    pickaxe?: string
    maxCount?: number
    regexp?: boolean
    allMatch?: boolean
    ignoreCase?: boolean
  }) => ipcRenderer.invoke('git:log-search', opts),
  diff: (path: string, opts: unknown) => ipcRenderer.invoke('git:diff', path, opts),
  diffStaged: (path: string, opts: unknown) => ipcRenderer.invoke('git:diff-staged', path, opts),
  remotes: () => ipcRenderer.invoke('git:remotes'),
  remoteList: () => ipcRenderer.invoke('git:remote-list'),
  tags: () => ipcRenderer.invoke('git:tags'),
  stashList: () => ipcRenderer.invoke('git:stash-list'),
  stashPush: (opts?: {
    message?: string
    includeUntracked?: boolean
    stagedOnly?: boolean
    paths?: string[]
  }) => ipcRenderer.invoke('git:stash-push', opts),
  stashDrop: (index: number) => ipcRenderer.invoke('git:stash-drop', index),
  stashApply: (index: number) => ipcRenderer.invoke('git:stash-apply', index),
  stashPop: (index: number) => ipcRenderer.invoke('git:stash-pop', index),
  openRepoRootInExplorer: () => ipcRenderer.invoke('shell:open-repo-root'),
  openRepoRootInGitTerminal: (opts?: { shellPath?: string }) =>
    ipcRenderer.invoke('shell:open-repo-git-terminal', opts ?? {}),
  openRepoRootInGitTerminalWithCommand: (command: string, opts?: { shellPath?: string }) =>
    ipcRenderer.invoke('shell:open-repo-git-terminal-command', command, opts ?? {}),
  openRepoRelativeInExplorer: (relPath: string) =>
    ipcRenderer.invoke('shell:open-repo-relative-in-explorer', relPath),
  openRepoRelativeInGitTerminal: (relPath: string, opts?: { shellPath?: string }) =>
    ipcRenderer.invoke('shell:open-repo-relative-in-git-terminal', relPath, opts ?? {}),
  submodules: () => ipcRenderer.invoke('git:submodules'),
  fetch: (arg?: string | { remote?: string; all?: boolean; prune?: boolean }) =>
    ipcRenderer.invoke('git:fetch', arg),
  pull: (
    a?: string | { remote?: string; branch?: string; rebase?: boolean; autostash?: boolean },
    b?: string
  ) => ipcRenderer.invoke('git:pull', a, b),
  push: (
    a?:
      | string
      | {
          remote?: string
          localBranch?: string
          remoteBranch?: string
          setUpstream?: boolean
          tags?: boolean
          force?: boolean
          forceWithLease?: boolean
          prune?: boolean
          dryRun?: boolean
          tagOnly?: string
        },
    b?: string
  ) => ipcRenderer.invoke('git:push', a, b),
  remoteBranches: (remote?: string) => ipcRenderer.invoke('git:remote-branches', remote),
  revParse: (ref: string) => ipcRenderer.invoke('git:rev-parse', ref),
  commitDetail: (hash: string) => ipcRenderer.invoke('git:commit-detail', hash),
  commitDiff: (hash: string, opts: unknown, filePath: string) =>
    ipcRenderer.invoke('git:commit-diff', hash, opts, filePath),
  commitTreePaths: (hash: string) => ipcRenderer.invoke('git:commit-tree-paths', hash),
  exportCommitArchive: (opts: { hash: string; title?: string; defaultPath?: string }) =>
    ipcRenderer.invoke('git:export-commit-archive', opts),
  blame: (relPath: string) => ipcRenderer.invoke('git:blame', relPath),
  logFile: (opts: { path: string; maxCount?: number }) => ipcRenderer.invoke('git:log-file', opts),
  diffRange: (opts: { from: string; to: string; tripleDot?: boolean }) =>
    ipcRenderer.invoke('git:diff-range', opts),
  reflog: (maxCount?: number) => ipcRenderer.invoke('git:reflog', maxCount),
  worktreeList: () => ipcRenderer.invoke('git:worktree-list'),
  worktreeAdd: (opts: { workPath: string; ref?: string }) => ipcRenderer.invoke('git:worktree-add', opts),
  worktreeRemove: (opts: { workPath: string; force?: boolean }) =>
    ipcRenderer.invoke('git:worktree-remove', opts),
  bisectStart: () => ipcRenderer.invoke('git:bisect-start'),
  bisectBad: (rev?: string) => ipcRenderer.invoke('git:bisect-bad', rev),
  bisectGood: (rev?: string) => ipcRenderer.invoke('git:bisect-good', rev),
  bisectSkip: () => ipcRenderer.invoke('git:bisect-skip'),
  bisectReset: () => ipcRenderer.invoke('git:bisect-reset'),
  rebaseTodoRead: () => ipcRenderer.invoke('git:rebase-todo-read'),
  rebaseTodoWrite: (text: string) => ipcRenderer.invoke('git:rebase-todo-write', text),
  checkoutOurs: (relPath: string) => ipcRenderer.invoke('git:checkout-ours', relPath),
  checkoutTheirs: (relPath: string) => ipcRenderer.invoke('git:checkout-theirs', relPath),
  mergetool: (relPath?: string, opts?: { preset?: string; toolPath?: string }) =>
    ipcRenderer.invoke('git:mergetool', relPath, opts ?? {}),
  remotePrune: (remote: string) => ipcRenderer.invoke('git:remote-prune', remote),
  submoduleUpdate: (opts?: { init?: boolean; recursive?: boolean }) =>
    ipcRenderer.invoke('git:submodule-update', opts),
  submoduleSync: (opts?: { recursive?: boolean }) => ipcRenderer.invoke('git:submodule-sync', opts),
  submoduleUpdateRemote: (opts?: { rebase?: boolean; recursive?: boolean }) =>
    ipcRenderer.invoke('git:submodule-update-remote', opts),
  pushDeleteBranch: (opts: { remote: string; branch: string }) =>
    ipcRenderer.invoke('git:push-delete-branch', opts),
  diffFileCommits: (opts: { from: string; to: string; path: string }) =>
    ipcRenderer.invoke('git:diff-file-commits', opts),
  lfsVersion: () => ipcRenderer.invoke('git:lfs-version'),
  lfsInstall: () => ipcRenderer.invoke('git:lfs-install'),
  lfsPull: () => ipcRenderer.invoke('git:lfs-pull'),
  lfsTrack: (pattern: string) => ipcRenderer.invoke('git:lfs-track', pattern),
  lfsUntrack: (pattern: string) => ipcRenderer.invoke('git:lfs-untrack', pattern),
  lfsLsFiles: () => ipcRenderer.invoke('git:lfs-ls-files'),
  applyCachedPatch: (patchText: string, reverse?: boolean) =>
    ipcRenderer.invoke('git:apply-cached-patch', patchText, !!reverse),
  applyPatch: (
    patchText: string,
    opts: {
      cached: boolean
      reverse: boolean
      ignoreSpaceChange?: boolean
      recount?: boolean
      ignoreWhitespace?: boolean
    }
  ) => ipcRenderer.invoke('git:apply-patch', patchText, opts),
  partialLineMerge: (opts: {
    relPath: string
    diffText: string
    startLine: number
    endLine: number
    mode: 'stage' | 'unstage' | 'discard-unstaged'
  }) => ipcRenderer.invoke('git:partial-line-merge', opts),
  restoreWorktree: (paths: string[]) => ipcRenderer.invoke('git:restore-worktree', paths),
  submoduleForeachPreset: (preset: 'fetch' | 'pull' | 'pullRebase' | 'status') =>
    ipcRenderer.invoke('git:submodule-foreach-preset', preset),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  stashShowPatch: (index: number) => ipcRenderer.invoke('git:stash-show-patch', index),
  remoteDefaultBranch: (remote: string) => ipcRenderer.invoke('git:remote-default-branch', remote)
})
