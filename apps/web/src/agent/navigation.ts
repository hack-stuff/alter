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
