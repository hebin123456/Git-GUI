/** 进行中的合并 / 变基 / 拣选 / 还原（由主进程检测 `.git` 元数据） */
export type GitOngoingOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

/** Plain status shape returned by main process (paths normalized). */
export interface GitStatusPlain {
  not_added: string[]
  conflicted: string[]
  created: string[]
  deleted: string[]
  modified: string[]
  renamed: { from: string; to: string }[]
  staged: string[]
  ahead: number
  behind: number
  current: string
  tracking: string | null
  detached: boolean
  /** 主进程用 `simple-git` 的 `isClean()` 结果序列化后的布尔值 */
  isClean: boolean
  ongoingOperation: GitOngoingOperation | null
  /** 存在 `.git/BISECT_LOG` 时为 true */
  bisectActive?: boolean
  files: { path: string; index: string; working_dir: string }[]
}

export interface LogEntry {
  hash: string
  date: string
  message: string
  author_name: string
  branches: string
}

/** `@gitgraph/js` `import()` 所需的 git2json 形状（主进程序列化，不含 onClick） */
export interface GitgraphImportRow {
  hash: string
  parents: string[]
  subject: string
  body?: string
  author: { name: string; email: string }
  /** ISO 8601，来自 `git log --date=iso-strict` */
  date?: string
  refs: string[]
}

export type GitLogPayload = {
  entries: LogEntry[]
  gitgraph: GitgraphImportRow[]
}

export interface CommitDetail {
  fullHash: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  date: string
  parents: string[]
  files: { status: string; path: string }[]
}

export type DiffOpts = {
  contextLines?: number
  ignoreBlankLines?: boolean
  ignoreWhitespace?: boolean
  showFullFile?: boolean
}

export type GitErr = { error: string }

export type FetchOpts = string | { remote?: string; all?: boolean; prune?: boolean }

export type PullOpts = {
  remote?: string
  branch?: string
  rebase?: boolean
  autostash?: boolean
}

export type PushOpts = {
  remote?: string
  localBranch?: string
  remoteBranch?: string
  setUpstream?: boolean
  tags?: boolean
  force?: boolean
  /** 与 `force` 二选一；优先 lease */
  forceWithLease?: boolean
  prune?: boolean
  dryRun?: boolean
  /** 仅推送该标签（与分支推送互斥） */
  tagOnly?: string
}

export type StashPushOpts = {
  message?: string
  includeUntracked?: boolean
  /** 与 pathspec 组合：`git stash push --staged -- path…` */
  stagedOnly?: boolean
  /** 仅贮藏列出的仓库相对路径（`git stash push -- path…`） */
  paths?: string[]
}

export interface ElectronWindowApi {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
}

/** 多仓 Git MM 子窗口（不占用主窗口 repo） */
export interface GitMmClientApi {
  openWindow: () => Promise<{ ok: true } | GitErr>
  exec: (opts: { cwd: string; args: string[] }) => Promise<
    { code: number; stdout: string; stderr: string } | GitErr
  >
  /** 可响应子进程 [Y/n] 等提示（主进程检测后弹窗，向 stdin 写入 y/n） */
  execInteractive: (opts: { cwd: string; args: string[] }) => Promise<
    { code: number; stdout: string; stderr: string } | GitErr
  >
  onPrompt: (handler: (payload: { id: string; promptText: string }) => void) => () => void
  answerPrompt: (id: string, line: string) => void
  listSubrepos: (root: string, maxDepth?: number) => Promise<{ paths: string[] } | GitErr>
  openAbsolutePath: (absPath: string) => Promise<{ ok: true } | GitErr>
}

/** 对指定目录执行 Git（Git MM 子仓） */
export interface GitAtClientApi {
  status: (root: string) => Promise<GitStatusPlain | GitErr>
  stage: (root: string, paths: string[]) => Promise<{ ok: true } | GitErr>
  unstage: (root: string, paths: string[]) => Promise<{ ok: true } | GitErr>
  commit: (
    root: string,
    payload: { subject: string; body?: string; amend?: boolean }
  ) => Promise<{ ok: true; hash: string } | GitErr>
  branches: (root: string) => Promise<{ current: string; all: string[] } | GitErr>
  checkout: (root: string, name: string) => Promise<{ ok: true } | GitErr>
  fetch: (root: string, remote?: string) => Promise<{ ok: true } | GitErr>
  pull: (root: string) => Promise<{ ok: true } | GitErr>
  push: (root: string) => Promise<{ ok: true } | GitErr>
  log: (root: string, maxCount?: number) => Promise<GitLogPayload | GitErr>
  diff: (root: string, filePath: string, opts: DiffOpts) => Promise<string | GitErr>
  diffStaged: (root: string, filePath: string, opts: DiffOpts) => Promise<string | GitErr>
  partialLineMerge: (
    root: string,
    opts: {
      relPath: string
      diffText: string
      startLine: number
      endLine: number
      mode: 'stage' | 'unstage' | 'discard-unstaged'
    }
  ) => Promise<{ ok: true; addedContextLines: boolean } | GitErr>
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
  ) => Promise<{ ok: true } | GitErr>
  workingFileMeta: (root: string, relPath: string) => Promise<{ size: number } | GitErr>
  commitDetail: (root: string, hash: string) => Promise<CommitDetail | GitErr>
  commitDiff: (root: string, rev: string, opts: DiffOpts, filePath: string) => Promise<string | GitErr>
  stashList: (root: string) => Promise<{ entries: { index: number; label: string }[] } | GitErr>
  stashPush: (root: string, opts?: StashPushOpts) => Promise<{ ok: true } | GitErr>
  stashDrop: (root: string, index: number) => Promise<{ ok: true } | GitErr>
  stashApply: (root: string, index: number) => Promise<{ ok: true } | GitErr>
  stashPop: (root: string, index: number) => Promise<{ ok: true } | GitErr>
  stashShowPatch: (root: string, index: number) => Promise<{ text: string } | GitErr>
  restoreWorktree: (root: string, paths: string[]) => Promise<{ ok: true } | GitErr>
  checkoutOurs: (root: string, relPath: string) => Promise<{ ok: true } | GitErr>
  checkoutTheirs: (root: string, relPath: string) => Promise<{ ok: true } | GitErr>
  mergetool: (
    root: string,
    relPath?: string,
    opts?: { preset?: string; toolPath?: string }
  ) => Promise<{ ok: true } | GitErr>
}

export interface GitClientApi {
  openRepoDialog: () => Promise<string | null>
  /** 选择目录（克隆时选父路径） */
  selectDirectory: () => Promise<string | null>
  /** 选择可执行文件（设置中的终端 / 合并工具路径） */
  selectExecutable: () => Promise<string | null>
  cloneRepo: (opts: { url: string; directory: string }) => Promise<{ path: string } | GitErr>
  setRepo: (p: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 将主进程仓库切到该路径、聚焦主窗口并触发主界面同步（Git MM 子仓 → 主窗口变更） */
  focusMainWithRepo: (p: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 主进程通知：外部已将仓库切到 path（与 focusMainWithRepo 配套） */
  onExternalRepoSet: (handler: (path: string) => void) => () => void
  clearRepo: () => Promise<{ ok: true }>
  getRoot: () => Promise<string | null>
  status: () => Promise<GitStatusPlain | GitErr>
  stage: (paths: string[]) => Promise<{ ok: true } | GitErr>
  unstage: (paths: string[], opts?: { amend?: boolean }) => Promise<{ ok: true } | GitErr>
  commit: (
    payload: string | { subject: string; body?: string; amend?: boolean }
  ) => Promise<{ ok: true; hash: string } | GitErr>
  workingFileMeta: (relPath: string) => Promise<{ size: number } | GitErr>
  branches: () => Promise<{ current: string; all: string[] } | GitErr>
  branchSetUpstream: (opts: {
    localBranch: string
    /** 远程跟踪引用，如 `origin/main` */
    upstreamRef: string
  }) => Promise<{ ok: true } | GitErr>
  localBranchesTracking: () => Promise<
    | {
        branches: { name: string; upstream: string | null; ahead: number; behind: number }[]
      }
    | GitErr
  >
  checkout: (name: string) => Promise<{ ok: true } | GitErr>
  merge: (ref: string) => Promise<{ ok: true } | GitErr>
  rebase: (ref: string) => Promise<{ ok: true } | GitErr>
  cherryPick: (rev: string) => Promise<{ ok: true } | GitErr>
  revert: (opts: { hash: string; mainline?: number }) => Promise<{ ok: true } | GitErr>
  reset: (opts: { ref: string; mode: 'soft' | 'mixed' | 'hard' }) => Promise<{ ok: true } | GitErr>
  mergeContinue: () => Promise<{ ok: true } | GitErr>
  mergeAbort: () => Promise<{ ok: true } | GitErr>
  rebaseContinue: () => Promise<{ ok: true } | GitErr>
  rebaseAbort: () => Promise<{ ok: true } | GitErr>
  rebaseSkip: () => Promise<{ ok: true } | GitErr>
  cherryPickContinue: () => Promise<{ ok: true } | GitErr>
  cherryPickAbort: () => Promise<{ ok: true } | GitErr>
  revertContinue: () => Promise<{ ok: true } | GitErr>
  revertAbort: () => Promise<{ ok: true } | GitErr>
  branchRename: (from: string, to: string) => Promise<{ ok: true } | GitErr>
  branchDelete: (name: string, force?: boolean) => Promise<{ ok: true } | GitErr>
  branchCreate: (opts: {
    name: string
    startPoint?: string
    checkoutAfter?: boolean
  }) => Promise<{ ok: true } | GitErr>
  remoteAdd: (name: string, url: string) => Promise<{ ok: true } | GitErr>
  remoteRemove: (name: string) => Promise<{ ok: true } | GitErr>
  remoteRename: (from: string, to: string) => Promise<{ ok: true } | GitErr>
  remoteSetUrl: (name: string, url: string) => Promise<{ ok: true } | GitErr>
  remoteTest: (url: string) => Promise<{ ok: true } | GitErr>
  tagCreate: (opts: {
    name: string
    message?: string
    ref?: string
    push?: boolean
    remote?: string
  }) => Promise<{ ok: true } | GitErr>
  /** 删除本地标签；`remote` 有值时再从该远程删除 `refs/tags/<name>` */
  tagDelete: (opts: { name: string; remote?: string }) => Promise<{ ok: true } | GitErr>
  submoduleAdd: (opts: {
    url: string
    path: string
    recursive?: boolean
  }) => Promise<{ ok: true } | GitErr>
  submoduleRemove: (relPath: string) => Promise<{ ok: true } | GitErr>
  /** 不传或 ≤0：返回全部提交；正整数：仅最近 maxCount 条 */
  log: (maxCount?: number) => Promise<GitLogPayload | GitErr>
  logSearch: (opts: {
    grep?: string
    pickaxe?: string
    maxCount?: number
    regexp?: boolean
    allMatch?: boolean
    ignoreCase?: boolean
  }) => Promise<GitLogPayload | GitErr>
  diff: (path: string, opts: DiffOpts) => Promise<string | GitErr>
  diffStaged: (path: string, opts: DiffOpts) => Promise<string | GitErr>
  remotes: () => Promise<{ names: string[] } | GitErr>
  remoteList: () => Promise<{ remotes: { name: string; fetchUrl: string; pushUrl: string }[] } | GitErr>
  tags: () => Promise<{ tags: string[] } | GitErr>
  stashList: () => Promise<{ entries: { index: number; label: string }[] } | GitErr>
  stashPush: (opts?: StashPushOpts) => Promise<{ ok: true } | GitErr>
  /** 删除 `stash@{index}`，与 `git stash drop` 一致 */
  stashDrop: (index: number) => Promise<{ ok: true } | GitErr>
  stashApply: (index: number) => Promise<{ ok: true } | GitErr>
  stashPop: (index: number) => Promise<{ ok: true } | GitErr>
  openRepoRootInExplorer: () => Promise<{ ok: true } | GitErr>
  /** 在终端中打开仓库目录（Windows 优先 Git Bash；可选 shellPath 覆盖为自定义终端） */
  openRepoRootInGitTerminal: (opts?: { shellPath?: string }) => Promise<{ ok: true } | GitErr>
  /** 在仓库根目录打开终端并执行一条命令（执行后保留 shell） */
  openRepoRootInGitTerminalWithCommand: (
    command: string,
    opts?: { shellPath?: string }
  ) => Promise<{ ok: true } | GitErr>
  openRepoRelativeInExplorer: (relPath: string) => Promise<{ ok: true } | GitErr>
  openRepoRelativeInGitTerminal: (
    relPath: string,
    opts?: { shellPath?: string }
  ) => Promise<{ ok: true } | GitErr>
  submodules: () => Promise<{ submodules: { path: string; sha: string; ref?: string }[] } | GitErr>
  fetch: (opts?: FetchOpts) => Promise<{ ok: true } | GitErr>
  pull: (opts?: PullOpts | string, branchLegacy?: string) => Promise<{ ok: true } | GitErr>
  push: (opts?: PushOpts | string, branchLegacy?: string) => Promise<{ ok: true } | GitErr>
  remoteBranches: (remote?: string) => Promise<{ branches: string[] } | GitErr>
  /** 将分支名、tag、remote/分支 等解析为完整 commit hash */
  revParse: (ref: string) => Promise<{ hash: string } | GitErr>
  commitDetail: (hash: string) => Promise<CommitDetail | GitErr>
  /** 提交树快照中的全部文件路径（`git ls-tree -r --name-only`） */
  commitTreePaths: (hash: string) => Promise<{ paths: string[] } | GitErr>
  commitDiff: (hash: string, opts: DiffOpts, filePath: string) => Promise<string | GitErr>
  blame: (relPath: string) => Promise<{ text: string } | GitErr>
  logFile: (opts: { path: string; maxCount?: number }) => Promise<
    | {
        entries: { hash: string; shortHash: string; subject: string; date: string; author: string }[]
      }
    | GitErr
  >
  diffRange: (opts: { from: string; to: string; tripleDot?: boolean }) => Promise<{ text: string } | GitErr>
  reflog: (maxCount?: number) => Promise<
    { entries: { ref: string; hash: string; subject: string }[] } | GitErr
  >
  worktreeList: () => Promise<
    { worktrees: { path: string; head: string; branch: string }[] } | GitErr
  >
  worktreeAdd: (opts: { workPath: string; ref?: string }) => Promise<{ ok: true } | GitErr>
  worktreeRemove: (opts: { workPath: string; force?: boolean }) => Promise<{ ok: true } | GitErr>
  bisectStart: () => Promise<{ ok: true } | GitErr>
  bisectBad: (rev?: string) => Promise<{ ok: true } | GitErr>
  bisectGood: (rev?: string) => Promise<{ ok: true } | GitErr>
  bisectSkip: () => Promise<{ ok: true } | GitErr>
  bisectReset: () => Promise<{ ok: true } | GitErr>
  rebaseTodoRead: () => Promise<{ text: string } | GitErr>
  rebaseTodoWrite: (text: string) => Promise<{ ok: true } | GitErr>
  checkoutOurs: (relPath: string) => Promise<{ ok: true } | GitErr>
  checkoutTheirs: (relPath: string) => Promise<{ ok: true } | GitErr>
  mergetool: (
    relPath?: string,
    opts?: { preset?: string; toolPath?: string }
  ) => Promise<{ ok: true } | GitErr>
  remotePrune: (remote: string) => Promise<{ ok: true } | GitErr>
  submoduleUpdate: (opts?: { init?: boolean; recursive?: boolean }) => Promise<{ ok: true } | GitErr>
  submoduleSync: (opts?: { recursive?: boolean }) => Promise<{ ok: true } | GitErr>
  submoduleUpdateRemote: (opts?: { rebase?: boolean; recursive?: boolean }) => Promise<{ ok: true } | GitErr>
  pushDeleteBranch: (opts: { remote: string; branch: string }) => Promise<{ ok: true } | GitErr>
  diffFileCommits: (opts: { from: string; to: string; path: string }) => Promise<{ text: string } | GitErr>
  lfsVersion: () => Promise<{ version: string } | GitErr>
  lfsInstall: () => Promise<{ ok: true } | GitErr>
  lfsPull: () => Promise<{ ok: true } | GitErr>
  lfsTrack: (pattern: string) => Promise<{ ok: true } | GitErr>
  lfsUntrack: (pattern: string) => Promise<{ ok: true } | GitErr>
  lfsLsFiles: () => Promise<{ lines: string[] } | GitErr>
  applyCachedPatch: (patchText: string, reverse?: boolean) => Promise<{ ok: true } | GitErr>
  /** `git apply` stdin；discard 未暂存片段用 `{ cached:false, reverse:true }` */
  applyPatch: (
    patchText: string,
    opts: {
      cached: boolean
      reverse: boolean
      ignoreSpaceChange?: boolean
      recount?: boolean
      ignoreWhitespace?: boolean
    }
  ) => Promise<{ ok: true } | GitErr>
  /** 行级暂存/取消/丢弃：主进程按 diff 选区合并文本写入索引或工作区，不经 git apply */
  partialLineMerge: (opts: {
    relPath: string
    diffText: string
    startLine: number
    endLine: number
    mode: 'stage' | 'unstage' | 'discard-unstaged'
  }) => Promise<{ ok: true; addedContextLines: boolean } | GitErr>
  /** `git restore --worktree -- <paths>` */
  restoreWorktree: (paths: string[]) => Promise<{ ok: true } | GitErr>
  submoduleForeachPreset: (preset: 'fetch' | 'pull' | 'pullRebase' | 'status') => Promise<{ ok: true } | GitErr>
  /** 系统浏览器打开 https 链接 */
  openExternalUrl: (url: string) => Promise<{ ok: true } | GitErr>
  /** `git stash show -p stash@{index}` */
  stashShowPatch: (index: number) => Promise<{ text: string } | GitErr>
  /** `git symbolic-ref refs/remotes/<remote>/HEAD` 解析出的默认分支名，失败为 null */
  remoteDefaultBranch: (remote: string) => Promise<{ branch: string | null } | GitErr>
}
