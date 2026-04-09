import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveCloneFolderFromUrl, joinCloneTargetPath, sanitizeCloneFolderSegment } from './clonePathUtils'

describe('clonePathUtils', () => {
  describe('deriveCloneFolderFromUrl', () => {
    it('returns empty for blank URL', () => {
      assert.equal(deriveCloneFolderFromUrl(''), '')
      assert.equal(deriveCloneFolderFromUrl('   '), '')
    })

    it('strips .git and takes last path segment', () => {
      assert.equal(deriveCloneFolderFromUrl('https://github.com/foo/bar.git'), 'bar')
      assert.equal(deriveCloneFolderFromUrl('git@github.com:acme/widget.git'), 'widget')
    })

    it('sanitizes invalid Windows filename characters in tail segment', () => {
      assert.equal(deriveCloneFolderFromUrl('https://example.com/bad*name.git'), 'bad-name')
    })

    it('falls back to repo when nothing left', () => {
      assert.equal(deriveCloneFolderFromUrl('https://x/...'), 'repo')
    })
  })

  describe('sanitizeCloneFolderSegment', () => {
    it('replaces illegal chars and default name', () => {
      assert.equal(sanitizeCloneFolderSegment('a:b'), 'a-b')
      assert.equal(sanitizeCloneFolderSegment(''), 'repo')
      assert.equal(sanitizeCloneFolderSegment('...'), 'repo')
    })
  })

  describe('joinCloneTargetPath', () => {
    it('uses backslash when parent is Windows-style', () => {
      assert.equal(joinCloneTargetPath('C:\\dev', 'my-repo'), 'C:\\dev\\my-repo')
    })

    it('uses slash for POSIX parent', () => {
      assert.equal(joinCloneTargetPath('/home/u', 'proj'), '/home/u/proj')
    })

    it('sanitizes slashes inside folder segment to match Windows-safe names', () => {
      assert.equal(joinCloneTargetPath('/tmp', 'a/b'), '/tmp/a-b')
    })
  })
})
