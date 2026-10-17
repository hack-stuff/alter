import type { Approval } from '../api/types'

// The owner can decide on a waiting draft by saying or typing it:
// "send it", "approve the calendar invite", "reject that email".
export interface DecisionIntent { decision: 'approve' | 'reject'; kind?: 'email' | 'calendar_event' | 'doc' | 'sheet_update' }

const command = /^(?:(?:hey|ok(?:ay)?|yes|yeah|sure|alter)[, ]+)*(?:please\s+)?(?:go ahead and\s+)?(approve|send|accept|confirm|apply|reject|discard|cancel|decline|don'?t send)\b(.*)$/i

export function parseDecision(input: string): DecisionIntent | undefined {
  const match = command.exec(input.trim().replace(/[.!]+$/, ''))
  if (!match) return
  const [, verb, rest] = match
  // Longer requests ("send Meera a summary of QA") are new work, not a decision.
  if (rest.trim().split(/\s+/).filter(Boolean).length > 5 || /\b(to|about|a summary|an email to)\b/i.test(rest) && !/\b(it|that|this)\b/i.test(rest)) return
  const decision = /^(reject|discard|cancel|decline|don'?t send)$/i.test(verb) ? 'reject' : 'approve'
  const kind = /\b(e?mail|summary|message)\b/i.test(rest) || /^send$/i.test(verb) ? 'email'
    : /\b(calendar|invite|event|meeting|booking)\b/i.test(rest) ? 'calendar_event'
      : /\b(doc|document|status)\b/i.test(rest) ? 'doc'
        : /\b(sheet|tracker|row)\b/i.test(rest) ? 'sheet_update' : undefined
  return { decision, kind }
}

/** The most recent waiting draft that matches the request. */
export function pickApproval(approvals: Approval[], intent: DecisionIntent): Approval | undefined {
  const waiting = approvals.filter((approval) => approval.state === 'proposed')
  const matches = intent.kind ? waiting.filter((approval) => intent.kind === 'doc' ? approval.kind.startsWith('doc_') : approval.kind === intent.kind) : waiting
  return (matches.length ? matches : intent.kind === 'email' ? [] : waiting).at(-1)
}
