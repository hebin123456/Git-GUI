/** 从 remote URL 解析托管平台并生成「对比 / 发起合并请求」浏览器地址 */

export type HostingKind = 'github' | 'gitlab' | 'bitbucket' | 'codehub' | 'unknown'

export type ParsedGitRemote = {
  kind: HostingKind
  /** owner/group + repo，不含 .git */
  slug: string
  /** 如 github.com */
  host: string
}

function stripDotGit(s: string): string {
  return s.replace(/\.git$/i, '').replace(/\/+$/, '')
}

/** 解析常见 https / ssh remote */
export function parseGitRemoteUrl(url: string): ParsedGitRemote | null {
  const u = url.trim()
  if (!u) return null
  const sshGithub = u.match(/^git@github\.com:([^/]+)\/(.+)$/i)
  if (sshGithub) {
    return {
      kind: 'github',
      host: 'github.com',
      slug: stripDotGit(`${sshGithub[1]}/${sshGithub[2]}`)
    }
  }
  const sshAny = u.match(/^git@([^:]+):(.+)$/i)
  if (sshAny && sshAny[1]!.toLowerCase().includes('codehub')) {
    return {
      kind: 'codehub',
      host: sshAny[1]!,
      slug: stripDotGit(sshAny[2]!.replace(/^\/+/, ''))
    }
  }
  const sshGitlab = u.match(/^git@([^:]+):(.+)$/i)
  if (sshGitlab && sshGitlab[1]!.includes('gitlab')) {
    return {
      kind: 'gitlab',
      host: sshGitlab[1]!,
      slug: stripDotGit(sshGitlab[2]!.replace(/^\/+/, ''))
    }
  }
  const https = u.match(/^https?:\/\/([^/]+)\/(.+)$/i)
  if (https) {
    const host = https[1]!.toLowerCase()
    const rest = stripDotGit(https[2]!)
    if (host.includes('github.com')) {
      return { kind: 'github', host: 'github.com', slug: rest.replace(/^\/+/, '') }
    }
    if (host.includes('gitlab')) {
      return { kind: 'gitlab', host: https[1]!, slug: rest.replace(/^\/+/, '') }
    }
    if (host.includes('bitbucket.org')) {
      return { kind: 'bitbucket', host: 'bitbucket.org', slug: rest.replace(/^\/+/, '') }
    }
    if (host.includes('codehub')) {
      return { kind: 'codehub', host: https[1]!, slug: rest.replace(/^\/+/, '') }
    }
  }
  return null
}

function encBranch(b: string): string {
  return encodeURIComponent(b).replace(/%2F/g, '/')
}

/** 从 remote URL 得到浏览器访问的 origin（与 clone 时 scheme 一致；SSH 时按平台猜 http/https） */
export function resolveHostingWebOrigin(remoteUrl: string): string | null {
  const raw = remoteUrl.trim()
  const m = raw.match(/^(https?:\/\/[^/]+)/i)
  if (m) return m[1]!
  const ssh = raw.match(/^git@([^:]+):/i)
  if (!ssh) return null
  const h = ssh[1]!
  if (h.toLowerCase().includes('codehub')) return `http://${h}`
  return `https://${h}`
}

function slugPathForUrl(slug: string): string {
  return slug
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/**
 * 在浏览器打开托管「对比当前分支与默认分支」页，便于发起 PR/MR。
 * GitHub: compare/base...head；GitLab: -/compare；Bitbucket: compare branch
 */
export function buildHostingCompareUrl(
  fetchUrl: string,
  baseBranch: string,
  headBranch: string
): string | null {
  const p = parseGitRemoteUrl(fetchUrl)
  if (!p) return null
  const base = baseBranch.trim() || 'main'
  const head = headBranch.trim() || 'HEAD'
  if (p.kind === 'github') {
    return `https://github.com/${p.slug}/compare/${encBranch(base)}...${encBranch(head)}?expand=1`
  }
  if (p.kind === 'gitlab') {
    const h = p.host.includes('://') ? p.host : `https://${p.host}`
    return `${h}/${p.slug}/-/compare/${encBranch(base)}...${encBranch(head)}`
  }
  if (p.kind === 'bitbucket') {
    return `https://bitbucket.org/${p.slug}/pull-requests/new?source=${encodeURIComponent(head)}&dest=${encodeURIComponent(base)}`
  }
  if (p.kind === 'codehub') {
    const origin = resolveHostingWebOrigin(fetchUrl)
    if (!origin) return null
    const q = new URLSearchParams()
    q.set('merge_request[source_branch]', head)
    q.set('merge_request[target_branch]', base)
    return `${origin}/${slugPathForUrl(p.slug)}/merge_requests/new?${q.toString()}`
  }
  return null
}
