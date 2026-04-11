/**
 * 功能级用例：真实 `git` + simple-git，对应合并 / 变基 / 贮藏 / 克隆 等能力。
 *
 * SC-MERGE / SC-REBASE / SC-STASH / SC-CLONE 见各 it 标题。
 */
import { execSync } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { simpleGit, type SimpleGit } from 'simple-git'

function gitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const describeGit = gitAvailable() ? describe : describe.skip

async function configureUser(g: SimpleGit) {
  await g.addConfig('user.email', 'tester@git-gui.test')
  await g.addConfig('user.name', 'git-gui Tester')
}

/** 与 UI 文案一致，避免不同 Git 默认分支名（main / master）导致检出失败 */
async function renameCurrentBranchToMain(g: SimpleGit) {
  await g.raw(['branch', '-M', 'main'])
}

describeGit('functional: git workflows (local)', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gfl-git-fn-'))

  after(() => {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true })
    } catch {
      /* 临时目录可能被占用 */
    }
  })

  it('SC-MERGE: merges feature branch into main', async () => {
    const root = path.join(sandbox, 'merge-case')
    fs.mkdirSync(root, { recursive: true })
    const g = simpleGit(root)
    await g.init()
    await configureUser(g)
    fs.writeFileSync(path.join(root, 'README.md'), 'base\n')
    await g.add('README.md')
    await g.commit('init')
    await renameCurrentBranchToMain(g)
    await g.checkoutLocalBranch('feature')
    fs.writeFileSync(path.join(root, 'feat.txt'), 'x\n')
    await g.add('feat.txt')
    await g.commit('on feature')
    await g.checkout('main')
    await g.merge(['feature'])
    const st = await g.status()
    assert.equal(st.isClean(), true)
    assert.equal(fs.existsSync(path.join(root, 'feat.txt')), true)
  })

  it('SC-REBASE: rebases feature onto newer main', async () => {
    const root = path.join(sandbox, 'rebase-case')
    fs.mkdirSync(root, { recursive: true })
    const g = simpleGit(root)
    await g.init()
    await configureUser(g)
    fs.writeFileSync(path.join(root, 'f'), '1')
    await g.add('f')
    await g.commit('m1')
    await renameCurrentBranchToMain(g)
    await g.checkoutLocalBranch('feature')
    fs.writeFileSync(path.join(root, 'g'), '2')
    await g.add('g')
    await g.commit('f1')
    await g.checkout('main')
    fs.appendFileSync(path.join(root, 'f'), '2')
    await g.add('f')
    await g.commit('m2')
    await g.checkout('feature')
    await g.rebase(['main'])
    const log = await g.log({ maxCount: 10 })
    const subjects = log.all.map((c) => c.message)
    assert.ok(subjects.some((s) => s.includes('f1')))
    const st = await g.status()
    assert.equal(st.isClean(), true)
  })

  it('SC-STASH: push clears dirty file, pop restores', async () => {
    const root = path.join(sandbox, 'stash-case')
    fs.mkdirSync(root, { recursive: true })
    const g = simpleGit(root)
    await g.init()
    await configureUser(g)
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'a')
    await g.add('tracked.txt')
    await g.commit('c1')
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'dirty')
    await g.stash(['push', '-m', 'wip'])
    const afterStash = await g.status()
    assert.equal(afterStash.isClean(), true)
    assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'a')
    await g.stash(['pop'])
    const afterPop = await g.status()
    assert.ok(afterPop.modified.includes('tracked.txt'))
    assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8'), 'dirty')
  })

  it('SC-CLONE: clones a local repository into a new directory', async () => {
    const src = path.join(sandbox, 'clone-src')
    const dst = path.join(sandbox, 'clone-dst')
    fs.mkdirSync(src, { recursive: true })
    const gs = simpleGit(src)
    await gs.init()
    await configureUser(gs)
    fs.writeFileSync(path.join(src, 'x'), 'y')
    await gs.add('x')
    await gs.commit('init')
    fs.mkdirSync(dst, { recursive: true })
    const gc = simpleGit()
    await gc.clone(src, dst)
    assert.equal(fs.existsSync(path.join(dst, '.git')), true)
    assert.equal(fs.readFileSync(path.join(dst, 'x'), 'utf8'), 'y')
  })
})

describe('functional: git prerequisite', () => {
  it('runner has git when functional suite is enabled', () => {
    if (gitAvailable()) assert.equal(gitAvailable(), true)
    else assert.equal(gitAvailable(), false)
  })
})
