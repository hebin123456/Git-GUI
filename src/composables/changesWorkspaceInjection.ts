import type { InjectionKey } from 'vue'
import type { useGitWorkspace } from './useGitWorkspace.ts'

/** 主窗口 useGitWorkspace() 与 Git MM 内 useGitMmChangesWorkspace() 均通过此键注入，供 ChangesView 复用 */
export type ChangesWorkspaceInjection = ReturnType<typeof useGitWorkspace>
export const CHANGES_WORKSPACE_INJECTION_KEY: InjectionKey<ChangesWorkspaceInjection> = Symbol('changes-workspace')
