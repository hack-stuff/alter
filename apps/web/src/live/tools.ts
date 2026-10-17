import { api } from '../api/client'
import { meetingApi } from '../api/meetings'
import { planApi } from '../api/plans'
import { designEdit, requestedCard, workSurface, type WorkSurface } from '../agent/navigation'
import type { LiveMode } from './modes'

export interface ToolContext { mode: LiveMode; targetId?: string; conversationId?: string; meetingId?: string; draftOnly?: boolean; onNavigate?: (screen: WorkSurface) => void; onResult: (result: unknown, tool: string, input: string) => void }
const allowed: Record<LiveMode, string> = { chat: 'alter_chat', revise: 'revise_approval', reply: 'respond_escalation', huddle: 'ask_alter', review: 'revise_meeting', diagram: 'revise_diagram' }
function text(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000) throw new Error('A valid message is required.')
  return value.trim()
}
export async function dispatchLiveTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  if (name !== allowed[context.mode]) throw new Error('This voice session cannot perform that action. Approval requires the on-screen button.')
  let result: unknown
  let input: string
  if (name === 'alter_chat') {
    input = text(args, 'message')
    if (designEdit(input) && context.onNavigate) {
      const current = await planApi.get()
      const updated = await planApi.revise(current.id, current.revision, input)
      context.onNavigate('plan')
      return { navigation: 'plan', changed: updated.revision !== current.revision, revision: updated.revision, explanation: updated.explanation, instruction: 'The private design draft is open. Publishing still requires review.' }
    }
    const destination = workSurface(input)
    if (destination && context.onNavigate) {
      context.onNavigate(destination)
      return { navigation: destination, instruction: 'The requested work surface has opened. No work was published or sent.' }
    }
    result = await api.chat(requestedCard(input) === 4 ? "Ask Rahul's Alter to confirm the launch date" : input, context.conversationId, 'voice')
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
