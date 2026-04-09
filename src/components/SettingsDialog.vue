<script setup lang="ts">
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
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const { settingsDialogOpen, persistAppSettings, clearPersistedWorkspaceOnly } = useGitWorkspace()

const activeTab = ref<'appearance' | 'diff' | 'tools' | 'performance' | 'data'>('appearance')
const form = ref<PersistedAppSettingsV1>(loadAppSettings())

watch(settingsDialogOpen, (o) => {
  if (o) {
    form.value = { ...loadAppSettings() }
    activeTab.value = 'appearance'
  }
})

function onSave() {
  persistAppSettings(form.value)
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

function resetToolsDefaults() {
  form.value = {
    ...form.value,
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
</script>

<template>
  <el-dialog
    v-model="settingsDialogOpen"
    :title="t('settings.title')"
    width="min(560px, 94vw)"
    class="fork-settings-dlg"
    align-center
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

      <el-tab-pane :label="t('settings.tools')" name="tools">
        <p class="fork-settings-lead">{{ t('settings.toolsLead') }}</p>
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
          <el-button size="small" text type="primary" @click="resetToolsDefaults">{{
            t('settings.resetToolsDefaults')
          }}</el-button>
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
      <el-button type="primary" @click="onSave">{{ t('common.save') }}</el-button>
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
</style>
