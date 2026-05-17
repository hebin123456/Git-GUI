import { ref } from 'vue'
import type { ForkRemoteRow } from './useGitWorkspace.ts'

export const branchDialogOpen = ref(false)
export const newBranchName = ref('')
export const checkoutAfterCreate = ref(true)

export const remoteDialogOpen = ref(false)
export const remoteEditMode = ref(false)
export const remoteOriginalName = ref('')
export const remoteName = ref('origin')
export const remoteUrlInput = ref('')
export const remoteProto = ref<'https' | 'ssh'>('https')
export const syncSubmoduleUrl = ref(true)

export const tagDialogOpen = ref(false)
export const tagName = ref('')
export const tagMessage = ref('')
export const tagPush = ref(false)

export const submoduleDialogOpen = ref(false)
export const submoduleUrl = ref('')
export const submodulePath = ref('')
export const submoduleRecursive = ref(false)

function parseRemoteUrlForForm(url: string): { proto: 'https' | 'ssh'; input: string } {
  const u = String(url ?? '').trim()
  if (!u) return { proto: 'https', input: '' }
  if (/^https?:\/\//i.test(u)) return { proto: 'https', input: u.replace(/^https?:\/\//i, '') }
  if (/^git@/i.test(u)) return { proto: 'ssh', input: u.replace(/^git@/i, '') }
  if (/^ssh:\/\//i.test(u)) return { proto: 'ssh', input: u.replace(/^ssh:\/\//i, '') }
  return { proto: 'https', input: u }
}

export function openNewBranch() {
  newBranchName.value = ''
  checkoutAfterCreate.value = true
  branchDialogOpen.value = true
}

export function openAddRemote() {
  remoteEditMode.value = false
  remoteOriginalName.value = ''
  remoteName.value = 'origin'
  remoteUrlInput.value = ''
  remoteProto.value = 'https'
  syncSubmoduleUrl.value = true
  remoteDialogOpen.value = true
}

export function openEditRemote(rm: ForkRemoteRow) {
  remoteEditMode.value = true
  remoteOriginalName.value = rm.name.trim()
  remoteName.value = rm.name.trim()
  const { proto, input } = parseRemoteUrlForForm(rm.fetchUrl || rm.pushUrl || '')
  remoteProto.value = proto
  remoteUrlInput.value = input
  syncSubmoduleUrl.value = true
  remoteDialogOpen.value = true
}

export function openCreateTag() {
  tagName.value = ''
  tagMessage.value = ''
  tagPush.value = false
  tagDialogOpen.value = true
}

export function openAddSubmodule() {
  submoduleUrl.value = ''
  submodulePath.value = ''
  submoduleRecursive.value = false
  submoduleDialogOpen.value = true
}
