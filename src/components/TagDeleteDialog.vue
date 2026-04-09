<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const {
  tagDeleteDialogOpen,
  tagDeleteTagName,
  tagDeleteAlsoRemote,
  tagDeleteRemotePick,
  remotes,
  closeTagDeleteDialog,
  confirmTagDelete
} = useGitWorkspace()
</script>

<template>
  <el-dialog
    v-model="tagDeleteDialogOpen"
    :title="t('tagDelete.title')"
    width="440px"
    destroy-on-close
    class="fork-tag-delete-dialog"
  >
    <p class="fork-tag-delete-lead">
      {{ t('tagDelete.confirmLocalBefore') }}<span class="mono">{{ tagDeleteTagName }}</span>{{ t('tagDelete.confirmLocalAfter') }}
    </p>
    <el-checkbox v-if="remotes.length" v-model="tagDeleteAlsoRemote" class="fork-tag-delete-remote-cb">
      {{ t('tagDelete.alsoRemote') }}
    </el-checkbox>
    <p v-else class="fork-tag-delete-hint">{{ t('tagDelete.noRemoteHint') }}</p>
    <el-form v-if="remotes.length && tagDeleteAlsoRemote" label-position="top" class="fork-tag-delete-remote-form">
      <el-form-item :label="t('tagDelete.remote')">
        <el-select v-model="tagDeleteRemotePick" :placeholder="t('tagDelete.pickRemote')" style="width: 100%">
          <el-option v-for="r in remotes" :key="r" :label="r" :value="r" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="closeTagDeleteDialog">{{ t('common.cancel') }}</el-button>
      <el-button type="danger" @click="confirmTagDelete">{{ t('common.delete') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, monospace;
}
</style>
