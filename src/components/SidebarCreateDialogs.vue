<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { Connection, FolderOpened, Link, PriceTag, Share } from '@element-plus/icons-vue'
import { registerForkCreateDialogs, useGitWorkspace } from '../composables/useGitWorkspace.ts'

const api = window.gitClient
const { t, locale } = useI18n()

const { currentBranch, remotes, preferredRemoteName, refreshAll, applyRemoteRenameSelection } =
  useGitWorkspace()

const forkSvg = {
  d: 'M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z'
}

const branchDialogOpen = ref(false)
const newBranchName = ref('')
const checkoutAfterCreate = ref(true)
const branchBusy = ref(false)

const remoteDialogOpen = ref(false)
const remoteEditMode = ref(false)
const remoteOriginalName = ref('')
const remoteName = ref('origin')
const remoteUrlInput = ref('')
const remoteProto = ref<'https' | 'ssh'>('https')
const syncSubmoduleUrl = ref(true)
const remoteBusy = ref(false)
const remoteTestBusy = ref(false)

const tagDialogOpen = ref(false)
const tagName = ref('')
const tagMessage = ref('')
const tagPush = ref(false)
const tagBusy = ref(false)

const submoduleDialogOpen = ref(false)
const submoduleUrl = ref('')
const submodulePath = ref('')
const submoduleRecursive = ref(false)
const submoduleBusy = ref(false)

const branchStartLabel = computed(() => {
  void locale.value
  const c = currentBranch.value?.trim()
  return c || t('createDlg.branch.headDetached')
})

const branchStartRef = computed(() => (currentBranch.value?.trim() ? currentBranch.value.trim() : 'HEAD'))

const tagAtRef = computed(() => branchStartRef.value)

const pushRemoteName = computed(() => preferredRemoteName.value || remotes.value[0] || 'origin')

function resetBranchForm() {
  newBranchName.value = ''
  checkoutAfterCreate.value = true
}

function parseRemoteUrlForForm(url: string): { proto: 'https' | 'ssh'; input: string } {
  const u = String(url ?? '').trim()
  if (!u) return { proto: 'https', input: '' }
  if (/^https?:\/\//i.test(u)) {
    return { proto: 'https', input: u.replace(/^https?:\/\//i, '') }
  }
  if (/^git@/i.test(u)) {
    return { proto: 'ssh', input: u.replace(/^git@/i, '') }
  }
  if (/^ssh:\/\//i.test(u)) {
    return { proto: 'ssh', input: u.replace(/^ssh:\/\//i, '') }
  }
  return { proto: 'https', input: u }
}

function resetRemoteForm() {
  remoteEditMode.value = false
  remoteOriginalName.value = ''
  remoteName.value = 'origin'
  remoteUrlInput.value = ''
  remoteProto.value = 'https'
  syncSubmoduleUrl.value = true
}

function resetTagForm() {
  tagName.value = ''
  tagMessage.value = ''
  tagPush.value = false
}

function resetSubmoduleForm() {
  submoduleUrl.value = ''
  submodulePath.value = ''
  submoduleRecursive.value = false
}

function openNewBranch() {
  resetBranchForm()
  branchDialogOpen.value = true
}

function openAddRemote() {
  resetRemoteForm()
  remoteDialogOpen.value = true
}

function openEditRemote(rm: { name: string; fetchUrl: string; pushUrl: string }) {
  remoteEditMode.value = true
  remoteOriginalName.value = rm.name.trim()
  remoteName.value = rm.name.trim()
  const { proto, input } = parseRemoteUrlForForm(rm.fetchUrl || rm.pushUrl || '')
  remoteProto.value = proto
  remoteUrlInput.value = input
  syncSubmoduleUrl.value = true
  remoteDialogOpen.value = true
}

function openCreateTag() {
  resetTagForm()
  tagDialogOpen.value = true
}

function openAddSubmodule() {
  resetSubmoduleForm()
  submoduleDialogOpen.value = true
}

defineExpose({
  openNewBranch,
  openAddRemote,
  openEditRemote,
  openCreateTag,
  openAddSubmodule
})

registerForkCreateDialogs({
  openNewBranch,
  openAddRemote,
  openEditRemote,
  openCreateTag,
  openAddSubmodule
})

const canCreateBranch = computed(() => !!newBranchName.value.trim())

function composedRemoteUrl(): string {
  const raw = remoteUrlInput.value.trim()
  if (!raw) return ''
  if (/^(https?:|git@|ssh:)/i.test(raw)) return raw
  if (remoteProto.value === 'https') return `https://${raw}`
  const s = raw.replace(/^\/+/, '')
  const i = s.indexOf('/')
  if (i > 0) return `git@${s.slice(0, i)}:${s.slice(i + 1)}`
  return raw
}

const canAddRemote = computed(() => !!remoteName.value.trim() && !!composedRemoteUrl())

const remoteDialogTitle = computed(() => {
  void locale.value
  return remoteEditMode.value ? t('createDlg.remote.titleEdit') : t('createDlg.remote.titleAdd')
})

const remoteDialogSub = computed(() => {
  void locale.value
  return remoteEditMode.value ? t('createDlg.remote.subEdit') : t('createDlg.remote.subAdd')
})

const remoteSubmitLabel = computed(() => {
  void locale.value
  return remoteEditMode.value ? t('createDlg.remote.submitSave') : t('createDlg.remote.submitAdd')
})

const canCreateTag = computed(() => !!tagName.value.trim())

const canAddSubmodule = computed(() => !!submoduleUrl.value.trim() && !!submodulePath.value.trim())

async function submitBranch() {
  const name = newBranchName.value.trim()
  if (!name) return
  branchBusy.value = true
  const r = await api.branchCreate({
    name,
    startPoint: branchStartRef.value,
    checkoutAfter: checkoutAfterCreate.value
  })
  branchBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(
    checkoutAfterCreate.value ? t('createDlg.msg.branchCreatedCheckout') : t('createDlg.msg.branchCreated')
  )
  branchDialogOpen.value = false
  await refreshAll()
}

async function testRemote() {
  const u = composedRemoteUrl()
  if (!u) {
    ElMessage.warning(t('createDlg.msg.urlRequired'))
    return
  }
  remoteTestBusy.value = true
  const res = await api.remoteTest(u)
  remoteTestBusy.value = false
  if ('error' in res) ElMessage.error(res.error)
  else ElMessage.success(t('createDlg.msg.testOk'))
}

async function submitRemote() {
  const n = remoteName.value.trim()
  const u = composedRemoteUrl()
  if (!n || !u) return
  remoteBusy.value = true
  try {
    if (remoteEditMode.value) {
      const old = remoteOriginalName.value.trim()
      if (old !== n) {
        const r = await api.remoteRename(old, n)
        if ('error' in r) {
          ElMessage.error(r.error)
          return
        }
        applyRemoteRenameSelection(old, n)
      }
      const r2 = await api.remoteSetUrl(n, u)
      if ('error' in r2) {
        ElMessage.error(r2.error)
        return
      }
      ElMessage.success(t('createDlg.msg.remoteSaved'))
    } else {
      const r = await api.remoteAdd(n, u)
      if ('error' in r) {
        ElMessage.error(r.error)
        return
      }
      if (syncSubmoduleUrl.value) {
        /* Fork 选项：界面保留；如需可在此执行 git submodule sync 等 */
      }
      ElMessage.success(t('createDlg.msg.remoteAdded'))
    }
    remoteDialogOpen.value = false
    await refreshAll()
  } finally {
    remoteBusy.value = false
  }
}

async function submitTag() {
  const name = tagName.value.trim()
  if (!name) return
  tagBusy.value = true
  const r = await api.tagCreate({
    name,
    message: tagMessage.value.trim() || undefined,
    ref: tagAtRef.value,
    push: tagPush.value,
    remote: pushRemoteName.value
  })
  tagBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(tagPush.value ? t('createDlg.msg.tagPushed') : t('createDlg.msg.tagCreated'))
  tagDialogOpen.value = false
  await refreshAll()
}

async function submitSubmodule() {
  const u = submoduleUrl.value.trim()
  const p = submodulePath.value.trim().replace(/^[/\\]+/, '')
  if (!u || !p) return
  submoduleBusy.value = true
  const r = await api.submoduleAdd({ url: u, path: p, recursive: submoduleRecursive.value })
  submoduleBusy.value = false
  if ('error' in r) {
    ElMessage.error(r.error)
    return
  }
  ElMessage.success(t('createDlg.msg.submoduleAdded'))
  submoduleDialogOpen.value = false
  await refreshAll()
}
</script>

<template>
  <!-- 新建分支 -->
  <el-dialog
    v-model="branchDialogOpen"
    width="480px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path fill="currentColor" :d="forkSvg.d" />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('createDlg.branch.title') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('createDlg.branch.sub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-at-row">
        <span class="fork-sync-at-label">{{ t('createDlg.branch.createOn') }}</span>
        <el-icon class="fork-sync-at-ico"><Share /></el-icon>
        <span class="fork-sync-at-name">{{ branchStartLabel }}</span>
      </div>
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('createDlg.branch.nameLabel') }}</label>
        <el-input
          v-model="newBranchName"
          class="fork-sync-field"
          :placeholder="t('createDlg.branch.namePh')"
          clearable
          @keyup.enter="submitBranch"
        >
          <template #prefix>
            <el-icon><Share /></el-icon>
          </template>
        </el-input>
      </div>
      <el-checkbox v-model="checkoutAfterCreate" class="fork-sync-check fork-sync-indent-single">
        {{ t('createDlg.branch.checkoutAfter') }}
      </el-checkbox>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button type="primary" :disabled="!canCreateBranch" :loading="branchBusy" @click="submitBranch">
          {{ t('createDlg.branch.create') }}
        </el-button>
        <el-button @click="branchDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 添加远程 -->
  <el-dialog
    v-model="remoteDialogOpen"
    width="500px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path fill="currentColor" :d="forkSvg.d" />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ remoteDialogTitle }}</div>
          <div class="fork-sync-dlg-sub">{{ remoteDialogSub }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('createDlg.remote.nameLabel') }}</label>
        <el-input v-model="remoteName" class="fork-sync-field" placeholder="origin" clearable>
          <template #prefix>
            <el-icon><Connection /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="fork-sync-row fork-sync-row-url">
        <label class="fork-sync-label">{{ t('createDlg.remote.urlLabel') }}</label>
        <div class="fork-sync-url-combo">
          <el-input
            v-model="remoteUrlInput"
            class="fork-sync-field fork-sync-url-input"
            :placeholder="t('createDlg.remote.urlPh')"
            clearable
          >
            <template #prefix>
              <el-icon><Link /></el-icon>
            </template>
          </el-input>
          <el-select v-model="remoteProto" class="fork-sync-proto-select" :aria-label="t('createDlg.remote.protoAria')">
            <el-option label="HTTPS" value="https" />
            <el-option label="SSH" value="ssh" />
          </el-select>
        </div>
      </div>
      <div class="fork-sync-hint">
        {{ t('createDlg.remote.urlHint') }}
      </div>
      <el-checkbox v-model="syncSubmoduleUrl" class="fork-sync-check fork-sync-indent-single">
        {{ t('createDlg.remote.syncSubmodule') }}
      </el-checkbox>
      <div class="fork-sync-test-link-wrap">
        <el-button
          type="primary"
          link
          :loading="remoteTestBusy"
          :disabled="!remoteUrlInput.trim()"
          @click="testRemote"
        >
          {{ t('createDlg.remote.testConnection') }}
        </el-button>
      </div>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button type="primary" :disabled="!canAddRemote" :loading="remoteBusy" @click="submitRemote">
          {{ remoteSubmitLabel }}
        </el-button>
        <el-button @click="remoteDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 创建标签 -->
  <el-dialog
    v-model="tagDialogOpen"
    width="480px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path fill="currentColor" :d="forkSvg.d" />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('createDlg.tag.title') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('createDlg.tag.sub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-at-row">
        <span class="fork-sync-at-label">{{ t('createDlg.tag.at') }}</span>
        <el-icon class="fork-sync-at-ico"><Share /></el-icon>
        <span class="fork-sync-at-name">{{ branchStartLabel }}</span>
      </div>
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('createDlg.tag.nameLabel') }}</label>
        <el-input v-model="tagName" class="fork-sync-field" :placeholder="t('createDlg.tag.namePh')" clearable>
          <template #prefix>
            <el-icon><PriceTag /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="fork-sync-row fork-sync-row-msg">
        <label class="fork-sync-label">{{ t('createDlg.tag.messageLabel') }}</label>
        <el-input
          v-model="tagMessage"
          type="textarea"
          :rows="3"
          class="fork-sync-field"
          :placeholder="t('createDlg.tag.messagePh')"
        />
      </div>
      <el-checkbox v-model="tagPush" class="fork-sync-check fork-sync-indent-single">
        {{ t('createDlg.tag.pushTo', { remote: pushRemoteName }) }}
      </el-checkbox>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button type="primary" :disabled="!canCreateTag" :loading="tagBusy" @click="submitTag">
          {{ t('createDlg.tag.create') }}
        </el-button>
        <el-button @click="tagDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>

  <!-- 添加子模块 -->
  <el-dialog
    v-model="submoduleDialogOpen"
    width="500px"
    class="fork-sync-dialog"
    align-center
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <template #header>
      <div class="fork-sync-dlg-head">
        <div class="fork-sync-dlg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-sync-dlg-fork-svg">
            <path fill="currentColor" :d="forkSvg.d" />
          </svg>
        </div>
        <div class="fork-sync-dlg-titles">
          <div class="fork-sync-dlg-title">{{ t('createDlg.submodule.title') }}</div>
          <div class="fork-sync-dlg-sub">{{ t('createDlg.submodule.sub') }}</div>
        </div>
      </div>
    </template>
    <div class="fork-sync-dlg-body">
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('createDlg.submodule.urlLabel') }}</label>
        <el-input v-model="submoduleUrl" class="fork-sync-field" :placeholder="t('createDlg.submodule.urlPh')" clearable>
          <template #prefix>
            <el-icon><Link /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="fork-sync-row">
        <label class="fork-sync-label">{{ t('createDlg.submodule.pathLabel') }}</label>
        <el-input v-model="submodulePath" class="fork-sync-field" :placeholder="t('createDlg.submodule.pathPh')" clearable>
          <template #prefix>
            <el-icon><FolderOpened /></el-icon>
          </template>
        </el-input>
      </div>
      <el-checkbox v-model="submoduleRecursive" class="fork-sync-check fork-sync-indent-single">
        {{ t('createDlg.submodule.recursive') }}
      </el-checkbox>
    </div>
    <template #footer>
      <div class="fork-sync-dlg-footer">
        <el-button
          type="primary"
          :disabled="!canAddSubmodule"
          :loading="submoduleBusy"
          @click="submitSubmodule"
        >
          {{ t('createDlg.submodule.addBtn') }}
        </el-button>
        <el-button @click="submoduleDialogOpen = false">{{ t('common.cancel') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>
