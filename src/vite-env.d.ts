/// <reference types="vite/client" />

import type { ElectronWindowApi, GitAtClientApi, GitClientApi, GitMmClientApi } from './types/git-client'

interface ImportMetaEnv {
  /** 设为 false 时主构建不包含 Git MM（npm run build:no-git-mm） */
  readonly VITE_ENABLE_GIT_MM?: string
  /** 设为 true 时仅打包 Git MM 静态资源（npm run build:git-mm） */
  readonly VITE_GIT_MM_ONLY?: string
}

declare global {
  interface Window {
    electronWindow?: ElectronWindowApi
    gitClient: GitClientApi
    gitMm: GitMmClientApi
    gitAt: GitAtClientApi
  }
}

export {}
