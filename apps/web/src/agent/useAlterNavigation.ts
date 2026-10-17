import { useCallback, useEffect, useState, useTransition } from 'react'
import { alterNav, type NavigationEvent } from './navigator'
import type { HighlightState, NavigationAction, NavigationSource, ScreenId } from './navigation'

/** Screens the hook can show: the nine Alter screens plus the meeting reviews list. */
export type View = ScreenId | 'meetings'

interface Focus { target: string; highlight: HighlightState; nonce: number }

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Finds a highlight target: `kind:<value>`, `label:<words>` or a data-nav-id. */
export function resolveTarget(root: ParentNode, target: string): HTMLElement | null {
  if (target.startsWith('kind:')) return root.querySelector<HTMLElement>(`[data-nav-kind="${CSS.escape(target.slice(5))}"]`)
  if (target.startsWith('label:')) {
    const words = target.slice(6).toLowerCase()
    return [...root.querySelectorAll<HTMLElement>('[data-nav-label]')].find((element) => element.dataset.navLabel?.toLowerCase().includes(words)) ?? null
  }
  return root.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(target)}"]`)
}

/** Scrolls to, focuses and briefly pulses an element. Focus lands on the container, never on its buttons. */
export function highlightElement(element: HTMLElement, highlight: HighlightState) {
  element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
  if (highlight === 'none') return
  if (!element.hasAttribute('tabindex') && !element.matches('a[href],button,input,select,textarea')) element.setAttribute('tabindex', '-1')
  element.focus({ preventScroll: true })
  element.classList.remove('nav-highlight')
  void element.offsetWidth
  element.classList.add('nav-highlight')
  window.setTimeout(() => element.classList.remove('nav-highlight'), 2800)
}

/**
 * Optimistic switch: pre-mounted screens are shown in the same frame the intent
 * is recognised, before React re-renders. The transition below then commits the
 * same state, so React and the DOM agree.
 */
function showOptimistically(view: View) {
  const screens = document.querySelectorAll<HTMLElement>('[data-screen]')
  if (![...screens].some((element) => element.dataset.screen === view)) return
  const changed = [...screens].some((element) => element.hidden !== (element.dataset.screen !== view))
  for (const element of screens) element.hidden = element.dataset.screen !== view
  // A new screen starts at the top; a highlight target then scrolls itself into view.
  if (changed) window.scrollTo({ top: 0 })
}

/**
 * Owns which screen is visible. Screens are pre-mounted, so a switch is a
 * transition between already-rendered views rather than a load.
 */
export function useAlterNavigation(initial: View) {
  const [view, setView] = useState<View>(initial)
  const [focus, setFocus] = useState<Focus>()
  const [isPending, startTransition] = useTransition()

  const show = useCallback((event: NavigationEvent) => {
    showOptimistically(event.screen)
    startTransition(() => {
      setView(event.screen)
      setFocus(event.targetElementId ? { target: event.targetElementId, highlight: event.highlightState ?? 'pulse', nonce: event.at } : undefined)
    })
  }, [])

  useEffect(() => alterNav.register(show), [show])
  useEffect(() => { if (view !== 'meetings') alterNav.setCurrent(view) }, [view])

  /** Navigate from anywhere: buttons, typed text or voice. */
  const navigateTo = useCallback((action: NavigationAction, source: NavigationSource = 'ui') => { alterNav.dispatch(action, source) }, [])
  /** Views that are not one of the nine screens (the meeting reviews list). */
  const showView = useCallback((next: View) => { startTransition(() => { setView(next); setFocus(undefined) }) }, [])

  // Anchor attention once the target screen is visible. Data may still be
  // arriving (a freshly revised plan), so watch briefly for the target to appear.
  useEffect(() => {
    if (!focus) return
    const root = document.querySelector(`[data-screen="${view}"]`)
    if (!root) return
    const attempt = () => { const element = resolveTarget(root, focus.target); if (element) highlightElement(element, focus.highlight); return !!element }
    if (attempt()) return
    const observer = new MutationObserver(() => { if (attempt()) observer.disconnect() })
    observer.observe(root, { childList: true, subtree: true })
    const timer = window.setTimeout(() => observer.disconnect(), 4000)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [focus, view])

  return { view, navigateTo, showView, isPending }
}
