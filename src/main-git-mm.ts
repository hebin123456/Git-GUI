/**
 * 独立构建入口：仅挂载 Git MM 管理界面（见 npm run build:git-mm）
 */
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import GitMmApp from './git-mm/GitMmApp.vue'
import './styles/fork-app.css'
import { i18n } from './i18n/index.ts'

createApp(GitMmApp).use(ElementPlus).use(i18n).mount('#app')
