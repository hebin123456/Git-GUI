import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/fork-app.css'
import { i18n } from './i18n/index.ts'

const isGitMmHash =
  typeof window !== 'undefined' &&
  (window.location.hash === '#git-mm' || window.location.hash === '#/git-mm')

const enableGitMm = import.meta.env.VITE_ENABLE_GIT_MM !== 'false'

async function bootstrap() {
  if (isGitMmHash && enableGitMm) {
    const { default: GitMmApp } = await import('./git-mm/GitMmApp.vue')
    createApp(GitMmApp).use(ElementPlus).use(i18n).mount('#app')
    return
  }
  if (isGitMmHash && !enableGitMm) {
    createApp({
      render: () =>
        h(
          'div',
          {
            class: 'git-mm-disabled-stub',
            style:
              'padding:24px;font-family:system-ui,Segoe UI,sans-serif;font-size:14px;color:var(--el-text-color-primary, #303133);background:var(--el-bg-color-page, #fff);min-height:100vh;box-sizing:border-box'
          },
          'Git MM 未包含在此构建中。请使用完整安装包或单独构建 Git MM 界面。'
        )
    }).mount('#app')
    return
  }
  const { default: App } = await import('./App.vue')
  createApp(App).use(ElementPlus).use(i18n).mount('#app')
}

void bootstrap()
