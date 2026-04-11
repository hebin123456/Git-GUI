function hasStorageBridge(): boolean {
  if (typeof window === 'undefined') return false
  const client = window.gitClient as
    | {
        appStorageGet?: (key: string) => string | null
        appStorageSet?: (key: string, value: string) => void
        appStorageRemove?: (key: string) => void
      }
    | undefined
  return (
    !!client &&
    typeof client.appStorageGet === 'function' &&
    typeof client.appStorageSet === 'function' &&
    typeof client.appStorageRemove === 'function'
  )
}

export function getPersistentStorageItem(key: string): string | null {
  if (hasStorageBridge()) {
    try {
      const value = window.gitClient.appStorageGet(key)
      try {
        if (value == null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {
        /* ignore local mirror failures */
      }
      return value
    } catch {
      /* fall back to renderer localStorage */
    }
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setPersistentStorageItem(key: string, value: string): void {
  if (hasStorageBridge()) {
    try {
      window.gitClient.appStorageSet(key, value)
    } catch {
      /* fall back to renderer localStorage */
    }
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore local mirror failures */
  }
}

export function removePersistentStorageItem(key: string): void {
  if (hasStorageBridge()) {
    try {
      window.gitClient.appStorageRemove(key)
    } catch {
      /* fall back to renderer localStorage */
    }
  }
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore local mirror failures */
  }
}
