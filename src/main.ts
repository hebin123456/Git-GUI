import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/fork-app.css'
import { i18n } from './i18n/index.ts'

function showRuntimeErrorOverlay(title: string, detail: unknown) {
  const text = detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : String(detail)
  const existing = document.getElementById('fork-runtime-error-overlay')
  const node = existing ?? document.createElement('pre')
  node.id = 'fork-runtime-error-overlay'
  node.textContent = `${title}\n\n${text}`
  node.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:12px',
    'z-index:2147483647',
    'max-height:45vh',
    'overflow:auto',
    'white-space:pre-wrap',
    'padding:12px',
    'margin:0',
    'border:1px solid #dc2626',
    'border-radius:8px',
    'background:#fff1f2',
    'color:#7f1d1d',
    'font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace',
    'box-shadow:0 12px 32px rgba(0,0,0,.22)'
  ].join(';')
  document.body.appendChild(node)
}

function isIgnorableRuntimeNoise(detail: unknown): boolean {
  const msg = detail instanceof Error ? detail.message : String(detail ?? '')
  return (
    msg.includes('ResizeObserver loop completed with undelivered notifications') ||
    msg.includes('ResizeObserver loop limit exceeded')
  )
}

window.addEventListener('error', (event) => {
  if (isIgnorableRuntimeNoise(event.error ?? event.message)) {
    event.preventDefault()
    return
  }
  console.error('[renderer:error]', event.error ?? event.message)
  showRuntimeErrorOverlay('Renderer runtime error', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (isIgnorableRuntimeNoise(event.reason)) return
  console.error('[renderer:unhandledrejection]', event.reason)
  showRuntimeErrorOverlay('Renderer unhandled rejection', event.reason)
})

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
