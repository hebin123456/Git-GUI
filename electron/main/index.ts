import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git'
import { mergePartialUsingUnifiedDiff } from '../../src/utils/partialLineMerge.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.DIST = path.join(__dirname, '..', 'dist')

/** 开发态从仓库 `build/icon.png`；打包后从 `extraResources` 的 `icon.png` 读取 */
function resolveAppIconPath(): string | undefined {
  const devPath = path.join(__dirname, '..', 'build', 'icon.png')
  if (!app.isPackaged) {
    if (fs.existsSync(devPath)) return devPath
    return undefined
  }
  const packed = path.join(process.resourcesPath, 'icon.png')
  if (fs.existsSync(packed)) return packed
  return undefined
}

/** git-mm:exec-interactive 中 [Y/n] 提示，等待渲染进程回写 y/n */
const pendingGitMmPromptResolvers = new Map<string, (line: string) => void>()
ipcMain.on('git-mm:prompt-answer', (_e, raw: unknown) => {
  const o = raw && typeof raw === 'object' ? (raw as { id?: string; line?: string }) : {}
  const id = String(o.id ?? '')
  const line = String(o.line ?? 'n').trim().toLowerCase()
  const res = pendingGitMmPromptResolvers.get(id)
  if (!res) return
  pendingGitMmPromptResolvers.delete(id)
  res(line.startsWith('y') ? 'y' : 'n')
})

let mainWindow: BrowserWindow | null = null
let gitMmWindow: BrowserWindow | null = null
/**
 * Git MM（无边框）：Windows 从任务栏还原时系统常先处于非最大化，需在 restore 后再 maximize。
 * `gitMmUserWantsMaximized` 在标题栏点「还原」时由 IPC 清除，避免误把用户已取消的最大化恢复回来。
 */
let gitMmUserWantsMaximized = false
let gitMmRestoreMaximizedAfterMinimize = false
let repoRoot: string | null = null
let git: SimpleGit | null = null

function j(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function pathForCommitLayout(spec: string): string {
  const s = spec.trim()
  const arrow = ' → '
  if (s.includes(arrow)) {
    const tail = s.split(arrow).pop()?.trim()
    if (tail) return j(tail)
  }
  return j(s)
}

function isPathUnderRepo(absPath: string): boolean {
  if (!repoRoot) return false
  const root = path.resolve(repoRoot)
  const p = path.resolve(absPath)
  return p === root || p.startsWith(root + path.sep)
}

/** 仓库内相对路径，禁止 .. 与绝对路径 */
function normalizeRepoRelative(rel: string): string | null {
  const s = String(rel ?? '').trim().replace(/\\/g, '/')
  if (!s || s.includes('..') || path.isAbsolute(s)) return null
  return s
}

/**
 * git stash push：pathspec 必须用正斜杠。在 Windows 上若把路径换成反斜杠，Git 可能解析成错误 pathspec（报错里出现 :(prefix:0)…）。
 * 仅暂存（--staged）且带 path 仍失败时，回退为「整段暂存区」一次贮藏（与常见 GUI 行为一致）。
 */
async function gitRawStashPush(
  g: SimpleGit,
  opts?: { message?: string; includeUntracked?: boolean; stagedOnly?: boolean; paths?: string[] }
): Promise<void> {
  const rels = (opts?.paths ?? [])
    .map((p) => normalizeRepoRelative(String(p)))
    .filter((p): p is string => !!p)
    .map((p) => j(p))

  const build = (withPathspecs: boolean): string[] => {
    const args = ['stash', 'push']
    if (opts?.stagedOnly) args.push('--staged')
    if (opts?.includeUntracked) args.push('-u')
    const msg = opts?.message?.trim()
    if (msg) {
      args.push('-m', msg)
    } else if (!opts?.includeUntracked && !(opts?.paths && opts.paths.length)) {
      args.push('-m', 'WIP')
    }
    if (withPathspecs && rels.length) {
      args.push('--')
      args.push(...rels)
    }
    return args
  }

  try {
    await g.raw(build(true))
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    const retry =
      Boolean(opts?.stagedOnly) &&
      rels.length > 0 &&
      /did not match any file/i.test(errMsg) &&
      (/pathspec/i.test(errMsg) || /known to git/i.test(errMsg))
    if (retry) {
      await g.raw(build(false))
      return
    }
    throw e
  }
}

function sanitizeTerminalCommand(command: string): string | null {
  const s = String(command ?? '').trim()
  if (!s || s.length > 800) return null
  if (/[\n\r\x00]/.test(s)) return null
  return s
}

/**
 * 使用用户在设置中指定的终端可执行文件打开目录。
 * 支持：Git Bash、Windows Terminal、PowerShell / pwsh；其它 exe 则以 cwd 启动（不注入命令）。
 */
function openCustomShellDirectory(
  root: string,
  shellExe: string
): { ok: true } | { error: string } {
  const exe = String(shellExe ?? '').trim()
  if (!exe || !fs.existsSync(exe)) return { error: '自定义终端路径无效或文件不存在' }
  const base = path.basename(exe).toLowerCase()
  try {
    if (process.platform === 'win32') {
      if (base === 'git-bash.exe') {
        const child = spawn(exe, [`--cd=${root}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'wt.exe') {
        const child = spawn(exe, ['-d', root], { detached: true, stdio: 'ignore', windowsHide: true })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'powershell.exe' || base === 'pwsh.exe') {
        const lit = root.replace(/'/g, "''")
        const child = spawn(exe, ['-NoExit', '-Command', `Set-Location -LiteralPath '${lit}'`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'cmd.exe') {
        const child = spawn(exe, ['/k', `cd /d "${root.replace(/"/g, '""')}"`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      const child = spawn(exe, [], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return { ok: true as const }
    }
    const child = spawn(exe, [], { cwd: root, detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function openCustomShellDirectoryWithCommand(
  root: string,
  shellExe: string,
  command: string
): { ok: true } | { error: string } {
  const cmd = sanitizeTerminalCommand(command)
  if (!cmd) return { error: '命令无效或过长' }
  const exe = String(shellExe ?? '').trim()
  if (!exe || !fs.existsSync(exe)) return { error: '自定义终端路径无效或文件不存在' }
  const base = path.basename(exe).toLowerCase()
  try {
    if (process.platform === 'win32') {
      if (base === 'git-bash.exe') {
        const inner = `${cmd}; exec bash`
        const child = spawn(exe, ['--cd=' + root, '-c', inner], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'wt.exe') {
        const ps = `Set-Location -LiteralPath ${JSON.stringify(root)}; ${cmd}`
        const child = spawn(exe, ['-d', root, 'powershell', '-NoExit', '-Command', ps], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'powershell.exe' || base === 'pwsh.exe') {
        const lit = root.replace(/'/g, "''")
        const child = spawn(exe, ['-NoExit', '-Command', `Set-Location -LiteralPath '${lit}'; ${cmd}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      if (base === 'cmd.exe') {
        const er = root.replace(/"/g, '""')
        const ec = cmd.replace(/"/g, '""')
        const child = spawn(exe, ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${er}" && ${ec}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          shell: false
        })
        child.unref()
        return { ok: true as const }
      }
    }
    return {
      error: '当前自定义终端类型无法在打开时自动执行命令，请改用 Git Bash、Windows Terminal、PowerShell 或 cmd'
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** 在终端中打开目录（与 shell:open-repo-git-terminal 共用） */
function openDirectoryInGitTerminal(
  dirRaw: string,
  customShell?: string | null
): { ok: true } | { error: string } {
  const root = path.resolve(dirRaw)
  if (!fs.existsSync(root)) return { error: '路径无效' }
  if (!isPathUnderRepo(root)) return { error: '路径不在当前仓库内' }
  const custom = String(customShell ?? '').trim()
  if (custom) {
    return openCustomShellDirectory(root, custom)
  }
  try {
    if (process.platform === 'win32') {
      const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
      const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
      const gitBashCandidates = [path.join(pf, 'Git', 'git-bash.exe'), path.join(pf86, 'Git', 'git-bash.exe')]
      for (const exe of gitBashCandidates) {
        if (fs.existsSync(exe)) {
          const child = spawn(exe, [`--cd=${root}`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
          child.unref()
          return { ok: true as const }
        }
      }
      const localAppData = process.env.LOCALAPPDATA ?? ''
      const wt = path.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe')
      if (fs.existsSync(wt)) {
        const child = spawn(wt, ['-d', root], { detached: true, stdio: 'ignore', windowsHide: true })
        child.unref()
        return { ok: true as const }
      }
      const child = spawn(
        'cmd.exe',
        ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${root}"`],
        { detached: true, stdio: 'ignore', windowsHide: true, shell: false }
      )
      child.unref()
      return { ok: true as const }
    }
    if (process.platform === 'darwin') {
      const escaped = root.replace(/\\/g, '/').replace(/'/g, `'\\''`)
      const script = `tell application "Terminal" to do script "cd '${escaped}'"`
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true as const }
    }
    const child = spawn('gnome-terminal', ['--working-directory', root], {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', () => {
      const fb = spawn('x-terminal-emulator', ['-e', `bash -lc 'cd "${root.replace(/"/g, '\\"')}" && exec bash'`], {
        detached: true,
        stdio: 'ignore'
      })
      fb.unref()
    })
    child.unref()
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** 在仓库目录打开终端并执行一条命令（命令结束后保留交互 shell，便于继续操作） */
function openDirectoryInGitTerminalWithCommand(
  dirRaw: string,
  command: string,
  customShell?: string | null
): { ok: true } | { error: string } {
  const cmd = sanitizeTerminalCommand(command)
  if (!cmd) return { error: '命令无效或过长' }
  const root = path.resolve(dirRaw)
  if (!fs.existsSync(root)) return { error: '路径无效' }
  if (!isPathUnderRepo(root)) return { error: '路径不在当前仓库内' }
  const custom = String(customShell ?? '').trim()
  if (custom) {
    const r = openCustomShellDirectoryWithCommand(root, custom, cmd)
    if ('ok' in r) return r
    if (!r.error.includes('无法在打开时自动执行')) return r
  }
  try {
    if (process.platform === 'win32') {
      const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
      const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
      const gitBashCandidates = [path.join(pf, 'Git', 'git-bash.exe'), path.join(pf86, 'Git', 'git-bash.exe')]
      for (const exe of gitBashCandidates) {
        if (fs.existsSync(exe)) {
          const inner = `${cmd}; exec bash`
          const child = spawn(exe, ['--cd=' + root, '-c', inner], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
          child.unref()
          return { ok: true as const }
        }
      }
      const localAppData = process.env.LOCALAPPDATA ?? ''
      const wt = path.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe')
      if (fs.existsSync(wt)) {
        const ps = `Set-Location -LiteralPath ${JSON.stringify(root)}; ${cmd}`
        const child = spawn(wt, ['-d', root, 'powershell', '-NoExit', '-Command', ps], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.unref()
        return { ok: true as const }
      }
      const escapedRoot = root.replace(/"/g, '""')
      const escapedCmd = cmd.replace(/"/g, '""')
      const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${escapedRoot}" && ${escapedCmd}`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false
      })
      child.unref()
      return { ok: true as const }
    }
    if (process.platform === 'darwin') {
      const escaped = root.replace(/\\/g, '/').replace(/'/g, `'\\''`)
      const c = cmd.replace(/'/g, `'\\''`)
      const script = `tell application "Terminal" to do script "cd '${escaped}' && ${c} && exec bash -l"`
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' })
      child.unref()
      return { ok: true as const }
    }
    const child = spawn('gnome-terminal', ['--working-directory', root, '--', 'bash', '-lc', `${cmd}; exec bash`], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function gitHashObjectWrite(content: string): Promise<{ hash: string } | { error: string }> {
  const root = repoRoot
  if (!root) return Promise.resolve({ error: '未打开仓库' })
  return new Promise((resolve) => {
    const child: ChildProcess = spawn('git', ['hash-object', '-w', '--stdin'], {
      cwd: root,
      windowsHide: true,
      stdio: 'pipe'
    })
    let out = ''
    let errBuf = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString()
    })
    child.on('error', (e: Error) => resolve({ error: e.message }))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ hash: out.trim() })
      else resolve({ error: errBuf.trim() || `git hash-object 退出 ${code}` })
    })
    child.stdin?.write(content, 'utf8')
    child.stdin?.end()
  })
}

async function gitShowBlob(spec: string): Promise<string> {
  if (!git) return ''
  try {
    const t = await git.raw(['show', spec])
    return t.replace(/\r\n/g, '\n')
  } catch {
    return ''
  }
}

async function writeIndexCacheInfo(relNorm: string, content: string): Promise<{ ok: true } | { error: string }> {
  if (!git || !repoRoot) return { error: '未打开仓库' }
  const h = await gitHashObjectWrite(content)
  if ('error' in h) return h
  let mode = '100644'
  try {
    const ls = await git.raw(['ls-files', '-s', '--', relNorm])
    const line = ls.trim().split('\n')[0]
    if (line) {
      const parts = line.split(/\s+/)
      if (parts[0]) mode = parts[0]
    }
  } catch {
    /* 新文件 */
  }
  try {
    let needAdd = false
    try {
      const ls = await git.raw(['ls-files', '-s', '--', relNorm])
      needAdd = !ls.trim()
    } catch {
      needAdd = true
    }
    const arg = `${mode},${h.hash},${relNorm}`
    if (needAdd) await git.raw(['update-index', '--add', '--cacheinfo', arg])
    else await git.raw(['update-index', '--cacheinfo', arg])
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function gitHashObjectWriteCwd(cwdAbs: string, content: string): Promise<{ hash: string } | { error: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn('git', ['hash-object', '-w', '--stdin'], {
      cwd: cwdAbs,
      windowsHide: true,
      stdio: 'pipe'
    })
    let out = ''
    let errBuf = ''
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString()
    })
    child.on('error', (e: Error) => resolve({ error: e.message }))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ hash: out.trim() })
      else resolve({ error: errBuf.trim() || `git hash-object 退出 ${code}` })
    })
    child.stdin?.write(content, 'utf8')
    child.stdin?.end()
  })
}

async function gitShowBlobSimpleGit(g: SimpleGit, spec: string): Promise<string> {
  try {
    return (await g.raw(['show', spec])).replace(/\r\n/g, '\n')
  } catch {
    return ''
  }
}

async function writeIndexCacheInfoSimpleGit(
  g: SimpleGit,
  cwdAbs: string,
  relNorm: string,
  content: string
): Promise<{ ok: true } | { error: string }> {
  const h = await gitHashObjectWriteCwd(cwdAbs, content)
  if ('error' in h) return h
  let mode = '100644'
  try {
    const ls = await g.raw(['ls-files', '-s', '--', relNorm])
    const line = ls.trim().split('\n')[0]
    if (line) {
      const parts = line.split(/\s+/)
      if (parts[0]) mode = parts[0]
    }
  } catch {
    /* 新文件 */
  }
  try {
    let needAdd = false
    try {
      const ls = await g.raw(['ls-files', '-s', '--', relNorm])
      needAdd = !ls.trim()
    } catch {
      needAdd = true
    }
    const arg = `${mode},${h.hash},${relNorm}`
    if (needAdd) await g.raw(['update-index', '--add', '--cacheinfo', arg])
    else await g.raw(['update-index', '--cacheinfo', arg])
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function validateAtRepoRelPath(repoRootAbs: string, relRaw: string): { norm: string } | { error: string } {
  const norm = j(String(relRaw ?? '')).replace(/^\/+/, '')
  if (!norm) return { error: '路径无效' }
  if (norm.split('/').some((seg) => seg === '..')) return { error: '非法路径' }
  const full = path.resolve(repoRootAbs, norm.split('/').join(path.sep))
  const rootSep = repoRootAbs.endsWith(path.sep) ? repoRootAbs : repoRootAbs + path.sep
  if (full !== repoRootAbs && !full.startsWith(rootSep)) return { error: '非法路径' }
  return { norm }
}

function applyPatchStdinCwd(
  cwdAbs: string,
  patchText: string,
  opts: {
    cached: boolean
    reverse: boolean
    ignoreSpaceChange?: boolean
    recount?: boolean
    ignoreWhitespace?: boolean
  }
): Promise<{ ok: true } | { error: string }> {
  return new Promise((resolve) => {
    const args: string[] = ['apply']
    if (opts.ignoreWhitespace) args.push('--ignore-whitespace')
    else if (opts.ignoreSpaceChange) args.push('--ignore-space-change')
    if (opts.recount) args.push('--recount')
    if (opts.cached) args.push('--cached')
    if (opts.reverse) args.push('-R')
    args.push('-')
    const child: ChildProcess = spawn('git', args, {
      cwd: cwdAbs,
      windowsHide: true,
      stdio: 'pipe'
    })
    let errBuf = ''
    child.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString()
    })
    child.on('error', (e: Error) => resolve({ error: e.message }))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ ok: true as const })
      else resolve({ error: errBuf.trim() || `git apply 退出 ${code}` })
    })
    child.stdin?.write(patchText, 'utf8')
    child.stdin?.end()
  })
}

function applyPatchStdin(
  patchText: string,
  opts: {
    cached: boolean
    reverse: boolean
    /** `-b` — 与 Fork 类似，缓解上下文空白差异导致的 “patch does not apply” */
    ignoreSpaceChange?: boolean
    /** 不信任 hunk 头行计数，按补丁内容重算（部分行级补丁更易套上） */
    recount?: boolean
    ignoreWhitespace?: boolean
  }
): Promise<{ ok: true } | { error: string }> {
  const root = repoRoot
  if (!root) return Promise.resolve({ error: '未打开仓库' })
  return new Promise((resolve) => {
    const args: string[] = ['apply']
    if (opts.ignoreWhitespace) args.push('--ignore-whitespace')
    else if (opts.ignoreSpaceChange) args.push('--ignore-space-change')
    if (opts.recount) args.push('--recount')
    if (opts.cached) args.push('--cached')
    if (opts.reverse) args.push('-R')
    args.push('-')
    const child: ChildProcess = spawn('git', args, {
      cwd: root,
      windowsHide: true,
      stdio: 'pipe'
    })
    let errBuf = ''
    child.stderr?.on('data', (d: Buffer) => {
      errBuf += d.toString()
    })
    child.on('error', (e: Error) => resolve({ error: e.message }))
    child.on('close', (code: number | null) => {
      if (code === 0) resolve({ ok: true as const })
      else resolve({ error: errBuf.trim() || `git apply 退出 ${code}` })
    })
    child.stdin?.write(patchText, 'utf8')
    child.stdin?.end()
  })
}

function isLikelyBinaryDiff(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  const low = t.toLowerCase()
  if (low.includes('binary files') || low.includes('git binary patch')) return false
  return !/^@@/m.test(t)
}

async function getMergeParents(rev: string): Promise<string[]> {
  if (!git) return []
  try {
    const out = (await git.raw(['rev-parse', `${rev}^@`])).trim()
    return out ? out.split(/\s+/).filter(Boolean) : []
  } catch {
    return []
  }
}

async function getMergeParentsForGit(g: SimpleGit, rev: string): Promise<string[]> {
  try {
    const out = (await g.raw(['rev-parse', `${rev}^@`])).trim()
    return out ? out.split(/\s+/).filter(Boolean) : []
  } catch {
    return []
  }
}

/** 解析 `git show` / `git diff-tree` 的 `--name-status` 行（含重命名三列） */
function parseNameStatusLines(show: string): { status: string; path: string }[] {
  const files: { status: string; path: string }[] = []
  for (const line of show.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t').filter(Boolean)
    if (parts.length < 2) continue
    const status = parts[0].trim()
    const pathSpec = parts.length > 2 ? `${parts[1]} → ${parts[2]}` : parts[1]
    files.push({ status, path: pathSpec })
  }
  return files
}

function fakeDiffForNewFile(filePath: string, content: string): string {
  const lines = content.length === 0 ? [] : content.split('\n')
  const n = lines.length
  const header = `diff --git a/${filePath} b/${filePath}
--- /dev/null
+++ b/${filePath}
`
  if (n === 0) return `${header}@@ -0,0 +0,0 @@
`
  const body = lines.map((l) => '+' + l).join('\n')
  return `${header}@@ -0,0 +1,${n} @@
${body}
`
}

type DiffOpts = {
  contextLines?: number
  ignoreBlankLines?: boolean
  ignoreWhitespace?: boolean
  showFullFile?: boolean
}

function diffArgs(opts?: DiffOpts): string[] {
  const args: string[] = []
  const ctx =
    opts?.showFullFile === true
      ? 999999
      : typeof opts?.contextLines === 'number'
        ? opts.contextLines
        : undefined
  if (typeof ctx === 'number' && Number.isFinite(ctx) && ctx >= 0) {
    args.push(`--unified=${Math.floor(ctx)}`)
  }
  if (opts?.ignoreBlankLines) args.push('--ignore-blank-lines')
  if (opts?.ignoreWhitespace) args.push('-w')
  return args
}

type OngoingOp = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

function resolveGitCommonDir(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, '.git')
  if (!fs.existsSync(dotGit)) return null
  try {
    const st = fs.statSync(dotGit)
    if (st.isDirectory()) return dotGit
    const raw = fs.readFileSync(dotGit, 'utf8').trim()
    const m = raw.match(/^gitdir:\s*(.+)$/i)
    if (!m) return null
    const rel = m[1]!.trim()
    return path.isAbsolute(rel) ? path.normalize(rel) : path.normalize(path.resolve(repoRoot, rel))
  } catch {
    return null
  }
}

function detectOngoingOperation(gitCommonDir: string): OngoingOp | null {
  if (
    fs.existsSync(path.join(gitCommonDir, 'rebase-merge')) ||
    fs.existsSync(path.join(gitCommonDir, 'rebase-apply'))
  ) {
    return 'rebase'
  }
  if (fs.existsSync(path.join(gitCommonDir, 'MERGE_HEAD'))) return 'merge'
  if (fs.existsSync(path.join(gitCommonDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (fs.existsSync(path.join(gitCommonDir, 'REVERT_HEAD'))) return 'revert'
  return null
}

function mapStatus(s: StatusResult, gitCommonDir: string | null) {
  const ongoing = gitCommonDir ? detectOngoingOperation(gitCommonDir) : null
  const bisectActive =
    !!gitCommonDir && fs.existsSync(path.join(gitCommonDir, 'BISECT_LOG'))
  return {
    not_added: s.not_added.map(j),
    conflicted: s.conflicted.map(j),
    created: s.created.map(j),
    deleted: s.deleted.map(j),
    modified: s.modified.map(j),
    renamed: s.renamed.map((r) => ({ from: j(r.from), to: j(r.to) })),
    staged: s.staged.map(j),
    ahead: s.ahead ?? 0,
    behind: s.behind ?? 0,
    current: s.current ?? '',
    tracking: s.tracking ?? null,
    detached: s.detached,
    isClean: s.isClean(),
    ongoingOperation: ongoing,
    bisectActive,
    files: s.files.map((f) => ({
      path: j(f.path),
      index: f.index,
      working_dir: f.working_dir
    }))
  }
}

function setRepo(p: string): { ok: true } | { ok: false; error: string } {
  const resolved = path.resolve(p)
  if (!fs.existsSync(resolved)) return { ok: false, error: '路径不存在' }
  if (!fs.existsSync(path.join(resolved, '.git'))) {
    return { ok: false, error: '不是 Git 仓库（缺少 .git）' }
  }
  repoRoot = resolved
  git = simpleGit({ baseDir: repoRoot, config: ['core.quotepath=false'] })
  return { ok: true }
}

function clearRepo(): void {
  repoRoot = null
  git = null
}

function getRoot(): string | null {
  return repoRoot
}

/** 字段分隔（勿用 \\x00：在 Windows 上易被管道/字符串处理吃掉，导致解析不到任何提交） */
const GIT_LOG_FS = '\x1f'

/** `git submodule foreach --recursive` 白名单（argv 片段，不经 shell） */
const SUBMODULE_FOREACH_PRESETS: Record<string, string[]> = {
  fetch: ['submodule', 'foreach', '--recursive', 'git', 'fetch'],
  pull: ['submodule', 'foreach', '--recursive', 'git', 'pull'],
  pullRebase: ['submodule', 'foreach', '--recursive', 'git', 'pull', '--rebase'],
  status: ['submodule', 'foreach', '--recursive', 'git', 'status', '-sb']
}

function shortRefName(r: string): string {
  const t = r.trim()
  if (t.startsWith('refs/tags/')) return t.slice('refs/tags/'.length)
  if (t.startsWith('refs/heads/')) return t.slice('refs/heads/'.length)
  const m = t.match(/^refs\/remotes\/([^/]+)\/(.+)$/)
  if (m) return `${m[1]}/${m[2]}`
  return t
}

/** 解析 `git log --decorate=full` 的 %D，得到 @gitgraph/js 所需的 refs（含 `tag: …`） */
function parseRefsFromDecoration(d: string): string[] {
  const s = d.replace(/^\(|\)$/g, '').trim()
  if (!s) return []
  const out: string[] = []
  for (const part of s.split(', ')) {
    let t = part.trim()
    if (!t) continue
    const headM = t.match(/^HEAD\s*->\s*(.+)$/i)
    if (headM) t = headM[1]!.trim()
    const tagM = t.match(/^tag:\s*(.+)$/i)
    if (tagM) {
      out.push(`tag: ${shortRefName(tagM[1]!.trim())}`)
      continue
    }
    out.push(shortRefName(t))
  }
  return [...new Set(out)].filter(Boolean)
}

/**
 * Fork 等客户端在同一提交有多条 ref 时，常把远程跟踪分支（如 origin/foo）排在本地分支名之前，
 * 再按名称排序；标签排在最后。
 */
function sortRefsForkLike(refs: string[], remoteNames: Set<string>): string[] {
  function bucket(ref: string): number {
    if (ref.startsWith('tag: ')) return 2
    const slash = ref.indexOf('/')
    if (slash > 0) {
      const remote = ref.slice(0, slash)
      if (remoteNames.has(remote)) return 0
    }
    return 1
  }
  return [...refs].sort((a, b) => {
    const ba = bucket(a)
    const bb = bucket(b)
    if (ba !== bb) return ba - bb
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

/** 与 `git:log` / `git:log-search` / `git-at:log` 共用解析（`--pretty=format:` 含 GIT_LOG_FS） */
async function getParsedGitLogWithGit(
  gitInst: SimpleGit,
  options: {
    maxCount?: number
    searchArgs?: string[]
  }
): Promise<
  | {
      entries: {
        hash: string
        date: string
        message: string
        author_name: string
        branches: string
      }[]
      gitgraph: {
        hash: string
        parents: string[]
        subject: string
        author: { name: string; email: string }
        date?: string
        refs: string[]
      }[]
    }
  | { error: string }
> {
  const fmt = `%H${GIT_LOG_FS}%P${GIT_LOG_FS}%s${GIT_LOG_FS}%an${GIT_LOG_FS}%ae${GIT_LOG_FS}%ai${GIT_LOG_FS}%D${GIT_LOG_FS}`
  try {
    const remotesRes = await gitInst.getRemotes()
    const remoteNames = new Set(remotesRes.map((r) => r.name))
    const logArgs = ['log', '--all', '--decorate=full']
    if (options.searchArgs?.length) logArgs.push(...options.searchArgs)
    try {
      const stashListRaw = await gitInst.raw(['stash', 'list'])
      const seen = new Set<string>()
      for (const line of stashListRaw.split('\n')) {
        const m = line.match(/^stash@\{(\d+)\}:/)
        if (!m) continue
        const ref = `stash@{${m[1]}}`
        if (seen.has(ref)) continue
        seen.add(ref)
        logArgs.push(ref)
      }
    } catch {
      /* 无贮藏或仓库异常时忽略 */
    }
    if (typeof options.maxCount === 'number' && options.maxCount > 0) {
      logArgs.push('-n', String(Math.floor(options.maxCount)))
    }
    logArgs.push(`--pretty=format:${fmt}`, '--date=iso-strict')
    const raw = (await gitInst.raw(logArgs)).trimEnd()
    const lines = raw ? raw.split(/\r?\n/) : []
    type ParsedRow = {
      hash: string
      parents: string[]
      subject: string
      author_name: string
      author_email: string
      date: string
      decoration: string
    }
    const rows: ParsedRow[] = []
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '')
      if (!trimmed) continue
      const parts = trimmed.split(GIT_LOG_FS)
      const hash = parts[0]?.trim()
      if (!hash || !/^[0-9a-f]{40}$/i.test(hash)) continue
      const parentStr = parts[1]?.trim() ?? ''
      const parents = parentStr ? parentStr.split(/\s+/).filter(Boolean) : []
      rows.push({
        hash,
        parents,
        subject: parts[2] ?? '',
        author_name: parts[3] ?? '',
        author_email: parts[4] ?? '',
        date: parts[5] ?? '',
        decoration: parts[6]?.trim() ?? ''
      })
    }
    const gitgraph = rows.map((r) => ({
      hash: r.hash,
      parents: r.parents,
      subject: r.subject,
      author: { name: r.author_name, email: r.author_email },
      date: r.date,
      refs: sortRefsForkLike(parseRefsFromDecoration(r.decoration), remoteNames)
    }))
    const entries = rows.map((r) => ({
      hash: r.hash,
      date: r.date,
      message: r.subject,
      author_name: r.author_name,
      branches: ''
    }))
    return { entries, gitgraph }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function getParsedGitLog(options: {
  maxCount?: number
  searchArgs?: string[]
}): Promise<
  | {
      entries: {
        hash: string
        date: string
        message: string
        author_name: string
        branches: string
      }[]
      gitgraph: {
        hash: string
        parents: string[]
        subject: string
        author: { name: string; email: string }
        date?: string
        refs: string[]
      }[]
    }
  | { error: string }
> {
  if (!git) return { error: '未打开仓库' }
  return getParsedGitLogWithGit(git, options)
}

function isGitWorkTreeDir(abs: string): boolean {
  try {
    return fs.existsSync(path.join(abs, '.git'))
  } catch {
    return false
  }
}

async function scanGitChildDirs(rootDir: string, maxDepth: number): Promise<string[]> {
  const root = path.resolve(rootDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return []
  const out: string[] = []
  if (isGitWorkTreeDir(root)) out.push(root)
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const full = path.join(dir, e.name)
      if (!e.isDirectory()) continue
      if (isGitWorkTreeDir(full)) {
        out.push(full)
        continue
      }
      await walk(full, depth + 1)
    }
  }
  await walk(root, 0)
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function createWindow(): void {
  const icon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'GitForkLike',
    ...(icon ? { icon } : {}),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#ececec'
  })
  const viteUrl = process.env.VITE_DEV_SERVER_URL
  if (viteUrl) {
    mainWindow.loadURL(viteUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(process.env.DIST ?? '', 'index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  function browserWindowFromSender(sender: Electron.WebContents): BrowserWindow | null {
    return BrowserWindow.fromWebContents(sender) ?? null
  }

  ipcMain.handle('window:minimize', (e) => {
    browserWindowFromSender(e.sender)?.minimize()
  })
  ipcMain.handle('window:maximize', (e) => {
    const w = browserWindowFromSender(e.sender)
    if (!w) return
    const isGitMm = w === gitMmWindow
    if (w.isMaximized()) {
      if (isGitMm) gitMmUserWantsMaximized = false
      w.unmaximize()
    } else {
      if (isGitMm) gitMmUserWantsMaximized = true
      w.maximize()
    }
  })
  ipcMain.handle('window:close', (e) => {
    browserWindowFromSender(e.sender)?.close()
  })

  function createGitMmWindow(): void {
    if (gitMmWindow && !gitMmWindow.isDestroyed()) {
      gitMmWindow.show()
      gitMmWindow.focus()
      return
    }
    const mmIcon = resolveAppIconPath()
    gitMmWindow = new BrowserWindow({
      width: 1220,
      height: 780,
      minWidth: 880,
      minHeight: 520,
      title: 'Git MM (Beta)',
      ...(mmIcon ? { icon: mmIcon } : {}),
      frame: false,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'index.mjs'),
        contextIsolation: true,
        nodeIntegration: false
      },
      backgroundColor: '#1d1e1f'
    })
    const viteUrl = process.env.VITE_DEV_SERVER_URL
    if (viteUrl) {
      void gitMmWindow.loadURL(`${viteUrl}#git-mm`)
    } else {
      const indexHtml = path.join(process.env.DIST ?? '', 'index.html')
      void gitMmWindow.loadURL(`${pathToFileURL(indexHtml).href}#git-mm`)
    }
    gitMmUserWantsMaximized = false
    gitMmRestoreMaximizedAfterMinimize = false

    gitMmWindow.on('maximize', () => {
      gitMmUserWantsMaximized = true
    })

    gitMmWindow.on('minimize', () => {
      if (!gitMmWindow || gitMmWindow.isDestroyed()) return
      gitMmRestoreMaximizedAfterMinimize =
        gitMmWindow.isMaximized() || gitMmUserWantsMaximized
    })

    gitMmWindow.on('restore', () => {
      if (!gitMmRestoreMaximizedAfterMinimize) return
      gitMmRestoreMaximizedAfterMinimize = false
      queueMicrotask(() => {
        if (!gitMmWindow || gitMmWindow.isDestroyed()) return
        if (!gitMmWindow.isMaximized()) {
          gitMmWindow.maximize()
        }
      })
    })

    gitMmWindow.on('closed', () => {
      gitMmUserWantsMaximized = false
      gitMmRestoreMaximizedAfterMinimize = false
      gitMmWindow = null
    })
  }

  ipcMain.handle('window:open-git-mm', () => {
    createGitMmWindow()
    return { ok: true as const }
  })

  /** Git MM 子仓面板：切主进程仓库、聚焦主窗口并通知主界面同步标签 */
  ipcMain.handle('window:focus-main-with-repo', async (_e, pRaw: unknown) => {
    const raw = String(pRaw ?? '').trim()
    if (!raw) return { ok: false as const, error: 'empty' }
    const resolved = path.resolve(raw)
    const r = setRepo(resolved)
    if (!r.ok) return r
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('workspace:external-set-repo', resolved)
    }
    return { ok: true as const }
  })

  ipcMain.handle('shell:open-absolute-path', async (_e, absRaw: unknown) => {
    const p = path.resolve(String(absRaw ?? '').trim())
    if (!p || !fs.existsSync(p)) return { error: '路径无效' }
    try {
      const err = await shell.openPath(p)
      if (err) return { error: err }
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git-mm:exec',
    async (_e, payload: { cwd: string; args: string[] }) => {
      const cwd = path.resolve(String(payload?.cwd ?? '').trim())
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { error: '工作目录无效' }
      const args = Array.isArray(payload?.args) ? payload.args.map((a) => String(a)) : []
      if (!args.length || args.length > 48) return { error: '参数无效' }
      for (const a of args) {
        if (a.length > 4000 || /[\n\r\x00]/.test(a)) return { error: '非法参数' }
      }
      return new Promise<
        { code: number; stdout: string; stderr: string } | { error: string }
      >((resolve) => {
        try {
          const proc = spawn('git', ['mm', ...args], {
            cwd,
            shell: false,
            windowsHide: true,
            // 避免 Git 在隐藏子进程里卡住等终端输入（凭据/确认），表现为 sync「一直没反应」
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
          })
          let stdout = ''
          let stderr = ''
          const killTimer = setTimeout(() => {
            try {
              proc.kill('SIGTERM')
            } catch {
              /* ignore */
            }
          }, 900_000)
          proc.stdout?.on('data', (d: Buffer) => {
            stdout += d.toString('utf8')
            if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000)
          })
          proc.stderr?.on('data', (d: Buffer) => {
            stderr += d.toString('utf8')
            if (stderr.length > 800_000) stderr = stderr.slice(-800_000)
          })
          proc.on('error', (err) => {
            clearTimeout(killTimer)
            resolve({ error: err.message })
          })
          proc.on('close', (code) => {
            clearTimeout(killTimer)
            resolve({ code: code ?? 0, stdout, stderr })
          })
        } catch (e) {
          resolve({ error: e instanceof Error ? e.message : String(e) })
        }
      })
    }
  )

  ipcMain.handle(
    'git-mm:exec-interactive',
    async (event, payload: { cwd: string; args: string[] }) => {
      const cwd = path.resolve(String(payload?.cwd ?? '').trim())
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { error: '工作目录无效' }
      const args = Array.isArray(payload?.args) ? payload.args.map((a) => String(a)) : []
      if (!args.length || args.length > 48) return { error: '参数无效' }
      for (const a of args) {
        if (a.length > 4000 || /[\n\r\x00]/.test(a)) return { error: '非法参数' }
      }
      return new Promise<{ code: number; stdout: string; stderr: string } | { error: string }>(
        (resolve) => {
          let proc: ChildProcess
          try {
            proc = spawn('git', ['mm', ...args], {
              cwd,
              shell: false,
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: { ...process.env }
            })
          } catch (e) {
            resolve({ error: e instanceof Error ? e.message : String(e) })
            return
          }
          let stdout = ''
          let stderr = ''
          let awaitingPrompt = false
          let skipPromptUntilCombinedLen = 0

          const getCombined = () => `${stderr}\n${stdout}`

          const killTimer = setTimeout(() => {
            try {
              proc.kill('SIGTERM')
            } catch {
              /* ignore */
            }
          }, 900_000)

          const emitPromptIfNeeded = () => {
            if (awaitingPrompt) return
            const combined = getCombined()
            const newPart = combined.slice(skipPromptUntilCombinedLen)
            if (!newPart.length) return
            const win = newPart.length > 1200 ? newPart.slice(-1200) : newPart
            const hasBracket =
              /\[[\s]*[yY][\s]*\/[\s]*[nN][\s]*\]/.test(win) || /\([\s]*[yY][\s]*\/[\s]*[nN][\s]*\)/.test(win)
            if (!hasBracket) return

            awaitingPrompt = true
            const id = randomUUID()
            const promptText = combined.split('\n').slice(-8).join('\n').trim() || '[Y/n]'
            pendingGitMmPromptResolvers.set(id, (yn: string) => {
              try {
                if (proc.stdin && !proc.stdin.destroyed) {
                  proc.stdin.write(`${yn}\n`, 'utf8')
                }
              } catch {
                /* ignore */
              }
              skipPromptUntilCombinedLen = getCombined().length
              awaitingPrompt = false
            })
            try {
              event.sender.send('git-mm:prompt', { id, promptText })
            } catch {
              pendingGitMmPromptResolvers.delete(id)
              awaitingPrompt = false
              clearTimeout(killTimer)
              resolve({ error: '无法显示确认对话框' })
            }
          }

          proc.stdout?.setEncoding('utf8')
          proc.stderr?.setEncoding('utf8')
          proc.stdout?.on('data', (chunk: string | Buffer) => {
            const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
            stdout += s
            if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000)
            emitPromptIfNeeded()
          })
          proc.stderr?.on('data', (chunk: string | Buffer) => {
            const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
            stderr += s
            if (stderr.length > 800_000) stderr = stderr.slice(-800_000)
            emitPromptIfNeeded()
          })
          proc.on('error', (err) => {
            clearTimeout(killTimer)
            resolve({ error: err.message })
          })
          proc.on('close', (code) => {
            clearTimeout(killTimer)
            resolve({ code: code ?? 0, stdout, stderr })
          })
        }
      )
    }
  )

  ipcMain.handle('git-mm:list-subrepos', async (_e, rootRaw: unknown, maxDepth?: unknown) => {
    const root = path.resolve(String(rootRaw ?? '').trim())
    if (!fs.existsSync(root)) return { error: '路径无效' }
    const d = Math.min(6, Math.max(0, Math.floor(Number(maxDepth) || 4)))
    try {
      const paths = await scanGitChildDirs(root, d)
      return { paths }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  function simpleGitForAt(rootRaw: unknown): SimpleGit | { error: string } {
    const resolved = path.resolve(String(rootRaw ?? '').trim())
    if (!resolved || !fs.existsSync(resolved)) return { error: '路径无效' }
    if (!isGitWorkTreeDir(resolved)) return { error: '不是 Git 仓库' }
    return simpleGit({ baseDir: resolved, config: ['core.quotepath=false'] })
  }

  ipcMain.handle('git-at:status', async (_e, root: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      const s = await g.status()
      const gcd = resolveGitCommonDir(path.resolve(String(root)))
      return mapStatus(s, gcd)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:stage', async (_e, root: unknown, paths: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const arr = Array.isArray(paths) ? paths.map((p) => String(p)) : []
    if (!arr.length) return { error: '未选择路径' }
    try {
      await g.add(arr)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:unstage', async (_e, root: unknown, paths: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const arr = Array.isArray(paths) ? paths.map((p) => String(p)) : []
    if (!arr.length) return { error: '未选择路径' }
    try {
      await g.raw(['restore', '--staged', '--', ...arr.map((p) => j(p))])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:commit', async (_e, root: unknown, payload: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      const p = payload as { subject?: string; body?: string; amend?: boolean }
      const subject = String(p?.subject ?? '').trim()
      if (!subject) return { error: '提交说明不能为空' }
      const body = String(p?.body ?? '').trim()
      const args = ['commit']
      if (p?.amend) args.push('--amend')
      args.push('-m', subject)
      if (body) args.push('-m', body)
      await g.raw(args)
      const hash = (await g.raw(['rev-parse', 'HEAD'])).trim()
      return { ok: true as const, hash }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:branches', async (_e, root: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      const b = await g.branchLocal()
      return { current: b.current, all: b.all }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:checkout', async (_e, root: unknown, name: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const n = String(name ?? '').trim()
    if (!n) return { error: '分支名无效' }
    try {
      await g.checkout(n)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:fetch', async (_e, root: unknown, arg?: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      if (typeof arg === 'string' && arg.trim()) await g.fetch(arg.trim())
      else await g.fetch()
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:pull', async (_e, root: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      await g.raw(['pull'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:push', async (_e, root: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      await g.raw(['push'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:log', async (_e, root: unknown, maxCount?: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    return getParsedGitLogWithGit(g, {
      maxCount: typeof maxCount === 'number' ? maxCount : 5000
    })
  })

  ipcMain.handle('git-at:diff', async (_e, root: unknown, filePath: unknown, opts: DiffOpts) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const fp = String(filePath ?? '')
    try {
      if (!fp) return await g.raw(['diff', ...diffArgs(opts)])
      const st = await g.status()
      const norm = j(fp)
      const isNotAdded = st.not_added.some((p) => j(p) === norm)
      if (isNotAdded) {
        const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
        return await g.raw(['diff', '--no-index', ...diffArgs(opts), '--', nullPath, norm])
      }
      return await g.raw(['diff', ...diffArgs(opts), '--', norm])
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:diff-staged', async (_e, root: unknown, filePath: unknown, opts: DiffOpts) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const fp = String(filePath ?? '')
    try {
      if (!fp) return await g.raw(['diff', '--cached', ...diffArgs(opts)])
      return await g.raw(['diff', '--cached', ...diffArgs(opts), '--', j(fp)])
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git-at:partial-line-merge',
    async (
      _e,
      root: unknown,
      payload: {
        relPath: string
        diffText: string
        startLine: number
        endLine: number
        mode: 'stage' | 'unstage' | 'discard-unstaged'
      }
    ) => {
      const g = simpleGitForAt(root)
      if ('error' in g) return g
      const repoRootAbs = path.resolve(String(root ?? '').trim())
      const vr = validateAtRepoRelPath(repoRootAbs, String(payload?.relPath ?? ''))
      if ('error' in vr) return vr
      const relNorm = vr.norm
      const diffText = String(payload?.diffText ?? '')
      const startLine = Math.floor(Number(payload?.startLine ?? 0))
      const endLine = Math.floor(Number(payload?.endLine ?? 0))
      const mode = String(payload?.mode ?? '')
      if (!diffText.trim()) return { error: 'diff 为空' }
      if (diffText.length > 2_000_000) return { error: 'diff 过大' }
      if (!['stage', 'unstage', 'discard-unstaged'].includes(mode)) return { error: 'mode 无效' }

      let oldText = ''
      let deltaMode: 'applySelected' | 'applyUnselected'
      if (mode === 'stage') {
        oldText = await gitShowBlobSimpleGit(g, `:0:${relNorm}`)
        deltaMode = 'applySelected'
      } else if (mode === 'unstage') {
        oldText = await gitShowBlobSimpleGit(g, `HEAD:${relNorm}`)
        deltaMode = 'applyUnselected'
      } else {
        oldText = await gitShowBlobSimpleGit(g, `:0:${relNorm}`)
        deltaMode = 'applyUnselected'
      }

      const merged = mergePartialUsingUnifiedDiff(oldText, diffText, startLine, endLine, deltaMode)
      if (!merged) return { error: '无法根据选区合并' }

      if (mode === 'discard-unstaged') {
        const abs = path.join(repoRootAbs, relNorm.split('/').join(path.sep))
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true })
          fs.writeFileSync(abs, merged.text, 'utf8')
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
        return { ok: true as const, addedContextLines: merged.addedContextLines }
      }

      const w = await writeIndexCacheInfoSimpleGit(g, repoRootAbs, relNorm, merged.text)
      if ('error' in w) return w
      return { ok: true as const, addedContextLines: merged.addedContextLines }
    }
  )

  ipcMain.handle('git-at:apply-patch', async (_e, root: unknown, patchText: unknown, opts?: unknown) => {
    const cwd = path.resolve(String(root ?? '').trim())
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { error: '工作目录无效' }
    const p = String(patchText ?? '')
    if (p.length > 2_000_000) return { error: '补丁过大' }
    if (!p.trim()) return { error: '补丁为空' }
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            cached?: boolean
            reverse?: boolean
            ignoreSpaceChange?: boolean
            recount?: boolean
            ignoreWhitespace?: boolean
          })
        : {}
    return applyPatchStdinCwd(cwd, p, {
      cached: !!o.cached,
      reverse: !!o.reverse,
      ignoreSpaceChange: !!o.ignoreSpaceChange,
      recount: !!o.recount,
      ignoreWhitespace: !!o.ignoreWhitespace
    })
  })

  ipcMain.handle('git-at:working-file-meta', async (_e, root: unknown, relPath: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const repoRootAt = path.resolve(String(root))
    const norm = j(String(relPath ?? '')).replace(/^\/+/, '')
    if (!norm || norm.split('/').some((seg) => seg === '..')) return { error: '非法路径' }
    const full = path.resolve(repoRootAt, norm)
    if (!full.startsWith(repoRootAt + path.sep) && full !== repoRootAt) return { error: '非法路径' }
    try {
      const st = await fs.promises.stat(full)
      if (!st.isFile()) return { error: '不是文件' }
      return { size: st.size }
    } catch {
      return { error: '无法读取文件' }
    }
  })

  ipcMain.handle('git-at:commit-detail', async (_e, root: unknown, hash: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const h = String(hash ?? '').trim()
    if (!h) return { error: '提交无效' }
    try {
      const full = (await g.raw(['rev-parse', '--verify', h])).trim()
      const subject = (await g.raw(['log', '-1', '--format=%s', full])).trimEnd()
      const body = (await g.raw(['log', '-1', '--format=%b', full])).trimEnd()
      const authorName = (await g.raw(['log', '-1', '--format=%an', full])).trimEnd()
      const authorEmail = (await g.raw(['log', '-1', '--format=%ae', full])).trimEnd()
      const at = (await g.raw(['log', '-1', '--format=%at', full])).trim()
      const ts = parseInt(at, 10)
      const parents = (await g.raw(['log', '-1', '--format=%P', full])).trim().split(/\s+/).filter(Boolean)
      const dateFmt = new Date(Number.isNaN(ts) ? Date.now() : ts * 1000).toLocaleString('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
      let files: { status: string; path: string }[] = []
      try {
        if (parents.length === 0) {
          const dt = await g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', full])
          files = parseNameStatusLines(dt)
        } else {
          const dt = await g.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', parents[0], full])
          files = parseNameStatusLines(dt)
        }
      } catch {
        files = []
      }
      return {
        fullHash: full,
        subject,
        body,
        authorName,
        authorEmail,
        date: dateFmt,
        parents,
        files
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:commit-diff', async (_e, root: unknown, rev: unknown, opts: DiffOpts, filePath: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      const hash = (await g.raw(['rev-parse', '--verify', String(rev)])).trim()
      const args = diffArgs(opts)
      const layoutPath =
        filePath != null && String(filePath).trim() ? pathForCommitLayout(String(filePath).trim()) : ''
      const parents = await getMergeParentsForGit(g, hash)
      if (parents.length === 2) {
        const range = `${parents[0]}...${parents[1]}`
        const cmd = ['diff', '--no-color', ...args, range]
        if (layoutPath) cmd.push('--', layoutPath)
        return await g.raw(cmd)
      }
      const showCmd = ['show', '--no-color', '--pretty=format:', ...args, hash]
      if (layoutPath) showCmd.push('--', layoutPath)
      return await g.raw(showCmd)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:stash-list', async (_e, root: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    try {
      const raw = await g.raw(['stash', 'list'])
      const entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^stash@\{(\d+)\}:\s*(.*)$/)
          return {
            index: m ? parseInt(m[1], 10) : 0,
            label: m ? m[2].trim() : line
          }
        })
      return { entries }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git-at:stash-push',
    async (
      _e,
      root: unknown,
      opts?: { message?: string; includeUntracked?: boolean; stagedOnly?: boolean; paths?: string[] }
    ) => {
      const g = simpleGitForAt(root)
      if ('error' in g) return g
      try {
        await gitRawStashPush(g, opts)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git-at:stash-drop', async (_e, root: unknown, index: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await g.raw(['stash', 'drop', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:stash-apply', async (_e, root: unknown, index: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await g.raw(['stash', 'apply', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:stash-pop', async (_e, root: unknown, index: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await g.raw(['stash', 'pop', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:stash-show-patch', async (_e, root: unknown, index: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      const text = await g.raw(['stash', 'show', '-p', `stash@{${n}}`])
      return { text }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:restore-worktree', async (_e, root: unknown, paths: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const arr = Array.isArray(paths) ? paths.map((p) => String(p)) : []
    if (!arr.length) return { error: '路径为空' }
    try {
      await g.raw(['restore', '--worktree', '--', ...arr.map((p) => j(p))])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:checkout-ours', async (_e, root: unknown, relPath: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const rp = String(relPath ?? '').trim().replace(/\\/g, '/')
    if (!rp) return { error: '路径无效' }
    try {
      await g.raw(['checkout', '--ours', '--', j(rp)])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git-at:checkout-theirs', async (_e, root: unknown, relPath: unknown) => {
    const g = simpleGitForAt(root)
    if ('error' in g) return g
    const rp = String(relPath ?? '').trim().replace(/\\/g, '/')
    if (!rp) return { error: '路径无效' }
    try {
      await g.raw(['checkout', '--theirs', '--', j(rp)])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git-at:mergetool',
    async (_e, root: unknown, relPath?: unknown, opts?: unknown) => {
      const resolved = path.resolve(String(root ?? '').trim())
      if (!resolved || !fs.existsSync(resolved) || !isGitWorkTreeDir(resolved)) {
        return { error: '路径无效' }
      }
      const cwd = resolved
      const rp =
        relPath != null && String(relPath).trim()
          ? String(relPath)
              .trim()
              .replace(/\\/g, '/')
              .replace(/^\/+/, '')
          : null
      if (relPath != null && String(relPath).trim() && !rp) return { error: '路径无效' }
      const o = opts && typeof opts === 'object' ? (opts as { preset?: string; toolPath?: string }) : {}
      const preset = String(o.preset ?? 'default').trim() || 'default'
      const toolPath = String(o.toolPath ?? '').trim()
      const fileTail: string[] = []
      if (rp) {
        fileTail.push('--', rp.replace(/\//g, path.sep))
      }
      let gitArgs: string[]
      if (preset === 'default') {
        gitArgs = ['mergetool', '-y', ...fileTail]
      } else {
        const toolMap: Record<string, string> = { bc4: 'bc4', bc3: 'bc3', winmerge: 'winmerge' }
        const tool = toolMap[preset]
        if (!tool) {
          gitArgs = ['mergetool', '-y', ...fileTail]
        } else {
          const cfg: string[] = []
          if (toolPath) {
            const normalized = toolPath.replace(/\\/g, '/')
            cfg.push('-c', `mergetool.${tool}.path=${normalized}`)
          }
          cfg.push('-c', `mergetool.${tool}.trustExitCode=true`)
          gitArgs = [...cfg, 'mergetool', '-y', '-t', tool, ...fileTail]
        }
      }
      try {
        const r = await new Promise<{ ok: true } | { error: string }>((resolve) => {
          const child = spawn('git', gitArgs, {
            cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
          child.on('error', (err: Error) => resolve({ error: err.message }))
          child.on('spawn', () => {
            child.unref()
            resolve({ ok: true as const })
          })
        })
        return r
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('shell:open-repo-root', async () => {
    if (!repoRoot) return { error: '未打开仓库' }
    try {
      const err = await shell.openPath(repoRoot)
      if (err) return { error: err }
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 在终端中打开仓库目录（Windows 优先 Git Bash；其次 Windows Terminal / cmd；macOS 用 Terminal.app） */
  ipcMain.handle('shell:open-repo-git-terminal', async (_e, opts?: unknown) => {
    if (!repoRoot) return { error: '未打开仓库' }
    const shellPath =
      opts && typeof opts === 'object' && 'shellPath' in opts
        ? String((opts as { shellPath?: string }).shellPath ?? '').trim()
        : ''
    return openDirectoryInGitTerminal(path.resolve(repoRoot), shellPath || undefined)
  })

  ipcMain.handle('shell:open-repo-git-terminal-command', async (_e, command: unknown, opts?: unknown) => {
    if (!repoRoot) return { error: '未打开仓库' }
    const shellPath =
      opts && typeof opts === 'object' && 'shellPath' in opts
        ? String((opts as { shellPath?: string }).shellPath ?? '').trim()
        : ''
    return openDirectoryInGitTerminalWithCommand(
      path.resolve(repoRoot),
      String(command ?? ''),
      shellPath || undefined
    )
  })

  ipcMain.handle('shell:open-repo-relative-in-explorer', async (_e, relPath: string) => {
    if (!repoRoot) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(relPath)
    if (!rp) return { error: '非法路径' }
    const full = path.resolve(repoRoot, rp)
    if (!isPathUnderRepo(full)) return { error: '非法路径' }
    try {
      const err = await shell.openPath(full)
      if (err) return { error: err }
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('shell:open-repo-relative-in-git-terminal', async (_e, relPath: string, opts?: unknown) => {
    if (!repoRoot) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(relPath)
    if (!rp) return { error: '非法路径' }
    const full = path.resolve(repoRoot, rp)
    if (!isPathUnderRepo(full)) return { error: '非法路径' }
    const shellPath =
      opts && typeof opts === 'object' && 'shellPath' in opts
        ? String((opts as { shellPath?: string }).shellPath ?? '').trim()
        : ''
    return openDirectoryInGitTerminal(full, shellPath || undefined)
  })

  ipcMain.handle('shell:open-external', async (_e, url: unknown) => {
    const u = String(url ?? '').trim()
    if (!u || !/^https?:\/\//iu.test(u)) return { error: 'URL 无效' }
    try {
      await shell.openExternal(u)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('dialog:open-repo', async () => {
    const opts = { properties: ['openDirectory' as const] }
    const r =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  /** 选择父目录（克隆时保存新仓库的上一级路径） */
  ipcMain.handle('dialog:select-directory', async () => {
    const opts = { properties: ['openDirectory' as const] }
    const r =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  /** 选择可执行文件（终端、合并工具等） */
  ipcMain.handle('dialog:select-executable', async () => {
    const filters =
      process.platform === 'win32'
        ? [
            { name: 'Executable', extensions: ['exe', 'bat', 'cmd', 'ps1'] },
            { name: 'All files', extensions: ['*'] }
          ]
        : [{ name: 'All files', extensions: ['*'] }]
    const opts = { properties: ['openFile' as const], filters }
    const r =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle(
    'git:clone',
    async (_e, opts: { url: string; directory: string }) => {
      const url = String(opts?.url ?? '').trim()
      const directory = String(opts?.directory ?? '').trim()
      if (!url) return { error: '仓库地址不能为空' }
      if (!directory) return { error: '目标路径不能为空' }
      const resolved = path.resolve(directory)
      const parent = path.dirname(resolved)
      const base = path.basename(resolved)
      if (!base || base === '.' || base === '..') return { error: '目标文件夹名无效' }
      if (!fs.existsSync(parent)) return { error: '父目录不存在' }
      if (fs.existsSync(resolved)) {
        try {
          const st = fs.statSync(resolved)
          if (st.isDirectory()) {
            const inner = fs.readdirSync(resolved)
            if (inner.length > 0) return { error: '目标目录已存在且非空' }
          } else return { error: '目标路径已存在' }
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) }
        }
      }
      try {
        const g = simpleGit({ config: ['core.quotepath=false'] })
        await g.clone(url, resolved)
        return { path: resolved }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:set-repo', async (_e, p: string) => setRepo(p))
  ipcMain.handle('git:clear-repo', async () => {
    clearRepo()
    return { ok: true as const }
  })
  ipcMain.handle('git:get-root', async () => getRoot())

  ipcMain.handle('git:status', async () => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    try {
      const s = await git.status()
      const gcd = resolveGitCommonDir(repoRoot)
      return mapStatus(s, gcd)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:stage', async (_e, paths: string[]) => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.add(paths)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:unstage',
    async (_e, paths: string[], opts?: { amend?: boolean }) => {
      if (!git) return { error: '未打开仓库' }
      const arr = Array.isArray(paths) ? paths.map((p) => j(String(p))) : []
      if (!arr.length) return { error: '未选择路径' }
      try {
        if (!opts?.amend) {
          await git.raw(['restore', '--staged', '--', ...arr])
          return { ok: true as const }
        }
        /** 修订上次提交：与 HEAD 索引一致的路径用 `restore --staged` 无效，需回退到父提交树（与 Fork 等客户端一致） */
        const normal: string[] = []
        const fromParent: string[] = []
        for (const p of arr) {
          const diff = (await git.raw(['diff', '--cached', '--', p])).trim()
          if (!diff) fromParent.push(p)
          else normal.push(p)
        }
        if (normal.length) {
          await git.raw(['restore', '--staged', '--', ...normal])
        }
        if (fromParent.length) {
          let hasParent = false
          try {
            await git.raw(['rev-parse', '--verify', 'HEAD^'])
            hasParent = true
          } catch {
            hasParent = false
          }
          if (hasParent) {
            await git.raw(['restore', '--staged', '--source=HEAD^', '--', ...fromParent])
          } else {
            await git.raw(['rm', '--cached', '-f', '--', ...fromParent])
          }
        }
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'git:commit',
    async (
      _e,
      payload: string | { subject: string; body?: string; amend?: boolean }
    ) => {
      if (!git) return { error: '未打开仓库' }
      try {
        if (typeof payload === 'string') {
          const t = payload.trim()
          if (!t) return { error: '提交说明不能为空' }
          const r = await git.commit(t)
          return { ok: true as const, hash: r.commit }
        }
        const subject = payload.subject?.trim()
        if (!subject) return { error: '提交说明不能为空' }
        const body = payload.body?.trim()
        const args = ['commit']
        if (payload.amend) args.push('--amend')
        args.push('-m', subject)
        if (body) args.push('-m', body)
        await git.raw(args)
        const hash = (await git.raw(['rev-parse', 'HEAD'])).trim()
        return { ok: true as const, hash }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:working-file-meta', async (_e, relPath: string) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const norm = j(relPath).replace(/^\/+/, '')
    if (!norm || norm.split('/').some((seg) => seg === '..')) return { error: '非法路径' }
    const full = path.resolve(repoRoot, norm)
    const root = path.resolve(repoRoot)
    if (!full.startsWith(root + path.sep) && full !== root) return { error: '非法路径' }
    try {
      const st = await fs.promises.stat(full)
      if (!st.isFile()) return { error: '不是文件' }
      return { size: st.size }
    } catch {
      return { error: '无法读取文件' }
    }
  })

  ipcMain.handle('git:branches', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const b = await git.branchLocal()
      return { current: b.current, all: b.all }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:branch-set-upstream',
    async (_e, opts: { localBranch: string; upstreamRef: string }) => {
      if (!git) return { error: '未打开仓库' }
      const local = String(opts?.localBranch ?? '').trim()
      const upstream = String(opts?.upstreamRef ?? '').trim()
      if (!local || !upstream) return { error: '分支或上游引用无效' }
      if (local.includes('..') || upstream.includes('..')) return { error: '非法引用' }
      try {
        await git.raw(['branch', '--set-upstream-to=' + upstream, local])
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:local-branches-tracking', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = (
        await git.raw([
          'for-each-ref',
          '--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)',
          'refs/heads/'
        ])
      ).trim()
      const lines = raw ? raw.split('\n') : []
      const branches: { name: string; upstream: string | null; ahead: number; behind: number }[] = []
      for (const line of lines) {
        const parts = line.split('\t')
        const name = (parts[0] ?? '').trim()
        if (!name) continue
        const upstream = (parts[1] ?? '').trim() || null
        const track = (parts[2] ?? '').trim()
        let ahead = 0
        let behind = 0
        const am = track.match(/\bahead (\d+)\b/)
        const bm = track.match(/\bbehind (\d+)\b/)
        if (am) ahead = parseInt(am[1]!, 10)
        if (bm) behind = parseInt(bm[1]!, 10)
        branches.push({ name, upstream, ahead, behind })
      }
      return { branches }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:checkout', async (_e, name: string) => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.checkout(name)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:branch-rename', async (_e, from: string, to: string) => {
    if (!git) return { error: '未打开仓库' }
    const f = String(from).trim()
    const t = String(to).trim()
    if (!f || !t) return { error: '分支名无效' }
    if (f === t) return { ok: true as const }
    try {
      await git.raw(['branch', '-m', f, t])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:branch-delete', async (_e, name: string, force?: boolean) => {
    if (!git) return { error: '未打开仓库' }
    const n = String(name).trim()
    if (!n) return { error: '分支名无效' }
    try {
      await git.raw(['branch', force ? '-D' : '-d', n])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:branch-create',
    async (_e, opts: { name: string; startPoint?: string; checkoutAfter?: boolean }) => {
      if (!git) return { error: '未打开仓库' }
      const name = String(opts.name ?? '').trim()
      if (!name) return { error: '分支名不能为空' }
      const start = String(opts.startPoint ?? 'HEAD').trim() || 'HEAD'
      try {
        await git.raw(['branch', name, start])
        if (opts.checkoutAfter) await git.checkout(name)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:merge', async (_e, ref: string) => {
    if (!git) return { error: '未打开仓库' }
    const r = String(ref ?? '').trim()
    if (!r) return { error: '合并目标无效' }
    try {
      await git.merge([r])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 将当前分支变基到指定提交/分支（git rebase <upstream>） */
  ipcMain.handle('git:rebase', async (_e, ref: string) => {
    if (!git) return { error: '未打开仓库' }
    const r = String(ref ?? '').trim()
    if (!r) return { error: '变基目标无效' }
    try {
      await git.raw(['rebase', r])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:cherry-pick', async (_e, rev: string) => {
    if (!git) return { error: '未打开仓库' }
    const h = String(rev ?? '').trim()
    if (!h) return { error: '提交无效' }
    try {
      await git.raw(['cherry-pick', h])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:revert',
    async (_e, opts: { hash: string; mainline?: number }) => {
      if (!git) return { error: '未打开仓库' }
      const h = String(opts?.hash ?? '').trim()
      if (!h) return { error: '提交无效' }
      const m = opts?.mainline
      try {
        const args = ['revert', '--no-edit']
        if (typeof m === 'number' && Number.isFinite(m) && m >= 1) {
          args.push('-m', String(Math.floor(m)))
        }
        args.push(h)
        await git.raw(args)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'git:reset',
    async (_e, opts: { ref: string; mode: 'soft' | 'mixed' | 'hard' }) => {
      if (!git) return { error: '未打开仓库' }
      const r = String(opts?.ref ?? '').trim()
      if (!r) return { error: '目标提交无效' }
      const mode = opts?.mode
      if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
        return { error: 'reset 模式无效' }
      }
      const flag = mode === 'mixed' ? '--mixed' : `--${mode}`
      try {
        await git.raw(['reset', flag, r])
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:merge-continue', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['merge', '--continue'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:merge-abort', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['merge', '--abort'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rebase-continue', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['rebase', '--continue'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rebase-abort', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['rebase', '--abort'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rebase-skip', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['rebase', '--skip'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:cherry-pick-continue', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['cherry-pick', '--continue'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:cherry-pick-abort', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['cherry-pick', '--abort'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:revert-continue', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['revert', '--continue'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:revert-abort', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['revert', '--abort'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-add', async (_e, name: string, url: string) => {
    if (!git) return { error: '未打开仓库' }
    const n = String(name ?? '').trim()
    const u = String(url ?? '').trim()
    if (!n) return { error: '远程名称不能为空' }
    if (!u) return { error: '仓库 URL 不能为空' }
    try {
      await git.addRemote(n, u)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-test', async (_e, url: string) => {
    if (!git) return { error: '未打开仓库' }
    const u = String(url ?? '').trim()
    if (!u) return { error: 'URL 不能为空' }
    try {
      await git.raw(['ls-remote', '--heads', u])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-remove', async (_e, name: string) => {
    if (!git) return { error: '未打开仓库' }
    const n = String(name ?? '').trim()
    if (!n) return { error: '远程名称无效' }
    try {
      await git.raw(['remote', 'remove', n])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-rename', async (_e, from: string, to: string) => {
    if (!git) return { error: '未打开仓库' }
    const f = String(from ?? '').trim()
    const t = String(to ?? '').trim()
    if (!f || !t) return { error: '名称无效' }
    if (f === t) return { ok: true as const }
    try {
      await git.raw(['remote', 'rename', f, t])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-set-url', async (_e, name: string, url: string) => {
    if (!git) return { error: '未打开仓库' }
    const n = String(name ?? '').trim()
    const u = String(url ?? '').trim()
    if (!n || !u) return { error: '名称或 URL 无效' }
    try {
      await git.raw(['remote', 'set-url', n, u])
      try {
        await git.raw(['remote', 'set-url', '--push', n, u])
      } catch {
        /* 部分仓库未单独配置 push 时可能报错，与 addRemote 行为尽量一致 */
      }
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:tag-create',
    async (
      _e,
      opts: { name: string; message?: string; ref?: string; push?: boolean; remote?: string }
    ) => {
      if (!git) return { error: '未打开仓库' }
      const name = String(opts.name ?? '').trim()
      if (!name) return { error: '标签名不能为空' }
      const ref = String(opts.ref ?? 'HEAD').trim() || 'HEAD'
      const msg = String(opts.message ?? '').trim()
      const remote = String(opts.remote ?? 'origin').trim() || 'origin'
      try {
        if (msg) await git.raw(['tag', '-a', name, '-m', msg, ref])
        else await git.raw(['tag', name, ref])
        if (opts.push) await git.raw(['push', remote, `refs/tags/${name}`])
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  /** 删除本地标签；若传入 `remote` 则再执行 `git push <remote> --delete refs/tags/<name>` */
  ipcMain.handle(
    'git:tag-delete',
    async (_e, opts: { name: string; remote?: string }) => {
      if (!git) return { error: '未打开仓库' }
      const name = String(opts?.name ?? '').trim()
      if (!name) return { error: '标签名无效' }
      const remote = String(opts?.remote ?? '').trim()
      try {
        await git.raw(['tag', '-d', name])
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
      if (remote) {
        try {
          await git.raw(['push', remote, '--delete', `refs/tags/${name}`])
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return { error: `本地标签已删除，但远程删除失败：${msg}` }
        }
      }
      return { ok: true as const }
    }
  )

  ipcMain.handle(
    'git:submodule-add',
    async (_e, opts: { url: string; path: string; recursive?: boolean }) => {
      if (!git || !repoRoot) return { error: '未打开仓库' }
      const u = String(opts.url ?? '').trim()
      let rel = j(String(opts.path ?? '').trim()).replace(/^\/+/, '')
      if (!u) return { error: '仓库 URL 不能为空' }
      if (!rel) return { error: '路径不能为空' }
      if (rel.split('/').some((s) => s === '..')) return { error: '非法路径' }
      const full = path.resolve(repoRoot, rel.replace(/\//g, path.sep))
      const root = path.resolve(repoRoot)
      if (!full.startsWith(root + path.sep) && full !== root) return { error: '非法路径' }
      try {
        const args = ['submodule', 'add']
        if (opts.recursive) args.push('--recursive')
        args.push(u, rel)
        await git.raw(args)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:submodule-remove', async (_e, relPath: string) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(relPath)
    if (!rp) return { error: '非法路径' }
    const full = path.resolve(repoRoot, rp)
    if (!isPathUnderRepo(full)) return { error: '非法路径' }
    try {
      await git.raw(['submodule', 'deinit', '-f', '--', rp])
      await git.raw(['rm', '-f', '--', rp])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * 与 Fork「所有提交」更接近：默认按提交时间（committer）倒序，与 `git log --all` 一致；
   * 不使用 `--topo-order`，否则首条及多分支交错顺序会与 Fork 常见表现不一致。
   * `--all`：合并所有分支/refs 可达提交。不传 maxCount 或 ≤0 时不加 -n，输出全部提交。
   */
  ipcMain.handle('git:log', async (_e, maxCount?: number) => {
    return getParsedGitLog({
      maxCount: typeof maxCount === 'number' ? maxCount : undefined
    })
  })

  ipcMain.handle(
    'git:log-search',
    async (
      _e,
      opts: {
        grep?: string
        pickaxe?: string
        maxCount?: number
        regexp?: boolean
        allMatch?: boolean
        ignoreCase?: boolean
      }
    ) => {
      const grep = String(opts?.grep ?? '').trim()
      const pickaxe = String(opts?.pickaxe ?? '').trim()
      if (!grep && !pickaxe) return { error: '请填写提交说明搜索或变更内容（-S）' }
      const searchArgs: string[] = []
      if (grep) {
        searchArgs.push('--grep', grep)
        if (opts?.regexp) searchArgs.push('--extended-regexp')
        if (opts?.ignoreCase !== false) searchArgs.push('-i')
        if (opts?.allMatch) searchArgs.push('--all-match')
      }
      if (pickaxe) searchArgs.push('-S', pickaxe)
      const n = Math.min(500, Math.max(20, Math.floor(Number(opts?.maxCount) || 200)))
      return getParsedGitLog({ maxCount: n, searchArgs })
    }
  )

  ipcMain.handle('git:diff', async (_e, filePath: string, opts: DiffOpts) => {
    if (!git) return { error: '未打开仓库' }
    try {
      if (!filePath) return await git.raw(['diff', ...diffArgs(opts)])
      const st = await git.status()
      const norm = j(filePath)
      const isNotAdded = st.not_added.some((p) => j(p) === norm)
      if (isNotAdded) {
        const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
        return await git.raw(['diff', '--no-index', ...diffArgs(opts), '--', nullPath, norm])
      }
      return await git.raw(['diff', ...diffArgs(opts), '--', norm])
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:diff-staged', async (_e, filePath: string, opts: DiffOpts) => {
    if (!git) return { error: '未打开仓库' }
    try {
      if (!filePath) return await git.raw(['diff', '--cached', ...diffArgs(opts)])
      return await git.raw(['diff', '--cached', ...diffArgs(opts), '--', j(filePath)])
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remotes', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const remotes = await git.getRemotes()
      return { names: remotes.map((r) => r.name) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-list', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['remote', '-v'])
      const map = new Map<string, { fetch?: string; push?: string }>()
      for (const line of raw.split('\n')) {
        const s = line.trim()
        if (!s) continue
        const m = s.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/)
        if (!m) continue
        const name = m[1]
        const url = m[2]
        const kind = m[3]
        let o = map.get(name)
        if (!o) {
          o = {}
          map.set(name, o)
        }
        if (kind === 'fetch') o.fetch = url
        else o.push = url
      }
      return {
        remotes: [...map.entries()].map(([name, u]) => ({
          name,
          fetchUrl: u.fetch ?? '',
          pushUrl: u.push ?? ''
        }))
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:tags', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['tag', '-l'])
      const tags = raw
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      return { tags }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:stash-push',
    async (
      _e,
      opts?: { message?: string; includeUntracked?: boolean; stagedOnly?: boolean; paths?: string[] }
    ) => {
      if (!git) return { error: '未打开仓库' }
      try {
        await gitRawStashPush(git, opts)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:stash-drop', async (_e, index: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await git.raw(['stash', 'drop', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:stash-apply', async (_e, index: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await git.raw(['stash', 'apply', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:stash-pop', async (_e, index: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      await git.raw(['stash', 'pop', `stash@{${n}}`])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:stash-list', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['stash', 'list'])
      const entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^stash@\{(\d+)\}:\s*(.*)$/)
          return {
            index: m ? parseInt(m[1], 10) : 0,
            label: m ? m[2].trim() : line
          }
        })
      return { entries }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:stash-show-patch', async (_e, index: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const n = Math.floor(Number(index))
    if (!Number.isFinite(n) || n < 0) return { error: '贮藏索引无效' }
    try {
      const text = await git.raw(['stash', 'show', '-p', `stash@{${n}}`])
      return { text }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-default-branch', async (_e, remote: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const name = String(remote ?? '').trim() || 'origin'
    if (!/^[A-Za-z0-9._-]+$/u.test(name)) return { error: '远程名无效' }
    try {
      const sym = (await git.raw(['symbolic-ref', `refs/remotes/${name}/HEAD`])).trim()
      const prefix = `refs/remotes/${name}/`
      const branch = sym.startsWith(prefix) ? sym.slice(prefix.length).trim() : null
      return { branch }
    } catch {
      return { branch: null as string | null }
    }
  })

  ipcMain.handle('git:submodules', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['submodule', 'status', '--recursive'])
      const submodules: { sha: string; path: string; ref?: string }[] = []
      for (const line of raw.split('\n')) {
        const s = line.trim()
        if (!s) continue
        const m = s.match(/^(\S+)\s+(.+?)\s+\((.+)\)\s*$/)
        if (m) {
          submodules.push({ sha: m[1], path: m[2].trim(), ref: m[3] })
          continue
        }
        const sp = s.indexOf(' ')
        if (sp > 0) submodules.push({ sha: s.slice(0, sp), path: s.slice(sp + 1).trim() })
      }
      return { submodules }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:fetch',
    async (_e, arg?: string | { remote?: string; all?: boolean; prune?: boolean }) => {
      if (!git) return { error: '未打开仓库' }
      try {
        if (typeof arg === 'string') {
          if (arg) await git.fetch(arg)
          else await git.fetch()
        } else {
          const o = arg ?? {}
          const prune = !!o.prune
          if (o.all) {
            await git.raw(prune ? ['fetch', '--all', '--prune'] : ['fetch', '--all'])
          } else if (o.remote) {
            await git.raw(prune ? ['fetch', '--prune', o.remote] : ['fetch', o.remote])
          } else {
            await git.raw(prune ? ['fetch', '--prune'] : ['fetch'])
          }
        }
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'git:pull',
    async (
      _e,
      a?: string | { remote?: string; branch?: string; rebase?: boolean; autostash?: boolean },
      b?: string
    ) => {
      if (!git) return { error: '未打开仓库' }
      try {
        const opts =
          typeof a === 'object' && a !== null
            ? a
            : { remote: a, branch: b }
        const args = ['pull']
        if (opts.rebase) args.push('--rebase')
        if (opts.autostash) args.push('--autostash')
        if (opts.remote && opts.branch) args.push(opts.remote, opts.branch)
        else if (opts.remote) args.push(opts.remote)
        await git.raw(args)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'git:push',
    async (
      _e,
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
            /** 仅推送该标签名（`git push remote tag`） */
            tagOnly?: string
          },
      b?: string
    ) => {
      if (!git) return { error: '未打开仓库' }
      try {
        const opts =
          typeof a === 'object' && a !== null
            ? a
            : { remote: a, localBranch: b }
        const args = ['push']
        if (opts.dryRun) args.push('--dry-run')
        const tagName = opts.tagOnly?.trim()
        if (tagName) {
          if (/[\n\r]/.test(tagName)) return { error: '标签名无效' }
          const r = opts.remote?.trim() || 'origin'
          args.push(r, tagName)
          await git.raw(args)
          return { ok: true as const }
        }
        if (opts.forceWithLease) args.push('--force-with-lease')
        else if (opts.force) args.push('--force')
        if (opts.prune) args.push('--prune')
        if (opts.setUpstream) args.push('-u')
        if (opts.remote) {
          args.push(opts.remote)
          const loc = opts.localBranch?.trim()
          const rem = opts.remoteBranch?.trim()
          if (loc) {
            if (rem && rem !== loc) args.push(`${loc}:${rem}`)
            else args.push(loc)
          }
        }
        if (opts.tags) args.push('--tags')
        await git.raw(args)
        return { ok: true as const }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:remote-branches', async (_e, remote?: string) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['branch', '-r'])
      const prefix = remote ? `${remote}/` : ''
      const names = new Set<string>()
      for (const line of raw.split('\n')) {
        let s = line.trim()
        if (!s || s.includes('->')) continue
        if (remote) {
          if (!s.startsWith(prefix)) continue
          s = s.slice(prefix.length)
        } else {
          const i = s.indexOf('/')
          if (i < 0) continue
          s = s.slice(i + 1)
        }
        if (s === 'HEAD') continue
        names.add(s)
      }
      return { branches: [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rev-parse', async (_e, ref: string) => {
    if (!git) return { error: '未打开仓库' }
    const r = String(ref ?? '').trim()
    if (!r) return { error: '引用无效' }
    try {
      const full = (await git.raw(['rev-parse', '--verify', r])).trim()
      return { hash: full }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:commit-detail', async (_e, hash: string) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const full = (await git.raw(['rev-parse', '--verify', hash])).trim()
      const subject = (await git.raw(['log', '-1', '--format=%s', full])).trimEnd()
      const body = (await git.raw(['log', '-1', '--format=%b', full])).trimEnd()
      const authorName = (await git.raw(['log', '-1', '--format=%an', full])).trimEnd()
      const authorEmail = (await git.raw(['log', '-1', '--format=%ae', full])).trimEnd()
      const at = (await git.raw(['log', '-1', '--format=%at', full])).trim()
      const ts = parseInt(at, 10)
      const parents = (await git.raw(['log', '-1', '--format=%P', full])).trim().split(/\s+/).filter(Boolean)
      const dateFmt = new Date(Number.isNaN(ts) ? Date.now() : ts * 1000).toLocaleString('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
      /*
       * 用 `diff-tree` 相对父提交列变更文件，避免 `git show --name-status` 在部分合并提交上漏项；
       * 根提交用 `--root` 列出该提交引入的整棵树。
       */
      let files: { status: string; path: string }[] = []
      try {
        if (parents.length === 0) {
          const dt = await git.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', full])
          files = parseNameStatusLines(dt)
        } else {
          const dt = await git.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', parents[0], full])
          files = parseNameStatusLines(dt)
        }
      } catch {
        files = []
      }
      return {
        fullHash: full,
        subject,
        body,
        authorName,
        authorEmail,
        date: dateFmt,
        parents,
        files
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 某提交树快照下的全部路径（与 `git checkout` 该提交时工作区文件集合一致，不含未跟踪） */
  ipcMain.handle('git:commit-tree-paths', async (_e, hash: string) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const full = (await git.raw(['rev-parse', '--verify', String(hash ?? '').trim()])).trim()
      const raw = await git.raw(['ls-tree', '-r', '--name-only', full])
      const paths = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      return { paths }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:commit-diff', async (_e, rev: string, opts: DiffOpts, filePath: string) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const hash = (await git.raw(['rev-parse', '--verify', rev])).trim()
      const args = diffArgs(opts)
      const layoutPath = filePath != null && filePath.trim() ? pathForCommitLayout(filePath.trim()) : ''
      const parents = await getMergeParents(hash)
      if (parents.length === 2) {
        const range = `${parents[0]}...${parents[1]}`
        const cmd = ['diff', '--no-color', ...args, range]
        if (layoutPath) cmd.push('--', layoutPath)
        let out = await git.raw(cmd)
        if (layoutPath && isLikelyBinaryDiff(out)) {
          const spec = `${hash}:${layoutPath}`
          try {
            const blob = await git.raw(['show', spec])
            if (blob.length > 0 && blob.length < 5e6 && !blob.includes('\0')) {
              return fakeDiffForNewFile(layoutPath, blob)
            }
          } catch {
            /* keep out */
          }
        }
        return out
      }
      const showCmd = ['show', '--no-color', '--pretty=format:', ...args, hash]
      if (layoutPath) showCmd.push('--', layoutPath)
      let out = await git.raw(showCmd)
      if (layoutPath && isLikelyBinaryDiff(out)) {
        const spec = `${hash}:${layoutPath}`
        try {
          const blob = await git.raw(['show', spec])
          if (blob.length > 0 && blob.length < 5e6 && !blob.includes('\0')) {
            return fakeDiffForNewFile(layoutPath, blob)
          }
        } catch {
          /* keep */
        }
      }
      return out
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  function rebaseTodoPath(): string | null {
    if (!repoRoot) return null
    const gcd = resolveGitCommonDir(repoRoot)
    if (!gcd) return null
    const p = path.join(gcd, 'rebase-merge', 'git-rebase-todo')
    return fs.existsSync(p) ? p : null
  }

  function isSafeWorktreePathSpec(p: string): boolean {
    const s = String(p ?? '').trim()
    if (!s) return false
    return !s.split(/[/\\]/).some((seg) => seg === '..')
  }

  function parseWorktreePorcelain(raw: string): { path: string; head: string; branch: string }[] {
    const blocks = raw
      .split(/\n\n+/)
      .map((b) => b.trim())
      .filter(Boolean)
    const out: { path: string; head: string; branch: string }[] = []
    for (const block of blocks) {
      let wt = ''
      let head = ''
      let branch = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) wt = line.slice('worktree '.length).trim()
        else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim()
        else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim()
        else if (line.trim() === 'detached') branch = '(分离 HEAD)'
      }
      if (wt) out.push({ path: wt, head, branch })
    }
    return out
  }

  ipcMain.handle('git:blame', async (_e, relPath: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(String(relPath ?? ''))
    if (!rp) return { error: '路径无效' }
    try {
      const text = await git.raw(['blame', '-b', '-w', '--date=short', '--', rp.replace(/\//g, path.sep)])
      return { text }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:log-file', async (_e, opts: { path: string; maxCount?: number }) => {
    if (!git) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(String(opts?.path ?? ''))
    if (!rp) return { error: '路径无效' }
    const n = Math.min(500, Math.max(1, Math.floor(Number(opts?.maxCount) || 80)))
    const fmt = '%H%x09%h%x09%s%x09%ai%x09%an'
    try {
      const raw = await git.raw([
        'log',
        '-n',
        String(n),
        '--format=' + fmt,
        '--',
        rp.replace(/\//g, path.sep)
      ])
      const entries: { hash: string; shortHash: string; subject: string; date: string; author: string }[] = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const parts = line.split('\t')
        if (parts.length < 5) continue
        entries.push({
          hash: parts[0]!,
          shortHash: parts[1]!,
          subject: parts[2]!,
          date: parts[3]!,
          author: parts[4]!
        })
      }
      return { entries }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:diff-range',
    async (_e, opts: { from: string; to: string; tripleDot?: boolean }) => {
      if (!git) return { error: '未打开仓库' }
      const a = String(opts?.from ?? '').trim()
      const b = String(opts?.to ?? '').trim()
      if (!a || !b) return { error: '请填写起止引用' }
      const range = opts?.tripleDot ? `${a}...${b}` : `${a}..${b}`
      try {
        const text = await git.raw(['diff', '--no-color', range])
        return { text }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:reflog', async (_e, maxRaw?: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const n = Math.min(500, Math.max(10, Math.floor(Number(maxRaw) || 100)))
    try {
      const raw = await git.raw(['reflog', '-n', String(n), '--format=%gd%x09%H%x09%gs'])
      const entries: { ref: string; hash: string; subject: string }[] = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const i = line.indexOf('\t')
        if (i < 0) continue
        const ref = line.slice(0, i).trim()
        const rest = line.slice(i + 1)
        const j = rest.indexOf('\t')
        if (j < 0) continue
        const hash = rest.slice(0, j).trim()
        const subject = rest.slice(j + 1).trim()
        entries.push({ ref, hash, subject })
      }
      return { entries }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:worktree-list', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['worktree', 'list', '--porcelain'])
      return { worktrees: parseWorktreePorcelain(raw) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:worktree-add', async (_e, opts: { workPath: string; ref?: string }) => {
    if (!git) return { error: '未打开仓库' }
    const wp = String(opts?.workPath ?? '').trim()
    if (!isSafeWorktreePathSpec(wp)) return { error: '工作树路径无效' }
    const ref = String(opts?.ref ?? '').trim()
    try {
      const args = ['worktree', 'add', wp.replace(/\//g, path.sep)]
      if (ref) args.push(ref)
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:worktree-remove', async (_e, opts: { workPath: string; force?: boolean }) => {
    if (!git) return { error: '未打开仓库' }
    const wp = String(opts?.workPath ?? '').trim()
    if (!isSafeWorktreePathSpec(wp)) return { error: '工作树路径无效' }
    try {
      const args = ['worktree', 'remove']
      if (opts?.force) args.push('--force')
      args.push(wp.replace(/\//g, path.sep))
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:bisect-start', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['bisect', 'start'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:bisect-bad', async (_e, rev?: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const r = rev != null ? String(rev).trim() : ''
    try {
      await git.raw(r ? ['bisect', 'bad', r] : ['bisect', 'bad'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:bisect-good', async (_e, rev?: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const r = rev != null ? String(rev).trim() : ''
    try {
      await git.raw(r ? ['bisect', 'good', r] : ['bisect', 'good'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:bisect-skip', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['bisect', 'skip'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:bisect-reset', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['bisect', 'reset'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rebase-todo-read', async () => {
    const p = rebaseTodoPath()
    if (!p) {
      return {
        error: '当前没有可编辑的变基序列（需要处于交互式变基且存在 rebase-merge/git-rebase-todo）'
      }
    }
    try {
      const text = fs.readFileSync(p, 'utf8')
      return { text }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:rebase-todo-write', async (_e, text: unknown) => {
    const p = rebaseTodoPath()
    if (!p) {
      return {
        error: '当前没有可编辑的变基序列（需要处于交互式变基且存在 rebase-merge/git-rebase-todo）'
      }
    }
    try {
      fs.writeFileSync(p, String(text ?? ''), 'utf8')
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:checkout-ours', async (_e, relPath: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(String(relPath ?? ''))
    if (!rp) return { error: '路径无效' }
    try {
      await git.raw(['checkout', '--ours', '--', rp.replace(/\//g, path.sep)])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:checkout-theirs', async (_e, relPath: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const rp = normalizeRepoRelative(String(relPath ?? ''))
    if (!rp) return { error: '路径无效' }
    try {
      await git.raw(['checkout', '--theirs', '--', rp.replace(/\//g, path.sep)])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:mergetool', async (_e, relPath?: unknown, opts?: unknown) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const cwd = repoRoot
    const rp = relPath != null && String(relPath).trim() ? normalizeRepoRelative(String(relPath)) : null
    if (relPath != null && String(relPath).trim() && !rp) return { error: '路径无效' }
    const o = opts && typeof opts === 'object' ? (opts as { preset?: string; toolPath?: string }) : {}
    const preset = String(o.preset ?? 'default').trim() || 'default'
    const toolPath = String(o.toolPath ?? '').trim()
    const fileTail: string[] = []
    if (rp) {
      fileTail.push('--', rp.replace(/\//g, path.sep))
    }
    let gitArgs: string[]
    if (preset === 'default') {
      gitArgs = ['mergetool', '-y', ...fileTail]
    } else {
      const toolMap: Record<string, string> = { bc4: 'bc4', bc3: 'bc3', winmerge: 'winmerge' }
      const tool = toolMap[preset]
      if (!tool) {
        gitArgs = ['mergetool', '-y', ...fileTail]
      } else {
        const cfg: string[] = []
        if (toolPath) {
          const normalized = toolPath.replace(/\\/g, '/')
          cfg.push('-c', `mergetool.${tool}.path=${normalized}`)
        }
        cfg.push('-c', `mergetool.${tool}.trustExitCode=true`)
        gitArgs = [...cfg, 'mergetool', '-y', '-t', tool, ...fileTail]
      }
    }
    try {
      const r = await new Promise<{ ok: true } | { error: string }>((resolve) => {
        const child = spawn('git', gitArgs, {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        })
        child.on('error', (err: Error) => resolve({ error: err.message }))
        child.on('spawn', () => {
          child.unref()
          resolve({ ok: true as const })
        })
      })
      return r
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:remote-prune', async (_e, remote: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const r = String(remote ?? '').trim()
    if (!r) return { error: '请选择远程' }
    try {
      await git.raw(['remote', 'prune', r])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:submodule-update', async (_e, opts?: { init?: boolean; recursive?: boolean }) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const args = ['submodule', 'update']
      if (opts?.init !== false) args.push('--init')
      if (opts?.recursive !== false) args.push('--recursive')
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:submodule-sync', async (_e, opts?: { recursive?: boolean }) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const args = ['submodule', 'sync']
      if (opts?.recursive !== false) args.push('--recursive')
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:submodule-update-remote', async (_e, opts?: { rebase?: boolean; recursive?: boolean }) => {
    if (!git) return { error: '未打开仓库' }
    try {
      const args = ['submodule', 'update', '--remote']
      if (opts?.rebase) args.push('--rebase')
      else args.push('--merge')
      if (opts?.recursive !== false) args.push('--recursive')
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:push-delete-branch', async (_e, opts: { remote: string; branch: string }) => {
    if (!git) return { error: '未打开仓库' }
    const remote = String(opts?.remote ?? '').trim()
    const branch = String(opts?.branch ?? '').trim()
    if (!remote || !branch) return { error: '远程或分支名无效' }
    try {
      await git.raw(['push', remote, '--delete', branch])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(
    'git:diff-file-commits',
    async (_e, opts: { from: string; to: string; path: string }) => {
      if (!git) return { error: '未打开仓库' }
      const a = String(opts?.from ?? '').trim()
      const b = String(opts?.to ?? '').trim()
      const rp = normalizeRepoRelative(String(opts?.path ?? ''))
      if (!a || !b || !rp) return { error: '参数无效' }
      try {
        const text = await git.raw([
          'diff',
          '--no-color',
          `${a}..${b}`,
          '--',
          rp.replace(/\//g, path.sep)
        ])
        return { text }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('git:lfs-version', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = (await git.raw(['lfs', 'version'])).trim()
      return { version: raw || 'unknown' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:lfs-install', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['lfs', 'install'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:lfs-pull', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      await git.raw(['lfs', 'pull'])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:apply-cached-patch', async (_e, patchText: unknown, reverse?: unknown) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const p = String(patchText ?? '')
    if (p.length > 2_000_000) return { error: '补丁过大' }
    if (!p.trim()) return { error: '补丁为空' }
    return applyPatchStdin(p, { cached: true, reverse: !!reverse })
  })

  ipcMain.handle('git:apply-patch', async (_e, patchText: unknown, opts?: unknown) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const p = String(patchText ?? '')
    if (p.length > 2_000_000) return { error: '补丁过大' }
    if (!p.trim()) return { error: '补丁为空' }
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            cached?: boolean
            reverse?: boolean
            ignoreSpaceChange?: boolean
            recount?: boolean
            ignoreWhitespace?: boolean
          })
        : {}
    return applyPatchStdin(p, {
      cached: !!o.cached,
      reverse: !!o.reverse,
      ignoreSpaceChange: !!o.ignoreSpaceChange,
      recount: !!o.recount,
      ignoreWhitespace: !!o.ignoreWhitespace
    })
  })

  ipcMain.handle('git:partial-line-merge', async (_e, payload: unknown) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const o = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const relPath = j(String(o.relPath ?? ''))
    const diffText = String(o.diffText ?? '')
    const startLine = Math.floor(Number(o.startLine ?? 0))
    const endLine = Math.floor(Number(o.endLine ?? 0))
    const mode = String(o.mode ?? '')
    if (!relPath) return { error: '路径无效' }
    if (!diffText.trim()) return { error: 'diff 为空' }
    if (diffText.length > 2_000_000) return { error: 'diff 过大' }
    if (!['stage', 'unstage', 'discard-unstaged'].includes(mode)) return { error: 'mode 无效' }

    let oldText = ''
    let deltaMode: 'applySelected' | 'applyUnselected'
    if (mode === 'stage') {
      oldText = await gitShowBlob(`:0:${relPath}`)
      deltaMode = 'applySelected'
    } else if (mode === 'unstage') {
      oldText = await gitShowBlob(`HEAD:${relPath}`)
      deltaMode = 'applyUnselected'
    } else {
      oldText = await gitShowBlob(`:0:${relPath}`)
      deltaMode = 'applyUnselected'
    }

    const merged = mergePartialUsingUnifiedDiff(oldText, diffText, startLine, endLine, deltaMode)
    if (!merged) return { error: '无法根据选区合并' }

    if (mode === 'discard-unstaged') {
      const abs = path.join(repoRoot, relPath.split('/').join(path.sep))
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, merged.text, 'utf8')
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
      return { ok: true as const, addedContextLines: merged.addedContextLines }
    }

    const w = await writeIndexCacheInfo(relPath, merged.text)
    if ('error' in w) return w
    return { ok: true as const, addedContextLines: merged.addedContextLines }
  })

  ipcMain.handle('git:restore-worktree', async (_e, paths: unknown) => {
    if (!git || !repoRoot) return { error: '未打开仓库' }
    const arr = Array.isArray(paths) ? paths : []
    const norm = arr
      .map((x) => normalizeRepoRelative(String(x ?? '')))
      .filter((x): x is string => !!x)
      .map((p) => p.replace(/\//g, path.sep))
    if (!norm.length) return { error: '路径为空' }
    try {
      await git.raw(['restore', '--worktree', '--', ...norm])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:submodule-foreach-preset', async (_e, preset: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const key = String(preset ?? '').trim()
    const args = SUBMODULE_FOREACH_PRESETS[key]
    if (!args) return { error: '未知 foreach 预设' }
    try {
      await git.raw(args)
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:lfs-track', async (_e, pattern: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const pat = String(pattern ?? '').trim()
    if (!pat || pat.length > 240 || /[\n\r\x00]/.test(pat)) return { error: '追踪模式无效' }
    try {
      await git.raw(['lfs', 'track', pat])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:lfs-untrack', async (_e, pattern: unknown) => {
    if (!git) return { error: '未打开仓库' }
    const pat = String(pattern ?? '').trim()
    if (!pat || pat.length > 240 || /[\n\r\x00]/.test(pat)) return { error: '模式无效' }
    try {
      await git.raw(['lfs', 'untrack', pat])
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:lfs-ls-files', async () => {
    if (!git) return { error: '未打开仓库' }
    try {
      const raw = await git.raw(['lfs', 'ls-files', '-l'])
      const lines = raw
        .split('\n')
        .map((s) => s.trimEnd())
        .filter(Boolean)
      return { lines }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })
}
