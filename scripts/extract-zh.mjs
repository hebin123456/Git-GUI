import fs from 'node:fs'
const s = fs.readFileSync('src/composables/useGitWorkspace.ts', 'utf8')
const re = /'([^'\n]*[\u4e00-\u9fff][^']*)'|"([^"\n]*[\u4e00-\u9fff][^"]*)"/g
const set = new Set()
let m
while ((m = re.exec(s))) set.add(m[1] || m[2])
console.log([...set].sort().join('\n'))
