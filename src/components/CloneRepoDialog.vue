<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const {
  cloneDialogOpen,
  cloneUrlInput,
  cloneParentDir,
  cloneFolderName,
  pickCloneParentDirectory,
  runCloneRepo,
  syncCloneFolderFromUrl
} = useGitWorkspace()
</script>

<template>
  <el-dialog
    v-model="cloneDialogOpen"
    :title="t('cloneUi.title')"
    width="520px"
    destroy-on-close
    class="fork-clone-dialog"
    @opened="syncCloneFolderFromUrl"
  >
    <el-form label-position="top">
      <el-form-item :label="t('cloneUi.remoteUrl')">
        <el-input
          v-model="cloneUrlInput"
          :placeholder="t('cloneUi.urlPlaceholder')"
          @blur="syncCloneFolderFromUrl"
        />
      </el-form-item>
      <el-form-item :label="t('cloneUi.saveTo')">
        <div class="fork-clone-target-row">
          <el-input v-model="cloneParentDir" readonly :placeholder="t('cloneUi.parentPlaceholder')" />
          <el-button @click="pickCloneParentDirectory">{{ t('cloneUi.browse') }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="t('cloneUi.folderName')">
        <el-input v-model="cloneFolderName" :placeholder="t('cloneUi.folderNamePh')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cloneDialogOpen = false">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="runCloneRepo">{{ t('cloneUi.cloneBtn') }}</el-button>
    </template>
  </el-dialog>
</template>
