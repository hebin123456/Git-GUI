import test from 'node:test'
import assert from 'node:assert/strict'
import { mergePartialUsingUnifiedDiff } from './partialLineMerge.ts'

const d = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 a
-old
+new
 z
`

test('mergePartial applySelected stages one replacement', () => {
  const oldText = ['a', 'old', 'z'].join('\n')
  const minusOld = d.split('\n').indexOf('-old')
  const plusNew = d.split('\n').indexOf('+new')
  const r = mergePartialUsingUnifiedDiff(oldText, d, minusOld, plusNew, 'applySelected')
  assert.ok(r)
  assert.equal(r!.text, ['a', 'new', 'z'].join('\n'))
})

test('mergePartial applyUnselected keeps HEAD when selection covers change (unstage)', () => {
  const headText = ['a', 'old', 'z'].join('\n')
  const minusOld = d.split('\n').indexOf('-old')
  const plusNew = d.split('\n').indexOf('+new')
  const r = mergePartialUsingUnifiedDiff(headText, d, minusOld, plusNew, 'applyUnselected')
  assert.ok(r)
  assert.equal(r!.text, ['a', 'old', 'z'].join('\n'))
})

test('mergePartial applySelected no spill when selection outside hunk', () => {
  const twoHunk = `--- a/f.txt
+++ b/f.txt
@@ -1,1 +1,1 @@
-x
+x
@@ -10,1 +10,1 @@
-a
+b
`
  const oldLines: string[] = []
  for (let i = 1; i <= 15; i++) oldLines.push(i === 1 ? 'x' : i === 10 ? 'a' : String(i))
  const oldText = oldLines.join('\n')
  const idx = twoHunk.split('\n').findIndex((l) => l.startsWith('-x'))
  const r = mergePartialUsingUnifiedDiff(oldText, twoHunk, idx, idx, 'applySelected')
  assert.ok(r)
  const o = r!.text.split('\n')
  assert.equal(o[0], 'x')
  assert.equal(o[9], 'a')
})
