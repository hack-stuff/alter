export type WorkSurface = 'meet' | 'plan' | 'approvals' | 'activity'

// Navigation is a UI action, not a model-generated claim about completed work.
export function workSurface(text: string): WorkSurface | undefined {
  if (
    !/^(please\s+)?(open|show|take|join|go|continue|let'?s)\b/i.test(
      text.trim(),
    )
  )
    return
  if (/\b(meet|meeting|sync|call)\b/i.test(text)) return 'meet'
  if (/\b(plan|canvas|diagram|design|flow)\b/i.test(text)) return 'plan'
  if (/\b(approval|approvals|queue|drafts)\b/i.test(text)) return 'approvals'
  if (/\b(receipts|activity|work log)\b/i.test(text)) return 'activity'
}
