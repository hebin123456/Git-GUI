import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeStashSidebarAfterRemove } from './stashSidebarSelection'

describe('computeStashSidebarAfterRemove', () => {
  it('noop when selection is not stash', () => {
    assert.deepEqual(computeStashSidebarAfterRemove(null, 0), { type: 'noop' })
    assert.deepEqual(computeStashSidebarAfterRemove({ kind: 'branch', name: 'main' }, 0), {
      type: 'noop'
    })
  })

  it('clears when popped/dropped index matches selection', () => {
    assert.deepEqual(computeStashSidebarAfterRemove({ kind: 'stash', index: 2 }, 2), {
      type: 'clear-linked-detail'
    })
  })

  it('decrements index when selection is above removed slot', () => {
    assert.deepEqual(computeStashSidebarAfterRemove({ kind: 'stash', index: 3 }, 1), {
      type: 'set',
      selection: { kind: 'stash', index: 2 }
    })
  })

  it('noop when selection is below removed slot', () => {
    assert.deepEqual(computeStashSidebarAfterRemove({ kind: 'stash', index: 0 }, 1), {
      type: 'noop'
    })
  })
})
