import { api } from '../api/client'
import type { LiveMode } from './modes'

export interface ToolContext { mode: LiveMode; targetId?: string; conversationId?: string; draftOnly?: boolean; onResult: (result: unknown, tool: string, input: string) => void }
const allowed: Record<LiveMode, string> = { chat: 'alter_chat', revise: 'revise_approval', reply: 'respond_escalation', huddle: 'ask_alter' }
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
    result = await api.chat(input, context.conversationId, 'voice')
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
  } else {
    const id = text(args, 'memberId')
    if (!context.targetId || id !== context.targetId) throw new Error('This room belongs to a different teammate.')
    input = text(args, 'question')
    result = await api.askAlter(id, input)
  }
  context.onResult(result, name, input)
  return result
}
