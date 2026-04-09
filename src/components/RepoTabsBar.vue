<script setup lang="ts">
import { Close, Plus, Download } from '@element-plus/icons-vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGitWorkspace } from '../composables/useGitWorkspace.ts'

const { t } = useI18n()
const { repoTabs, activeTabId, activateTab, onTabRemove, openRepo, openCloneDialog } = useGitWorkspace()

const dragFromIndex = ref<number | null>(null)
/** 避免拖拽结束后误触发一次 @click 切换标签 */
const suppressTabClick = ref(false)

function onDragStart(e: DragEvent, index: number) {
  dragFromIndex.value = index
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  dragFromIndex.value = null
  suppressTabClick.value = true
  window.setTimeout(() => {
    suppressTabClick.value = false
  }, 80)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(e: DragEvent, toIndex: number) {
  e.preventDefault()
  e.stopPropagation()
  const from = dragFromIndex.value
  if (from === null || from === toIndex) return
  const list = [...repoTabs.value]
  const [item] = list.splice(from, 1)
  list.splice(toIndex, 0, item)
  repoTabs.value = list
  dragFromIndex.value = null
}

function onTabClick(tab: { id: string }) {
  if (suppressTabClick.value) return
  void activateTab(tab.id)
}
</script>

<template>
  <div class="fork-repo-tabs-row">
    <div v-if="repoTabs.length" class="repo-tabs-strip">
      <div
        v-for="(tab, index) in repoTabs"
        :key="tab.id"
        class="repo-tab-item"
        :class="{ 'is-active': activeTabId === tab.id }"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @dragend="onDragEnd"
        @dragenter.prevent="onDragOver"
        @dragover="onDragOver"
        @drop="onDrop($event, index)"
        @click="onTabClick(tab)"
      >
        <span class="repo-tab-title" :title="tab.path">{{ tab.title }}</span>
        <span
          class="repo-tab-close no-drag"
          role="button"
          tabindex="0"
          :title="t('tabs.closeTab')"
          @click.stop="onTabRemove(tab.id)"
          @mousedown.stop
        >
          <el-icon :size="12"><Close /></el-icon>
        </span>
      </div>
      <el-button text class="repo-tab-add" :title="t('tabs.cloneTooltip')" @click="openCloneDialog">
        <el-icon :size="14"><Download /></el-icon>
      </el-button>
      <el-button text class="repo-tab-add" :title="t('tabs.openTooltip')" @click="openRepo">
        <el-icon :size="14"><Plus /></el-icon>
      </el-button>
    </div>
    <div v-else class="repo-tabs-bar repo-tabs-empty">
      <el-button text type="primary" size="small" @click="openRepo">
        <el-icon :size="14"><Plus /></el-icon>
        {{ t('tabs.openRepo') }}
      </el-button>
      <el-button text size="small" @click="openCloneDialog">
        <el-icon :size="14"><Download /></el-icon>
        {{ t('tabs.cloneRepo') }}
      </el-button>
    </div>
  </div>
</template>
