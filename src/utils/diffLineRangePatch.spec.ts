import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractCompleteHunkPatchForLineRange,
  extractPartialLinePatchForLineRange
} from './diffLineRangePatch.ts'

test('extractCompleteHunkPatchForLineRange returns null when no hunk', () => {
  assert.equal(extractCompleteHunkPatchForLineRange('no hunk here', 0, 3), null)
})

test('extractCompleteHunkPatchForLineRange picks full hunk when selection touches it', () => {
  const d = `--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,3 @@
 a
-b
+b2
+c
`
  const lines = d.split('\n')
  const r = extractCompleteHunkPatchForLineRange(d, 5, 5)
  assert.ok(r)
  assert.ok(r!.patch.includes('@@ -1,2 +1,3 @@'))
  assert.equal(r!.expandedToFullHunks, true)
  assert.ok(r!.patch.split('\n').length >= lines.filter(Boolean).length)
})

test('extractPartialLinePatchForLineRange with contextLines=0 is tight selection without neighbor spill', () => {
  const lines: string[] = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,22 +1,22 @@']
  for (let i = 0; i < 10; i++) lines.push(` ${i}`)
  lines.push('-OLD')
  lines.push('+NEW')
  for (let i = 0; i < 10; i++) lines.push(` x${i}`)
  const d = lines.join('\n')
  const minusOld = lines.indexOf('-OLD')
  const plusNew = lines.indexOf('+NEW')
  const full = extractCompleteHunkPatchForLineRange(d, minusOld, minusOld)
  const part = extractPartialLinePatchForLineRange(d, minusOld, plusNew, 0)
  assert.ok(full && part)
  const fullBody = full!.patch.split('\n').length
  const partBody = part!.patch.split('\n').length
  assert.ok(partBody < fullBody, `partial (${partBody}) should be smaller than full (${fullBody})`)
  assert.ok(part!.patch.includes('-OLD'))
  assert.ok(part!.patch.includes('+NEW'))
  assert.ok(!part!.addedContextLines)
})

test('extractPartialLinePatchForLineRange expands lone + or - to full -/+ pair in hunk', () => {
  const d = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 a
-old
+new
 z
`
  const lines = d.split('\n')
  const plusNew = lines.indexOf('+new')
  const onlyPlus = extractPartialLinePatchForLineRange(d, plusNew, plusNew, 0)
  assert.ok(onlyPlus?.patch.includes('-old'))
  assert.ok(onlyPlus?.patch.includes('+new'))
})

test('extractPartialLinePatchForLineRange with contextLines>0 adds surrounding lines', () => {
  const lines: string[] = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,22 +1,22 @@']
  for (let i = 0; i < 10; i++) lines.push(` ${i}`)
  lines.push('-OLD')
  lines.push('+NEW')
  for (let i = 0; i < 10; i++) lines.push(` x${i}`)
  const d = lines.join('\n')
  const minusOld = lines.indexOf('-OLD')
  const part = extractPartialLinePatchForLineRange(d, minusOld, minusOld, 3)
  assert.ok(part?.addedContextLines)
})
