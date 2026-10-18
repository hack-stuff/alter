import { api } from '../api/client'
import { meetingApi } from '../api/meetings'
import { planApi } from '../api/plans'
import { canvasEdit, desktopTask, isScreenId, navigateTo, parseNavigation, requestedCard, type HighlightState, type NavigationAction, type NavigationSource } from '../agent/navigation'
import { requestDesktopTask } from '../api/desktop'
import { alterNav, openReview, planUpdates, recentlyOpened } from '../agent/navigator'
import type { Plan } from '../api/plans'
import { parseDecision, type DecisionIntent } from '../agent/decisions'
import type { LiveMode } from './modes'

export interface ToolContext { mode: LiveMode; targetId?: string; conversationId?: string; meetingId?: string; draftOnly?: boolean; onNavigate?: (action: NavigationAction, source?: NavigationSource) => void; onDecide?: (intent: DecisionIntent) => Promise<unknown>; onResult: (result: unknown, tool: string, input: string) => void }
// Each mode may call only its own tools. No mode has a tool that approves, revises
// or rejects a proposal on the user's behalf from navigation: those stay on-screen buttons.
const allowed: Record<LiveMode, readonly string[]> = { chat: ['alter_chat', 'navigate_to', 'decide_proposal'], revise: ['revise_approval'], reply: ['respond_escalation'], huddle: ['ask_alter'], review: ['revise_meeting'], diagram: ['revise_diagram'] }
const highlights: HighlightState[] = ['pulse', 'focus', 'none']
// An edit is an instruction that starts a sentence ("Looks good. Just add that…"), never a verb inside a question ("What did Siddhi say?").
const reviewEdit = /(?:^|[.!;]\s*)(?:(?:please|just|also|and|now|then|so|ok(?:ay)?|(?:can|could|would) you)[,\s]+)*(?:add|remove|delete|change|edit|update|mention|include|insert|put|make|say|note|replace|rename)\b/i

/** Which node a revision added, or else the first one it changed. */
function changedNode(before: Plan, after: Plan): string | undefined {
  const added = after.nodes.find((node) => !before.nodes.some((old) => old.id === node.id))
  if (added) return added.id
  return after.nodes.find((node) => JSON.stringify(node) !== JSON.stringify(before.nodes.find((old) => old.id === node.id)))?.id
}
function text(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new Error('A valid message is required.')
  return value.trim()
}
/** An edit said or typed while a meeting review is open changes that review, never the chat. */
export async function reviseOpenReview(text: string) {
  const review = openReview.get()
  if (!review || !reviewEdit.test(text.trim()) || parseNavigation(text)) return undefined
  const updated = await meetingApi.revise(review.meetingId, review.revision, text)
  return { revision: updated.revision, instruction: 'The edit is applied to the meeting review on screen. Nothing is approved, sent or published until the owner taps approve.' }
}
export const isReviewEdit = (text: string) => !!openReview.get() && reviewEdit.test(text.trim()) && !parseNavigation(text)

export async function dispatchLiveTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  if (!allowed[context.mode].includes(name)) throw new Error('This voice session cannot perform that action.')
  if (name === 'decide_proposal') {
    // The owner said approve, reject or send: decide the matching waiting draft.
    if (!context.onDecide) throw new Error('Decisions are made from your own Alter.')
    const decision = args.decision === 'reject' ? 'reject' : args.decision === 'approve' ? 'approve' : undefined
    if (!decision) throw new Error('Say approve, send or reject.')
    const kinds = ['email', 'calendar_event', 'doc', 'sheet_update'] as const
    const kind = kinds.find((value) => value === args.kind)
    return await context.onDecide({ decision, kind })
  }
  let result: unknown
  let input: string
  const go = (action: NavigationAction, source: NavigationSource) => context.onNavigate ? context.onNavigate(action, source) : alterNav.dispatch(action, source)
  if (name === 'navigate_to') {
    // Client-only: moves the view and highlights a target. Never touches data.
    const screen = args.screen
    if (!isScreenId(screen)) throw new Error('Unknown screen.')
    const target = typeof args.target === 'string' && args.target.trim() ? args.target.trim().slice(0, 120) : undefined
    const highlight = highlights.find((value) => value === args.highlight) ?? 'pulse'
    const action = navigateTo(screen, target, highlight)
    const already = recentlyOpened(action)
    if (!already) go(action, 'voice-tool')
    result = { navigation: screen, target: target ?? null, alreadyOpen: already, instruction: screen === 'approvals' ? 'The proposal is on screen for the user to inspect. Only the user can approve, revise or reject it, by pressing the on-screen buttons.' : 'The screen is open. Nothing was published, sent or approved.' }
    return result
  }
  if (name === 'alter_chat') {
    input = text(args, 'message')
    const decision = parseDecision(input)
    if (decision && context.onDecide) return await context.onDecide(decision)
    const revised = await reviseOpenReview(input)
    if (revised) return revised
    if (canvasEdit(input, alterNav.current()) && context.onNavigate) {
      const current = await planApi.get()
      const updated = await planApi.revise(current.id, current.revision, input)
      planUpdates.publish(updated)
      go(navigateTo('canvas', changedNode(current, updated), 'pulse'), 'voice-tool')
      return { navigation: 'canvas', changed: updated.revision !== current.revision, revision: updated.revision, explanation: updated.explanation, instruction: 'The private design draft is open with the change highlighted. Publishing still requires review.' }
    }
    const task = desktopTask(input)
    if (task && context.onNavigate) {
      go(navigateTo('computer'), 'voice-tool')
      requestDesktopTask(task)
      return { navigation: 'computer', instruction: 'The Computer page is open and the task starts there with the desktop helper. Each step may wait for the owner to allow it. Nothing has been done on the computer yet.' }
    }
    const intent = parseNavigation(input)
    if (intent && (intent.confidence === 'high' || requestedCard(input)) && context.onNavigate) {
      // The transcript fast path usually opened this already; don't navigate twice.
      const already = recentlyOpened(intent.action)
      if (!already) go(intent.action, 'voice-tool')
      return { navigation: intent.action.screen, target: intent.action.targetElementId ?? null, alreadyOpen: already, instruction: 'The requested screen has opened. No work was published, sent or approved.' }
    }
    result = await api.chat(requestedCard(input) === 4 ? "Ask Siddhi's Alter to confirm the launch date" : input, context.conversationId, 'voice')
    context.conversationId = (result as { conversationId: string }).conversationId
  } else if (name === 'revise_diagram') {
    const id = context.targetId
    if (!id || (args.planId !== undefined && text(args, 'planId') !== id)) throw new Error('Only the open design can be edited.')
    input = text(args, 'instruction')
    const current = await planApi.get(id)
    result = await planApi.revise(id, current.revision, input)
  } else if (name === 'revise_approval') {
    const id = text(args, 'approvalId')
    if (!context.targetId || id !== context.targetId) throw new Error('Only the open proposal can be revised.')
    input = text(args, 'instruction')
    result = await api.revise(id, input, 'voice')
  } else if (name === 'respond_escalation') {
    const id = text(args, 'escalationId')
    if (!context.targetId || id !== context.targetId) throw new Error('Only the open question can receive your reply.')
    input = text(args, 'text')
    result = context.draftOnly ? { draft: input, sent: false, instruction: 'The reply is a draft. Tell the user to review it and press Send reply.' } : await api.respondEscalation(id, input)
  } else if (name === 'revise_meeting') {
    const id = text(args, 'meetingId')
    if (id !== context.targetId) throw new Error('Only the open meeting can be revised.')
    input = text(args, 'instruction')
    const current = await meetingApi.get(id)
    result = await meetingApi.revise(id, current.revision, input)
  } else {
    const id = text(args, 'memberId')
    if (!context.targetId || id !== context.targetId) throw new Error('This room belongs to a different teammate.')
    input = text(args, 'question')
    result = context.meetingId ? await meetingApi.ask(context.meetingId, input) : await api.askAlter(id, input)
  }
  context.onResult(result, name, input)
  return result
}
