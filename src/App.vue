<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Minus, FullScreen, Close } from '@element-plus/icons-vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { useDismissContextMenusOnOutside } from './composables/useDismissContextMenusOnOutside.ts'
import { useGitWorkspace } from './composables/useGitWorkspace.ts'
import AppMenuBar from './components/AppMenuBar.vue'
import AppRibbon from './components/AppRibbon.vue'
import SyncDialogs from './components/SyncDialogs.vue'
import AdvancedGitDialogs from './components/AdvancedGitDialogs.vue'
import CloneRepoDialog from './components/CloneRepoDialog.vue'
import TagDeleteDialog from './components/TagDeleteDialog.vue'
import GitOperationBanner from './components/GitOperationBanner.vue'
import RepoTabsBar from './components/RepoTabsBar.vue'
import AppHeader from './components/AppHeader.vue'
import ForkSidebar from './components/ForkSidebar.vue'
import ChangesView from './components/ChangesView.vue'
import HistoryView from './components/HistoryView.vue'
import WelcomeView from './components/WelcomeView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import StashDetailDialog from './components/StashDetailDialog.vue'
import ResizableSplit from './components/common/ResizableSplit.vue'

const {
  loadError,
  repoPath,
  activeView,
  canControlWindow,
  headerAppearanceDark,
  setHeaderThemeDark,
  winMinimize,
  winMaximize,
  winClose
} = useGitWorkspace()

const gitMmEnabled = import.meta.env.VITE_ENABLE_GIT_MM !== 'false'

function openGitMmBetaWindow() {
  void window.gitMm.openWindow()
}

const { locale, t } = useI18n()
const elementLocale = computed(() => (locale.value === 'en-US' ? en : zhCn))

useDismissContextMenusOnOutside()
</script>

<template>
  <el-config-provider :locale="elementLocale">
  <el-container class="fork-app-root" direction="vertical">
    <!-- 菜单行 → 功能区（三栏）→ 仓库标签 -->
    <div class="fork-top-chrome">
      <div class="fork-menu-row">
        <AppMenuBar />
        <div class="fork-menu-row-fill drag-region" aria-hidden="true" />
        <div class="fork-menu-row-trailing no-drag">
          <el-button
            v-if="gitMmEnabled"
            class="fork-git-mm-launch-btn"
            size="small"
            text
            type="primary"
            :title="t('app.gitMmLaunchTitle')"
            @click="openGitMmBetaWindow"
          >
            {{ t('app.gitMmLaunch') }}
          </el-button>
          <div class="fork-header-theme-switch-wrap" :title="t('app.themeSwitchTitle')">
            <el-switch
              :model-value="headerAppearanceDark"
              size="small"
              inline-prompt
              :active-text="t('app.themeDark')"
              :inactive-text="t('app.themeLight')"
              @change="setHeaderThemeDark"
            />
          </div>
          <div v-if="canControlWindow" class="fork-outer-win">
            <el-button text class="win-btn" :title="t('app.winMin')" @click="winMinimize">
              <el-icon :size="12"><Minus /></el-icon>
            </el-button>
            <el-button text class="win-btn" :title="t('app.winMax')" @click="winMaximize">
              <el-icon :size="12"><FullScreen /></el-icon>
            </el-button>
            <el-button text class="win-btn win-close" :title="t('app.winClose')" @click="winClose">
              <el-icon :size="12"><Close /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
      <AppRibbon />
      <SyncDialogs />
      <AdvancedGitDialogs />
      <CloneRepoDialog />
      <TagDeleteDialog />
      <SettingsDialog />
      <StashDetailDialog />
      <RepoTabsBar />
    </div>

    <el-alert
      v-if="loadError"
      class="fork-load-alert"
      type="error"
      :title="loadError"
      show-icon
      :closable="false"
    />

    <GitOperationBanner />

    <template v-if="repoPath">
      <ResizableSplit
        class="fork-shell fork-shell-split"
        storage-key="fork-layout-main-shell"
        :default-primary-percent="21"
        :min-primary-percent="14"
        :max-primary-percent="42"
      >
        <template #left>
          <ForkSidebar />
        </template>
        <template #right>
          <el-container direction="vertical" class="fork-right">
            <AppHeader />
            <el-main class="fork-main">
              <ChangesView v-show="activeView === 'changes'" class="fork-main-view" />
              <HistoryView v-show="activeView === 'history'" class="fork-main-view" />
            </el-main>
          </el-container>
        </template>
      </ResizableSplit>
    </template>
    <el-container v-else class="fork-shell" direction="horizontal">
      <el-container direction="vertical" class="fork-right">
        <AppHeader />
        <el-main class="fork-main">
          <WelcomeView />
        </el-main>
      </el-container>
    </el-container>
  </el-container>
  </el-config-provider>
</template>
