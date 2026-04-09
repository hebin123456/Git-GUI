import { defineConfig, loadEnv, normalizePath } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = normalizePath(path.resolve(rootDir, 'src'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')
  /** 仅 Web 资源输出到 dist-git-mm（不跑 Electron 打包） */
  const gitMmOnly = env.VITE_GIT_MM_ONLY === 'true'
  /** 主应用不包含 Git MM 相关代码 */
  const noGitMm = env.VITE_ENABLE_GIT_MM === 'false'

  return {
    plugins: [
      vue(),
      ...(gitMmOnly
        ? []
        : [
            electron({
              main: {
                entry: 'electron/main/index.ts'
              },
              preload: {
                input: path.join(rootDir, 'electron/preload/index.ts')
              }
            })
          ])
    ],
    resolve: {
      alias: {
        '@': srcDir
      }
    },
    base: './',
    build: {
      outDir: gitMmOnly ? 'dist-git-mm' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: gitMmOnly ? path.resolve(rootDir, 'git-mm.html') : path.resolve(rootDir, 'index.html')
      }
    }
  }
})
