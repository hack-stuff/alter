import { useState } from 'react'
import { Icon } from './Icon'
import { saved, system, THEME_KEY, type Theme } from '../theme'

export function ThemeToggle({ className = '', labelled = false }: { className?: string; labelled?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => saved() ?? system())
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  function toggle() {
    document.documentElement.dataset.theme = next
    try { localStorage.setItem(THEME_KEY, next) } catch { /* The choice still applies for this visit. */ }
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = next === 'dark' ? '#111110' : '#f7f6f2'
    setTheme(next)
  }
  return <button type="button" className={`theme-toggle ${className}`.trim()} aria-label={labelled ? undefined : `Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={toggle}>
    <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={labelled ? 17 : 19} />{labelled && <span>{next === 'dark' ? 'Dark mode' : 'Light mode'}</span>}
  </button>
}
