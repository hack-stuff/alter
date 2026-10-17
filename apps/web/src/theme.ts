// The person's light or dark choice, remembered on this device.
export type Theme = 'light' | 'dark'
export const THEME_KEY = 'alter.theme'
export const system = (): Theme => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

export function saved(): Theme | undefined {
  try { const value = localStorage.getItem(THEME_KEY); return value === 'light' || value === 'dark' ? value : undefined } catch { return undefined }
}

/** Apply a remembered choice before the first paint; otherwise the system setting decides. */
export function applySavedTheme() {
  const value = saved()
  if (value) document.documentElement.dataset.theme = value
}
