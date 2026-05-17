<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'
import {
  branchDialogOpen,
  checkoutAfterCreate,
  newBranchName,
  remoteDialogOpen,
  remoteEditMode,
  remoteName,
  remoteOriginalName,
  remoteProto,
  remoteUrlInput,
  submoduleDialogOpen,
  submodulePath,
  submoduleRecursive,
  submoduleUrl,
  syncSubmoduleUrl,
  tagDialogOpen,
  tagMessage,
  tagName,
  tagPush
} from '../composables/useSidebarCreateDialogs.ts'

const api = window.gitClient
const { t, locale } = useI18n()

const { currentBranch, remotes, preferredRemoteName, refreshAll, applyRemoteRenameSelection } =
  useGitWorkspace()

const forkSvg = {
  d: 'M8 3v6c0 1.1.9 2 2 2h.5c.3 0 .5.2.5.5V19a1 1 0 102 0v-7.5c0-.3.2-.5.5-.5H14a2 2 0 002-2V3h-2v6h-1V3h-2v6h-1V3H8zm10 8a2 2 0 00-2 2v4a2 2 0 104 0v-4a2 2 0 00-2-2z'
}

const branchBusy = ref(false)

const remoteBusy = ref(false)
const remoteTestBusy = ref(false)

const tagBusy = ref(false)

const submoduleBusy = ref(false)

const branchStartLabel = computed(() => {
  void locale.value
  const c = currentBranch.value?.trim()
  return c || t('createDlg.branch.headDetached')
})

const branchStartRef = computed(() => (currentBranch.value?.trim() ? currentBranch.value.trim() : 'HEAD'))

const tagAtRef = computed(() => branchStartRef.value)

const pushRemoteName = computed(() => preferredRemoteName.value || remotes.value[0] || 'origin')

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
  <Teleport to="body">
    <div v-if="branchDialogOpen" class="fork-native-modal-overlay" @click.self="branchDialogOpen = false">
      <form class="fork-native-modal" @submit.prevent="submitBranch">
        <div class="fork-native-modal-head">
          <div class="fork-native-modal-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path fill="currentColor" :d="forkSvg.d" /></svg>
          </div>
          <div>
            <h2>{{ t('createDlg.branch.title') }}</h2>
            <p>{{ t('createDlg.branch.sub') }}</p>
          </div>
        </div>
        <div class="fork-native-modal-body">
          <div class="fork-native-ref">{{ t('createDlg.branch.createOn') }}: {{ branchStartLabel }}</div>
          <label class="fork-native-field">
            <span>{{ t('createDlg.branch.nameLabel') }}</span>
            <input v-model="newBranchName" type="text" :placeholder="t('createDlg.branch.namePh')" autofocus />
          </label>
          <label class="fork-native-check">
            <input v-model="checkoutAfterCreate" type="checkbox" />
            <span>{{ t('createDlg.branch.checkoutAfter') }}</span>
          </label>
        </div>
        <div class="fork-native-modal-foot">
          <button type="submit" class="fork-native-primary" :disabled="!canCreateBranch || branchBusy">
            {{ branchBusy ? t('dialogs.loading') : t('createDlg.branch.create') }}
          </button>
          <button type="button" @click="branchDialogOpen = false">{{ t('common.cancel') }}</button>
        </div>
      </form>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="remoteDialogOpen" class="fork-native-modal-overlay" @click.self="remoteDialogOpen = false">
      <form class="fork-native-modal fork-native-modal--wide" @submit.prevent="submitRemote">
        <div class="fork-native-modal-head">
          <div class="fork-native-modal-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path fill="currentColor" :d="forkSvg.d" /></svg>
          </div>
          <div>
            <h2>{{ remoteDialogTitle }}</h2>
            <p>{{ remoteDialogSub }}</p>
          </div>
        </div>
        <div class="fork-native-modal-body">
          <label class="fork-native-field">
            <span>{{ t('createDlg.remote.nameLabel') }}</span>
            <input v-model="remoteName" type="text" placeholder="origin" autofocus />
          </label>
          <label class="fork-native-field">
            <span>{{ t('createDlg.remote.urlLabel') }}</span>
            <div class="fork-native-inline">
              <input v-model="remoteUrlInput" type="text" :placeholder="t('createDlg.remote.urlPh')" />
              <select v-model="remoteProto" :aria-label="t('createDlg.remote.protoAria')">
                <option value="https">HTTPS</option>
                <option value="ssh">SSH</option>
              </select>
            </div>
          </label>
          <div class="fork-native-hint">{{ t('createDlg.remote.urlHint') }}</div>
          <label class="fork-native-check">
            <input v-model="syncSubmoduleUrl" type="checkbox" />
            <span>{{ t('createDlg.remote.syncSubmodule') }}</span>
          </label>
          <button type="button" class="fork-native-link" :disabled="!remoteUrlInput.trim() || remoteTestBusy" @click="testRemote">
            {{ remoteTestBusy ? t('dialogs.loading') : t('createDlg.remote.testConnection') }}
          </button>
        </div>
        <div class="fork-native-modal-foot">
          <button type="submit" class="fork-native-primary" :disabled="!canAddRemote || remoteBusy">
            {{ remoteBusy ? t('dialogs.loading') : remoteSubmitLabel }}
          </button>
          <button type="button" @click="remoteDialogOpen = false">{{ t('common.cancel') }}</button>
        </div>
      </form>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="tagDialogOpen" class="fork-native-modal-overlay" @click.self="tagDialogOpen = false">
      <form class="fork-native-modal" @submit.prevent="submitTag">
        <div class="fork-native-modal-head">
          <div class="fork-native-modal-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path fill="currentColor" :d="forkSvg.d" /></svg>
          </div>
          <div>
            <h2>{{ t('createDlg.tag.title') }}</h2>
            <p>{{ t('createDlg.tag.sub') }}</p>
          </div>
        </div>
        <div class="fork-native-modal-body">
          <div class="fork-native-ref">{{ t('createDlg.tag.at') }}: {{ branchStartLabel }}</div>
          <label class="fork-native-field">
            <span>{{ t('createDlg.tag.nameLabel') }}</span>
            <input v-model="tagName" type="text" :placeholder="t('createDlg.tag.namePh')" autofocus />
          </label>
          <label class="fork-native-field">
            <span>{{ t('createDlg.tag.messageLabel') }}</span>
            <textarea v-model="tagMessage" rows="3" :placeholder="t('createDlg.tag.messagePh')" />
          </label>
          <label class="fork-native-check">
            <input v-model="tagPush" type="checkbox" />
            <span>{{ t('createDlg.tag.pushTo', { remote: pushRemoteName }) }}</span>
          </label>
        </div>
        <div class="fork-native-modal-foot">
          <button type="submit" class="fork-native-primary" :disabled="!canCreateTag || tagBusy">
            {{ tagBusy ? t('dialogs.loading') : t('createDlg.tag.create') }}
          </button>
          <button type="button" @click="tagDialogOpen = false">{{ t('common.cancel') }}</button>
        </div>
      </form>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="submoduleDialogOpen" class="fork-native-modal-overlay" @click.self="submoduleDialogOpen = false">
      <form class="fork-native-modal fork-native-modal--wide" @submit.prevent="submitSubmodule">
        <div class="fork-native-modal-head">
          <div class="fork-native-modal-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path fill="currentColor" :d="forkSvg.d" /></svg>
          </div>
          <div>
            <h2>{{ t('createDlg.submodule.title') }}</h2>
            <p>{{ t('createDlg.submodule.sub') }}</p>
          </div>
        </div>
        <div class="fork-native-modal-body">
          <label class="fork-native-field">
            <span>{{ t('createDlg.submodule.urlLabel') }}</span>
            <input v-model="submoduleUrl" type="text" :placeholder="t('createDlg.submodule.urlPh')" autofocus />
          </label>
          <label class="fork-native-field">
            <span>{{ t('createDlg.submodule.pathLabel') }}</span>
            <input v-model="submodulePath" type="text" :placeholder="t('createDlg.submodule.pathPh')" />
          </label>
          <label class="fork-native-check">
            <input v-model="submoduleRecursive" type="checkbox" />
            <span>{{ t('createDlg.submodule.recursive') }}</span>
          </label>
        </div>
        <div class="fork-native-modal-foot">
          <button type="submit" class="fork-native-primary" :disabled="!canAddSubmodule || submoduleBusy">
            {{ submoduleBusy ? t('dialogs.loading') : t('createDlg.submodule.addBtn') }}
          </button>
          <button type="button" @click="submoduleDialogOpen = false">{{ t('common.cancel') }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
