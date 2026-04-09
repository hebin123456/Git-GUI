<script setup lang="ts">
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const { openRepo, openCloneDialog } = useGitWorkspace()
</script>

<template>
      <el-main class="welcome-main">
        <el-empty :description="t('welcome.emptyDesc')">
          <template #image>
            <el-icon :size="72" color="var(--el-color-primary)">
              <FolderOpened />
            </el-icon>
          </template>
          <div class="welcome-actions">
            <el-button type="primary" :icon="FolderOpened" @click="openRepo">{{ t('welcome.openRepo') }}</el-button>
            <el-button :icon="Download" @click="openCloneDialog">{{ t('welcome.cloneRepo') }}</el-button>
          </div>
          <p class="welcome-tip">{{ t('welcome.tip') }}</p>
        </el-empty>
      </el-main>

</template>

