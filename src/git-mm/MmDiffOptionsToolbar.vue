<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  diffOutputFormat: 'line-by-line' | 'side-by-side'
  diffIgnoreBlankLines: boolean
  diffIgnoreWhitespace: boolean
  diffContextLines: number
  diffShowFullFile: boolean
  /** 无选中文件或整文件对比时禁用上下文行数调节 */
  contextDisabled: boolean
}>()

const emit = defineEmits<{
  toggleDiffFormat: []
  toggleIgnoreBlankLines: []
  toggleIgnoreWhitespace: []
  decContextLines: []
  incContextLines: []
  toggleShowFullFile: []
}>()

const { t } = useI18n()
</script>

<template>
  <el-dropdown trigger="click">
    <el-button size="small" text type="primary">
      {{ t('changes.diffOptions') }}
      <el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item @click="emit('toggleDiffFormat')">
          {{
            diffOutputFormat === 'side-by-side' ? t('changes.diffLineByLine') : t('changes.diffSideBySide')
          }}
        </el-dropdown-item>
        <el-dropdown-item @click="emit('toggleIgnoreBlankLines')">
          {{ diffIgnoreBlankLines ? '✓ ' : '' }}{{ t('changes.ignoreBlankLines') }}
        </el-dropdown-item>
        <el-dropdown-item @click="emit('toggleIgnoreWhitespace')">
          {{ diffIgnoreWhitespace ? '✓ ' : '' }}{{ t('changes.ignoreWhitespace') }}
        </el-dropdown-item>
        <el-dropdown-item divided :disabled="contextDisabled" @click="emit('decContextLines')">
          {{ t('changes.lessContext') }}
        </el-dropdown-item>
        <el-dropdown-item :disabled="contextDisabled" @click="emit('incContextLines')">
          {{
            t('changes.moreContext', {
              n: diffShowFullFile ? t('changes.contextAll') : diffContextLines
            })
          }}
        </el-dropdown-item>
        <el-dropdown-item @click="emit('toggleShowFullFile')">
          {{ diffShowFullFile ? '✓ ' : '' }}{{ t('changes.fullFile') }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
