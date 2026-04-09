/** 判断 `git diff` 输出是否表示二进制或不宜以文本展示 */
export function isBinaryDiffOutput(text: string): boolean {
  const t = text.replace(/\r\n/g, '\n')
  if (!t.trim()) return false
  if (/^Binary files .+ differ\s*$/im.test(t.trim())) return true
  if (/^GIT binary patch\b/im.test(t)) return true
  if (/^diff --git .+\n(?:index [^\n]+\n)?Binary files .+ differ/im.test(t)) return true
  if (t.includes('\0')) return true
  return false
}
