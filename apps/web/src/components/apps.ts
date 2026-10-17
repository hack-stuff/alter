import type { MemberStatus } from '../api/types'

export type GoogleApp = 'docs' | 'sheets' | 'drive' | 'calendar' | 'gmail' | 'meet'

/** Best-effort app detection from a Google URL or a document title. */
export function appFor(url?: string, title = ''): GoogleApp | undefined {
  const text = `${url ?? ''} ${title}`.toLowerCase()
  if (/docs\.google\.com\/spreadsheets|\bsheet|tracker/.test(text)) return 'sheets'
  if (/docs\.google\.com\/document|\bdoc\b|spec|notes|status|rfc|brief/.test(text)) return 'docs'
  if (/calendar|\bevent\b|invite/.test(text)) return 'calendar'
  if (/mail\.google|gmail|\bemail\b|inbox/.test(text)) return 'gmail'
  if (/meet\.google/.test(text)) return 'meet'
  if (/drive\.google|folder/.test(text)) return 'drive'
}

export const approvalApp: Record<string, GoogleApp> = { doc_create: 'docs', doc_edit: 'docs', sheet_update: 'sheets', calendar_event: 'calendar', email: 'gmail' }

export const statusLabels: Record<MemberStatus, string> = { available: 'Available', in_meetings: 'In meetings', on_leave: 'On leave', away: 'Away' }
