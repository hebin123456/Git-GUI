import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GitgraphImportRow } from '../types/git-client'
import { buildForkCommitGraphLayout, FORK_COMMIT_ROW_HEIGHT } from './forkCommitGraphLayout'

function row(
  hash: string,
  parents: string[],
  subject = 's',
  refs: string[] = []
): GitgraphImportRow {
  return {
    hash,
    parents,
    subject,
    author: { name: 'a', email: 'a@b' },
    refs
  }
}

describe('buildForkCommitGraphLayout', () => {
  it('returns null for empty rows', () => {
    assert.equal(buildForkCommitGraphLayout([]), null)
  })

  it('lays out a linear history on lane 0', () => {
    const rows: GitgraphImportRow[] = [
      row('c3', ['c2'], 'third'),
      row('c2', ['c1'], 'second'),
      row('c1', [], 'root')
    ]
    const L = buildForkCommitGraphLayout(rows)
    assert.ok(L)
    assert.equal(L!.rowHeight, FORK_COMMIT_ROW_HEIGHT)
    assert.equal(L!.dots.length, 3)
    assert.equal(L!.dots[0]!.x, L!.dots[1]!.x)
    assert.equal(L!.svgHeight, 3 * FORK_COMMIT_ROW_HEIGHT)
    assert.ok(L!.paths.length > 0)
  })

  it('assigns higher lane index for a side branch off main trunk', () => {
    const rows: GitgraphImportRow[] = [
      row('m2', ['m1'], 'main tip'),
      row('b1', ['m1'], 'branch tip'),
      row('m1', [], 'root')
    ]
    const L = buildForkCommitGraphLayout(rows)!
    assert.ok(L.dots[1]!.x > L.dots[0]!.x)
  })
})
