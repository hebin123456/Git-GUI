import type { GitgraphImportRow, LogEntry } from '../types/git-client.ts'

export type RecentCommitMessageEntry = {
  hash: string
  shortHash: string
  message: string
  date: string
}

const DEFAULT_RECENT_COMMIT_MESSAGE_COUNT = 12

export function extractRecentCommitMessages(
  entries: readonly LogEntry[],
  gitgraphRows: readonly GitgraphImportRow[],
  maxCount = DEFAULT_RECENT_COMMIT_MESSAGE_COUNT
): RecentCommitMessageEntry[] {
  const out: RecentCommitMessageEntry[] = []
  const limit = Math.max(1, Math.floor(maxCount || DEFAULT_RECENT_COMMIT_MESSAGE_COUNT))
  for (let i = 0; i < entries.length && out.length < limit; i += 1) {
    const entry = entries[i]
    if (!entry) continue
    const message = String(entry.message ?? '').trim()
    if (!message) continue
    const refs = gitgraphRows[i]?.refs ?? []
    if (refs.some((ref) => /^stash@\{\d+\}$/u.test(ref))) continue
    out.push({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      message,
      date: entry.date
    })
  }
  return out
}
