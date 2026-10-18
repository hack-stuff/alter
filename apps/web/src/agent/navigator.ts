// A tiny in-page bus so voice, typed text and Live tool calls can move the UI
// without waiting on React props. The App's navigation hook registers itself as
// the handler; everything else dispatches NavigationActions through here.
import type { NavigationAction, NavigationSource, ScreenId } from './navigation'
import type { Plan } from '../api/plans'

export interface NavigationEvent extends NavigationAction {
  source: NavigationSource
  /** performance.now() when the intent was recognised, for latency checks. */
  at: number
}

type Handler = (event: NavigationEvent) => void
let handler: Handler | undefined
let current: ScreenId = 'home'
let last: NavigationEvent | undefined
const listeners = new Set<Handler>()
const planListeners = new Set<(plan: Plan) => void>()

export const alterNav = {
  register(fn: Handler) { handler = fn; return () => { if (handler === fn) handler = undefined } },
  /** The screen that is (or is about to be) visible. Updated synchronously on dispatch. */
  current: () => current,
  setCurrent(screen: ScreenId) { current = screen },
  /** The most recent navigation, so a later tool call for the same screen can be skipped. */
  last: () => last,
  dispatch(action: NavigationAction, source: NavigationSource): NavigationEvent {
    const event: NavigationEvent = { ...action, source, at: performance.now() }
    last = event
    current = action.screen
    handler?.(event)
    for (const listener of listeners) listener(event)
    return event
  },
  subscribe(fn: Handler) { listeners.add(fn); return () => { listeners.delete(fn) } },
}

/** Plan revisions made outside the canvas (for example by the voice Alter) reach the open canvas here. */
export const planUpdates = {
  publish(plan: Plan) { for (const listener of planListeners) listener(plan) },
  subscribe(fn: (plan: Plan) => void) { planListeners.add(fn); return () => { planListeners.delete(fn) } },
}

/** The meeting review on screen, so an edit said or typed to the voice bar revises it. */
let review: { meetingId: string; revision: number } | undefined
export const openReview = {
  get: () => review,
  set(value: { meetingId: string; revision: number }) { review = value; return () => { if (review === value) review = undefined } },
}

/** True when the same screen and target were opened within `windowMs`. */
export function recentlyOpened(action: NavigationAction, windowMs = 8000) {
  const previous = last
  return !!previous && previous.screen === action.screen && previous.targetElementId === action.targetElementId && performance.now() - previous.at < windowMs
}
