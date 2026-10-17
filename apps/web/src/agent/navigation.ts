export type WorkSurface = 'meet' | 'plan' | 'approvals' | 'activity'

const navigation = /^(?:(?:hey[, ]+)?alter[, ]+)?(?:(?:please|can you|could you|would you|i want to|let'?s)\s+)*(?:open|show|view|see|join|go to|take me to|bring up|navigate to|shape)\b/i
const cardNumber = /\b(?:card|option|tile)\s*(?:number\s*|#\s*)?(one|two|three|four|[1-4]|0[1-4])\b|\b(first|second|third|fourth)\s+(?:card|option|tile)\b/i

export function requestedCard(text: string): 1 | 2 | 3 | 4 | undefined {
  if (!navigation.test(text.trim())) return
  const match = cardNumber.exec(text)
  const number = (match?.[1] ?? match?.[2])?.toLowerCase()
  const index = ({ one: 1, two: 2, three: 3, four: 4, first: 1, second: 2, third: 3, fourth: 4 } as Record<string, number>)[number ?? ''] ?? Number(number)
  return index >= 1 && index <= 4 ? index as 1 | 2 | 3 | 4 : undefined
}

export function designEdit(text: string): boolean {
  return /\b(add|remove|delete|change|edit|update|move|connect|disconnect|redraw|modify|include|insert|make|create|draw|link|route)\b/i.test(text)
    && /\b(arch(?:itecture)?|diagram|flow(?:chart)?|plan|canvas|login journey|design)\b/i.test(text)
}

// Navigation changes the visible work surface; it never claims work was saved.
export function workSurface(text: string): WorkSurface | undefined {
  const command = text.trim()
  if (/^what(?:'s| is)? (?:waiting|needs me)/i.test(command)) return 'approvals'
  if (!navigation.test(command)) return
  const card = requestedCard(command)
  if (card === 1) return 'meet'
  if (card === 2) return 'plan'
  if (card === 3) return 'approvals'
  if (/\b(meet|meeting|sync|call)\b/i.test(command)) return 'meet'
  if (/\b(plan|canvas|diagram|design|architecture|arch|flow|login journey)\b/i.test(command)) return 'plan'
  if (/\b(approval|approvals|queue|drafts|waiting on you)\b/i.test(command)) return 'approvals'
  if (/\b(receipts|activity|work log)\b/i.test(command)) return 'activity'
}

// ---------------------------------------------------------------------------
// Typed navigation for the Alter: every screen change, whether typed, spoken
// or requested by a Live tool call, goes through one NavigationAction.
// Navigation only changes what is visible. It never approves, sends or edits.

export const SCREEN_IDS = ['home', 'canvas', 'meeting', 'approvals', 'decisions', 'team', 'work-log', 'rules', 'files'] as const
export type ScreenId = (typeof SCREEN_IDS)[number]
export type HighlightState = 'pulse' | 'focus' | 'none'
export type NavigationSource = 'ui' | 'text' | 'voice-fast' | 'voice-tool'

export interface NavigationAction {
  screen: ScreenId
  /** A data-nav-id, or `kind:<value>` / `label:<words>` resolved on the target screen. */
  targetElementId?: string
  highlightState?: HighlightState
}

export function navigateTo(screen: ScreenId, targetElementId?: string, highlightState: HighlightState = 'pulse'): NavigationAction {
  return targetElementId ? { screen, targetElementId, highlightState } : { screen, highlightState }
}

export function isScreenId(value: unknown): value is ScreenId {
  return typeof value === 'string' && (SCREEN_IDS as readonly string[]).includes(value)
}

export const LEGACY_SURFACES: Record<WorkSurface, ScreenId> = { meet: 'meeting', plan: 'canvas', approvals: 'approvals', activity: 'work-log' }

const verb = /^(?:(?:hey|ok|okay|so)[, ]+)?(?:alter[, ]+)?(?:(?:please|can you|could you|would you|will you|i want to|i'd like to|let'?s|let me|now|and)\s+)*(?:open|show(?: me)?|view|see|join|go(?: back)? to|take me(?: back)? to|bring (?:me )?up|pull up|navigate to|switch to|jump to|head to|back to|shape)\b/i
const negation = /\b(?:don'?t|do not|never|not now|no need|stop|cancel)\b/i
export function startMeetingIntent(input: string): boolean {
  const text = input.trim()
  return text.length <= 160 && !negation.test(text) && /\b(?:start|create|launch|begin|set up|join)\s+(?:(?:a|the|our|my|new)\s+)*(?:google\s+)?(?:meet(?:ing)?|call|team sync)\b/i.test(text)
}
// Order matters: more specific screens first ("team decisions" before "team").
const SCREEN_WORDS: [ScreenId, RegExp][] = [
  ['decisions', /\b(?:decisions?|escalations?|team decisions|questions? (?:for|waiting on) me)\b/i],
  ['approvals', /\b(?:approvals?|proposals?|drafts?|queue|review queue|waiting on (?:me|you)|what needs me)\b/i],
  ['work-log', /\b(?:work ?log|activity|receipts?|history)\b/i],
  ['rules', /\b(?:rules?|memory|memories|settings|preferences|permissions)\b/i],
  ['files', /\b(?:files?|inbox|drive|folder)\b/i],
  ['canvas', /\b(?:canvas|diagram|design|plan|flow(?:chart)?|login journey|architecture|arch)\b/i],
  ['meeting', /\b(?:meeting|meet|sync|call|companion|stand-?up)\b/i],
  ['team', /\b(?:team|teammates?|alters)\b/i],
  ['home', /\b(?:home|briefing|my alter|main screen|start)\b/i],
]
const KIND_TARGETS: [RegExp, string][] = [
  [/\b(?:calendar|invite|event|booking)\b/i, 'kind:calendar_event'],
  [/\b(?:email|summary|mail)\b/i, 'kind:email'],
  [/\b(?:tracker|sheet|spreadsheet|row)\b/i, 'kind:sheet_update'],
  [/\b(?:status doc|document update|doc update|doc edit)\b/i, 'kind:doc_edit'],
]
const PEOPLE = /\b(meera|arjun|rahul|priya)\b/i
const NODE_WORDS = /\b(retry|fallback|one-?tap|token|verify|authenticated|launch|timeout|review|home)\b/i
const NAMED = /\bthe ([a-z0-9-]+(?: [a-z0-9-]+)?) (?:node|step|card|proposal|question|state|screen)\b/i

function targetFor(screen: ScreenId, text: string): string | undefined {
  if (screen === 'approvals') return KIND_TARGETS.find(([pattern]) => pattern.test(text))?.[1] ?? labelFrom(NAMED.exec(text)?.[1])
  if (screen === 'canvas') return labelFrom(NODE_WORDS.exec(text)?.[1] ?? NAMED.exec(text)?.[1])
  if (screen === 'team' || screen === 'decisions' || screen === 'meeting') return labelFrom(PEOPLE.exec(text)?.[1] ?? NAMED.exec(text)?.[1])
  if (screen === 'files') return /\b(?:inbox|email|mail)\b/i.test(text) ? 'inbox' : undefined
}
const SCREEN_NOUNS = /\b(?:canvas|diagram|design|plan|approvals?|proposals?|decisions?|team|meeting|files?|rules?)\b/gi
function labelFrom(words?: string) {
  const label = words?.replace(SCREEN_NOUNS, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^one tap$/, 'one-tap')
  return label ? `label:${label}` : undefined
}

export interface ParsedNavigation { action: NavigationAction; confidence: 'high' | 'low' }

/**
 * Deterministic, synchronous intent check that runs on every transcript token.
 * High confidence needs an explicit navigation verb, a screen noun and no negation,
 * so ordinary questions ("what's on the canvas?") still go to the Alter.
 */
export function parseNavigation(input: string): ParsedNavigation | undefined {
  const text = input.trim().replace(/[.!?]+$/, '')
  if (!text || text.length > 160 || negation.test(text)) return
  if (/^what(?:'s| is)? (?:waiting|needs me)/i.test(text)) return { action: navigateTo('approvals'), confidence: 'high' }
  const card = requestedCard(text)
  if (card && card !== 4) return { action: navigateTo((['meeting', 'canvas', 'approvals'] as const)[card - 1]), confidence: 'high' }
  const explicit = verb.test(text)
  const screen = SCREEN_WORDS.find(([, pattern]) => pattern.test(text))?.[0]
  if (!screen) return
  // A design edit ("add a retry state to the diagram") is work, not navigation.
  if (designEdit(text) && !explicit) return
  const action = navigateTo(screen, targetFor(screen, text))
  return { action, confidence: explicit ? 'high' : 'low' }
}

const editVerb = /\b(add|remove|delete|change|edit|update|move|connect|disconnect|redraw|modify|include|insert|put|make|create|draw|link|route|rename|propose)\b/i

/** On the open canvas, "change the timeout to 15 minutes" is a design edit even without the word "diagram". */
export function canvasEdit(text: string, screen: ScreenId): boolean {
  return designEdit(text) || (screen === 'canvas' && editVerb.test(text) && !parseNavigation(text))
}
