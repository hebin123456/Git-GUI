<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  loadAppSettings,
  DEFAULT_APP_SETTINGS,
  type AppUiLocale,
  type MergeToolPreset,
  type PersistedAppSettingsV1,
  type ThemeMode
} from '../utils/appSettingsStorage.ts'
import type { GitConfigEntry } from '../types/git-client.ts'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const { settingsDialogOpen, persistAppSettings, clearPersistedWorkspaceOnly, repoPath } = useGitWorkspace()

type GitConfigBoolish = '' | 'true' | 'false'
type GitConfigAutocrlfValue = GitConfigBoolish | 'input'
type GitConfigEditorForm = {
  userName: string
  userEmail: string
  initDefaultBranch: string
  coreAutocrlf: GitConfigAutocrlfValue
  pullRebase: GitConfigBoolish
  pushAutoSetupRemote: GitConfigBoolish
  credentialHelper: string
}

const GLOBAL_GIT_CONFIG_KEYS = [
  'user.name',
  'user.email',
  'init.defaultBranch',
  'core.autocrlf',
  'pull.rebase',
  'push.autoSetupRemote',
  'credential.helper'
] as const
const LOCAL_GIT_CONFIG_KEYS = [
  'user.name',
  'user.email',
  'core.autocrlf',
  'pull.rebase',
  'push.autoSetupRemote',
  'credential.helper'
] as const

const activeTab = ref<'appearance' | 'diff' | 'git' | 'gitConfig' | 'performance' | 'data'>('appearance')
const form = ref<PersistedAppSettingsV1>(loadAppSettings())
const gitConfigGlobalForm = ref<GitConfigEditorForm>(emptyGitConfigEditorForm())
const gitConfigLocalForm = ref<GitConfigEditorForm>(emptyGitConfigEditorForm())
const gitConfigLoading = ref(false)
const gitConfigSaving = ref(false)
const gitConfigLoadError = ref('')
const hasLocalGitConfig = computed(() => !!repoPath.value)
let gitConfigLoadSeq = 0

watch(settingsDialogOpen, (o) => {
  if (o) {
    form.value = { ...loadAppSettings() }
    activeTab.value = 'appearance'
    void loadGitConfigForms()
  }
})

watch(
  () => repoPath.value,
  () => {
    if (settingsDialogOpen.value) void loadGitConfigForms()
  }
)

async function onSave() {
  gitConfigSaving.value = true
  try {
    const globalRes = await window.gitClient.gitConfigSetMany({
      scope: 'global',
      entries: buildGitConfigSetEntries('global', gitConfigGlobalForm.value)
    })
    if ('error' in globalRes) {
      ElMessage.error(globalRes.error)
      return
    }
    if (hasLocalGitConfig.value) {
      const localRes = await window.gitClient.gitConfigSetMany({
        scope: 'local',
        entries: buildGitConfigSetEntries('local', gitConfigLocalForm.value)
      })
      if ('error' in localRes) {
        ElMessage.error(localRes.error)
        return
      }
    }
    persistAppSettings(form.value)
  } finally {
    gitConfigSaving.value = false
  }
}

function resetDiffDefaults() {
  form.value = {
    ...form.value,
    diffDefaultFormat: DEFAULT_APP_SETTINGS.diffDefaultFormat,
    diffDefaultContextLines: DEFAULT_APP_SETTINGS.diffDefaultContextLines,
    diffDefaultIgnoreBlankLines: DEFAULT_APP_SETTINGS.diffDefaultIgnoreBlankLines,
    diffDefaultIgnoreWhitespace: DEFAULT_APP_SETTINGS.diffDefaultIgnoreWhitespace,
    diffDefaultShowFullFile: DEFAULT_APP_SETTINGS.diffDefaultShowFullFile
  }
}

function resetHistoryPerfDefault() {
  form.value = { ...form.value, historyMaxCommits: DEFAULT_APP_SETTINGS.historyMaxCommits }
}

function resetGitDefaults() {
  form.value = {
    ...form.value,
    gitDefaultRemoteName: DEFAULT_APP_SETTINGS.gitDefaultRemoteName,
    gitPullRebaseDefault: DEFAULT_APP_SETTINGS.gitPullRebaseDefault,
    gitPullAutostashDefault: DEFAULT_APP_SETTINGS.gitPullAutostashDefault,
    gitPushSetUpstreamDefault: DEFAULT_APP_SETTINGS.gitPushSetUpstreamDefault,
    customGitShellPath: DEFAULT_APP_SETTINGS.customGitShellPath,
    mergeToolPreset: DEFAULT_APP_SETTINGS.mergeToolPreset,
    mergeToolExecutablePath: DEFAULT_APP_SETTINGS.mergeToolExecutablePath
  }
}

const mergeToolOptions = computed(() => {
  const opts: { value: MergeToolPreset; label: string }[] = [
    { value: 'default', label: t('settings.mergeToolDefault') },
    { value: 'bc4', label: t('settings.mergeToolBc4') },
    { value: 'bc3', label: t('settings.mergeToolBc3') },
    { value: 'winmerge', label: t('settings.mergeToolWinmerge') }
  ]
  return opts
})

function resetThemeDefault() {
  form.value = { ...form.value, theme: DEFAULT_APP_SETTINGS.theme }
}

function resetUiLocaleDefault() {
  form.value = { ...form.value, uiLocale: DEFAULT_APP_SETTINGS.uiLocale }
}

async function pickGitShellExecutable() {
  const p = await window.gitClient.selectExecutable()
  if (p) form.value.customGitShellPath = p
}

async function pickMergeToolExecutable() {
  const p = await window.gitClient.selectExecutable()
  if (p) form.value.mergeToolExecutablePath = p
}

const themeOptions = computed(() => {
  const opts: { value: ThemeMode; label: string; hint: string }[] = [
    { value: 'light', label: t('settings.themeLight'), hint: t('settings.themeLightHint') },
    { value: 'dark', label: t('settings.themeDark'), hint: t('settings.themeDarkHint') },
    { value: 'system', label: t('settings.themeSystem'), hint: t('settings.themeSystemHint') }
  ]
  return opts
})

const localeOptions = computed(() => [
  { value: 'zh-CN' as AppUiLocale, label: t('settings.langZh') },
  { value: 'en-US' as AppUiLocale, label: t('settings.langEn') }
])

const gitConfigBoolOptions = computed(() => [
  { value: '' as GitConfigBoolish, label: t('settings.gitConfigUnset') },
  { value: 'true' as GitConfigBoolish, label: t('settings.gitConfigTrue') },
  { value: 'false' as GitConfigBoolish, label: t('settings.gitConfigFalse') }
])

const gitConfigAutocrlfOptions = computed(() => [
  { value: '' as GitConfigAutocrlfValue, label: t('settings.gitConfigUnset') },
  { value: 'true' as GitConfigAutocrlfValue, label: t('settings.gitConfigTrue') },
  { value: 'input' as GitConfigAutocrlfValue, label: t('settings.gitConfigInput') },
  { value: 'false' as GitConfigAutocrlfValue, label: t('settings.gitConfigFalse') }
])

function emptyGitConfigEditorForm(): GitConfigEditorForm {
  return {
    userName: '',
    userEmail: '',
    initDefaultBranch: '',
    coreAutocrlf: '',
    pullRebase: '',
    pushAutoSetupRemote: '',
    credentialHelper: ''
  }
}

function parseGitConfigBoolish(raw: string | undefined): GitConfigBoolish {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'true' || v === 'false' ? v : ''
}

function parseGitConfigAutocrlf(raw: string | undefined): GitConfigAutocrlfValue {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'true' || v === 'false' || v === 'input' ? v : ''
}

function mapGitConfigEntries(entries: GitConfigEntry[]): GitConfigEditorForm {
  const byKey = new Map(entries.map((entry) => [entry.key, entry.value]))
  return {
    userName: byKey.get('user.name') ?? '',
    userEmail: byKey.get('user.email') ?? '',
    initDefaultBranch: byKey.get('init.defaultBranch') ?? '',
    coreAutocrlf: parseGitConfigAutocrlf(byKey.get('core.autocrlf')),
    pullRebase: parseGitConfigBoolish(byKey.get('pull.rebase')),
    pushAutoSetupRemote: parseGitConfigBoolish(byKey.get('push.autoSetupRemote')),
    credentialHelper: byKey.get('credential.helper') ?? ''
  }
}

function buildGitConfigSetEntries(
  scope: 'global' | 'local',
  cfg: GitConfigEditorForm
): { key: string; value: string | null }[] {
  const out: { key: string; value: string | null }[] = [
    { key: 'user.name', value: cfg.userName.trim() || null },
    { key: 'user.email', value: cfg.userEmail.trim() || null },
    { key: 'core.autocrlf', value: cfg.coreAutocrlf || null },
    { key: 'pull.rebase', value: cfg.pullRebase || null },
    { key: 'push.autoSetupRemote', value: cfg.pushAutoSetupRemote || null },
    { key: 'credential.helper', value: cfg.credentialHelper.trim() || null }
  ]
  if (scope === 'global') {
    out.splice(2, 0, { key: 'init.defaultBranch', value: cfg.initDefaultBranch.trim() || null })
  }
  return out
}

async function loadGitConfigForms() {
  const seq = ++gitConfigLoadSeq
  gitConfigLoading.value = true
  gitConfigLoadError.value = ''
  const localFallback = { entries: [] as GitConfigEntry[] }
  try {
    const [globalRes, localRes] = await Promise.all([
      window.gitClient.gitConfigGetMany({ scope: 'global', keys: [...GLOBAL_GIT_CONFIG_KEYS] }),
      hasLocalGitConfig.value
        ? window.gitClient.gitConfigGetMany({ scope: 'local', keys: [...LOCAL_GIT_CONFIG_KEYS] })
        : Promise.resolve(localFallback)
    ])
    if (seq !== gitConfigLoadSeq) return
    if ('error' in globalRes) {
      gitConfigGlobalForm.value = emptyGitConfigEditorForm()
      gitConfigLoadError.value = globalRes.error
    } else {
      gitConfigGlobalForm.value = mapGitConfigEntries(globalRes.entries)
    }
    if (!hasLocalGitConfig.value) {
      gitConfigLocalForm.value = emptyGitConfigEditorForm()
      return
    }
    if ('error' in localRes) {
      gitConfigLocalForm.value = emptyGitConfigEditorForm()
      gitConfigLoadError.value = gitConfigLoadError.value || localRes.error
    } else {
      gitConfigLocalForm.value = mapGitConfigEntries(localRes.entries)
    }
  } finally {
    if (seq === gitConfigLoadSeq) gitConfigLoading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="settingsDialogOpen"
    :title="t('settings.title')"
    width="min(920px, 94vw)"
    class="fork-settings-dlg"
    top="4vh"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <el-tabs v-model="activeTab" class="fork-settings-tabs">
      <el-tab-pane :label="t('settings.appearance')" name="appearance">
        <p class="fork-settings-lead">{{ t('settings.appearanceLead') }}</p>
        <div class="fork-settings-field">
          <span class="fork-settings-label">{{ t('settings.language') }}</span>
          <el-select v-model="form.uiLocale" class="fork-settings-control">
            <el-option v-for="opt in localeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </div>
        <div class="fork-settings-actions-inline">
          <el-button size="small" text type="primary" @click="resetUiLocaleDefault">{{
            t('settings.resetUiLocale')
          }}</el-button>
        </div>
        <el-radio-group v-model="form.theme" class="fork-settings-theme-group">
          <div v-for="opt in themeOptions" :key="opt.value" class="fork-settings-theme-row">
            <el-radio :value="opt.value">{{ opt.label }}</el-radio>
            <span class="fork-settings-theme-hint">{{ opt.hint }}</span>
          </div>
        </el-radio-group>
        <div class="fork-settings-actions-inline">
          <el-button size="small" text type="primary" @click="resetThemeDefault">{{
            t('settings.resetTheme')
          }}</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.diff')" name="diff">
        <p class="fork-settings-lead">{{ t('settings.diffLead') }}</p>
        <div class="fork-settings-field">
          <span class="fork-settings-label">{{ t('settings.diffView') }}</span>
          <el-select v-model="form.diffDefaultFormat" class="fork-settings-control">
            <el-option :label="t('settings.diffSideBySide')" value="side-by-side" />
            <el-option :label="t('settings.diffLineByLine')" value="line-by-line" />
          </el-select>
        </div>
        <div class="fork-settings-field">
          <span class="fork-settings-label">{{ t('settings.contextLines') }}</span>
          <el-input-number
            v-model="form.diffDefaultContextLines"
            :min="0"
            :max="50"
            :step="1"
            controls-position="right"
            class="fork-settings-control-num"
          />
          <span class="fork-settings-suffix">{{ t('settings.contextLinesSuffix') }}</span>
        </div>
        <div class="fork-settings-checks">
          <el-checkbox v-model="form.diffDefaultIgnoreBlankLines">{{ t('changes.ignoreBlankLines') }}</el-checkbox>
          <el-checkbox v-model="form.diffDefaultIgnoreWhitespace">{{ t('changes.ignoreWhitespace') }}</el-checkbox>
          <el-checkbox v-model="form.diffDefaultShowFullFile">{{ t('changes.fullFile') }}</el-checkbox>
        </div>
        <div class="fork-settings-actions-inline">
          <el-button size="small" text type="primary" @click="resetDiffDefaults">{{
            t('settings.resetDiffDefaults')
          }}</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.git')" name="git">
        <p class="fork-settings-lead">{{ t('settings.gitLead') }}</p>
        <div class="fork-settings-section-title">{{ t('settings.gitDefaultsTitle') }}</div>
        <div class="fork-settings-field fork-settings-field-block">
          <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitDefaultRemoteName') }}</span>
          <div class="fork-settings-path-row">
            <el-input
              v-model="form.gitDefaultRemoteName"
              class="fork-settings-control-wide"
              clearable
              :placeholder="t('settings.gitDefaultRemoteNamePlaceholder')"
            />
          </div>
        </div>
        <p class="fork-settings-hint">{{ t('settings.gitDefaultRemoteNameHint') }}</p>
        <div class="fork-settings-checks">
          <el-checkbox v-model="form.gitPullRebaseDefault">{{ t('settings.gitPullRebaseDefault') }}</el-checkbox>
          <el-checkbox v-model="form.gitPullAutostashDefault">{{
            t('settings.gitPullAutostashDefault')
          }}</el-checkbox>
          <el-checkbox v-model="form.gitPushSetUpstreamDefault">{{
            t('settings.gitPushSetUpstreamDefault')
          }}</el-checkbox>
        </div>
        <div class="fork-settings-section-title">{{ t('settings.gitToolsTitle') }}</div>
        <div class="fork-settings-field fork-settings-field-block">
          <span class="fork-settings-label fork-settings-label-top">{{ t('settings.customGitShellPath') }}</span>
          <div class="fork-settings-path-row">
            <el-input
              v-model="form.customGitShellPath"
              class="fork-settings-control-wide"
              clearable
              :placeholder="t('settings.customGitShellPathPlaceholder')"
            />
            <el-button @click="pickGitShellExecutable">{{ t('settings.browseExecutable') }}</el-button>
          </div>
        </div>
        <p class="fork-settings-hint">{{ t('settings.customGitShellPathHint') }}</p>
        <div class="fork-settings-field">
          <span class="fork-settings-label">{{ t('settings.mergeToolPreset') }}</span>
          <el-select v-model="form.mergeToolPreset" class="fork-settings-control">
            <el-option v-for="opt in mergeToolOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </div>
        <div class="fork-settings-field fork-settings-field-block">
          <span class="fork-settings-label fork-settings-label-top">{{ t('settings.mergeToolExecutablePath') }}</span>
          <div class="fork-settings-path-row">
            <el-input
              v-model="form.mergeToolExecutablePath"
              class="fork-settings-control-wide"
              clearable
              :placeholder="t('settings.mergeToolExecutablePathPlaceholder')"
            />
            <el-button @click="pickMergeToolExecutable">{{ t('settings.browseExecutable') }}</el-button>
          </div>
        </div>
        <p class="fork-settings-hint">{{ t('settings.mergeToolExecutablePathHint') }}</p>
        <div class="fork-settings-actions-inline">
          <el-button size="small" text type="primary" @click="resetGitDefaults">{{
            t('settings.resetGitDefaults')
          }}</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.gitConfigTitle')" name="gitConfig">
        <p class="fork-settings-lead">{{ t('settings.gitConfigLead') }}</p>
        <p class="fork-settings-hint">{{ t('settings.gitConfigUnsetHint') }}</p>
        <el-alert
          v-if="gitConfigLoadError"
          type="warning"
          :closable="false"
          class="fork-settings-config-alert"
          :title="t('settings.gitConfigLoadFailed', { error: gitConfigLoadError })"
        />
        <div v-if="gitConfigLoading" class="fork-settings-hint">{{ t('common.loading') }}</div>
        <div v-else class="fork-settings-config-panels">
          <section class="fork-settings-config-card">
            <div class="fork-settings-config-head">
              <span class="fork-settings-config-title">{{ t('settings.gitConfigGlobal') }}</span>
              <span class="fork-settings-config-subtitle">{{ t('settings.gitConfigGlobalHint') }}</span>
            </div>
            <div class="fork-settings-field fork-settings-field-block">
              <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitConfigUserName') }}</span>
              <el-input v-model="gitConfigGlobalForm.userName" class="fork-settings-control-wide" clearable />
            </div>
            <div class="fork-settings-field fork-settings-field-block">
              <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitConfigUserEmail') }}</span>
              <el-input v-model="gitConfigGlobalForm.userEmail" class="fork-settings-control-wide" clearable />
            </div>
            <div class="fork-settings-field fork-settings-field-block">
              <span class="fork-settings-label fork-settings-label-top">{{
                t('settings.gitConfigInitDefaultBranch')
              }}</span>
              <el-input v-model="gitConfigGlobalForm.initDefaultBranch" class="fork-settings-control-wide" clearable />
            </div>
            <div class="fork-settings-field">
              <span class="fork-settings-label">{{ t('settings.gitConfigCoreAutocrlf') }}</span>
              <el-select v-model="gitConfigGlobalForm.coreAutocrlf" class="fork-settings-control">
                <el-option
                  v-for="opt in gitConfigAutocrlfOptions"
                  :key="'g-autocrlf-' + opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="fork-settings-field">
              <span class="fork-settings-label">{{ t('settings.gitConfigPullRebase') }}</span>
              <el-select v-model="gitConfigGlobalForm.pullRebase" class="fork-settings-control">
                <el-option
                  v-for="opt in gitConfigBoolOptions"
                  :key="'g-pull-' + opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="fork-settings-field">
              <span class="fork-settings-label">{{ t('settings.gitConfigPushAutoSetupRemote') }}</span>
              <el-select v-model="gitConfigGlobalForm.pushAutoSetupRemote" class="fork-settings-control">
                <el-option
                  v-for="opt in gitConfigBoolOptions"
                  :key="'g-push-' + opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </div>
            <div class="fork-settings-field fork-settings-field-block">
              <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitConfigCredentialHelper') }}</span>
              <el-input
                v-model="gitConfigGlobalForm.credentialHelper"
                class="fork-settings-control-wide"
                clearable
              />
            </div>
          </section>

          <section class="fork-settings-config-card">
            <div class="fork-settings-config-head">
              <span class="fork-settings-config-title">{{ t('settings.gitConfigLocal') }}</span>
              <span
                v-if="repoPath"
                class="fork-settings-config-path"
                :title="repoPath"
              >
                {{ repoPath }}
              </span>
              <span v-else class="fork-settings-config-subtitle">{{ t('settings.gitConfigLocalNoRepo') }}</span>
            </div>
            <template v-if="hasLocalGitConfig">
              <div class="fork-settings-field fork-settings-field-block">
                <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitConfigUserName') }}</span>
                <el-input v-model="gitConfigLocalForm.userName" class="fork-settings-control-wide" clearable />
              </div>
              <div class="fork-settings-field fork-settings-field-block">
                <span class="fork-settings-label fork-settings-label-top">{{ t('settings.gitConfigUserEmail') }}</span>
                <el-input v-model="gitConfigLocalForm.userEmail" class="fork-settings-control-wide" clearable />
              </div>
              <div class="fork-settings-field">
                <span class="fork-settings-label">{{ t('settings.gitConfigCoreAutocrlf') }}</span>
                <el-select v-model="gitConfigLocalForm.coreAutocrlf" class="fork-settings-control">
                  <el-option
                    v-for="opt in gitConfigAutocrlfOptions"
                    :key="'l-autocrlf-' + opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </div>
              <div class="fork-settings-field">
                <span class="fork-settings-label">{{ t('settings.gitConfigPullRebase') }}</span>
                <el-select v-model="gitConfigLocalForm.pullRebase" class="fork-settings-control">
                  <el-option
                    v-for="opt in gitConfigBoolOptions"
                    :key="'l-pull-' + opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </div>
              <div class="fork-settings-field">
                <span class="fork-settings-label">{{ t('settings.gitConfigPushAutoSetupRemote') }}</span>
                <el-select v-model="gitConfigLocalForm.pushAutoSetupRemote" class="fork-settings-control">
                  <el-option
                    v-for="opt in gitConfigBoolOptions"
                    :key="'l-push-' + opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </div>
              <div class="fork-settings-field fork-settings-field-block">
                <span class="fork-settings-label fork-settings-label-top">{{
                  t('settings.gitConfigCredentialHelper')
                }}</span>
                <el-input
                  v-model="gitConfigLocalForm.credentialHelper"
                  class="fork-settings-control-wide"
                  clearable
                />
              </div>
            </template>
            <p v-else class="fork-settings-hint">{{ t('settings.gitConfigLocalHint') }}</p>
          </section>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.performance')" name="performance">
        <p class="fork-settings-lead">{{ t('settings.performanceLead') }}</p>
        <div class="fork-settings-field">
          <span class="fork-settings-label">{{ t('settings.historyMax') }}</span>
          <el-input-number
            v-model="form.historyMaxCommits"
            :min="500"
            :max="50000"
            :step="500"
            controls-position="right"
            class="fork-settings-control-num"
          />
          <span class="fork-settings-suffix">{{
            t('settings.historyMaxSuffix', { n: DEFAULT_APP_SETTINGS.historyMaxCommits })
          }}</span>
        </div>
        <div class="fork-settings-actions-inline">
          <el-button size="small" text type="primary" @click="resetHistoryPerfDefault">{{
            t('settings.resetHistoryPerf')
          }}</el-button>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('settings.data')" name="data">
        <p class="fork-settings-lead">{{ t('settings.dataLead') }}</p>
        <p class="fork-settings-lead muted">{{ t('settings.dataMuted') }}</p>
        <el-button type="danger" plain @click="clearPersistedWorkspaceOnly">{{ t('settings.clearWorkspace') }}</el-button>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="settingsDialogOpen = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="gitConfigSaving" :disabled="gitConfigLoading" @click="onSave">{{
        t('common.save')
      }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fork-settings-lead {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}
.fork-settings-lead.muted {
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
}
.fork-settings-section-title {
  margin: 16px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.fork-settings-config-alert {
  margin-bottom: 12px;
}
.fork-settings-config-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.fork-settings-config-card {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
  min-width: 0;
}
.fork-settings-config-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.fork-settings-config-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.fork-settings-config-subtitle,
.fork-settings-config-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
.fork-settings-config-path {
  word-break: break-all;
}
.fork-settings-code {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.fork-settings-theme-group {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  margin-bottom: 12px;
}
.fork-settings-theme-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
}
.fork-settings-theme-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding-left: 24px;
  line-height: 1.4;
}
.fork-settings-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.fork-settings-label {
  width: 120px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.fork-settings-control {
  width: min(240px, 100%);
}
.fork-settings-control-wide {
  width: min(100%, 100%);
  flex: 1;
  min-width: 0;
}
.fork-settings-path-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.fork-settings-path-row .fork-settings-control-wide {
  flex: 1;
  min-width: 160px;
}
.fork-settings-field-block {
  align-items: flex-start;
}
.fork-settings-label-top {
  padding-top: 6px;
}
.fork-settings-hint {
  margin: -6px 0 14px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.fork-settings-control-num {
  width: 140px;
}
.fork-settings-suffix {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.fork-settings-checks {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
.fork-settings-actions-inline {
  margin-top: 8px;
}
.fork-settings-tabs :deep(.el-tabs__content) {
  padding-top: 8px;
}
.fork-settings-tabs {
  min-width: 0;
}
@media (max-width: 860px) {
  .fork-settings-config-panels {
    grid-template-columns: 1fr;
  }
}
</style>
