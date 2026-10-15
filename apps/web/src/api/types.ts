// Mirrors contract §4–5. Keep in sync with services/api/app/models.py.

export type Outcome = 'allow' | 'ask' | 'deny'
export type MemberStatus = 'available' | 'in_meetings' | 'on_leave' | 'away'

export interface Citation {
  sourceId: string
  title: string
  locator: string
  url?: string
}

export interface Member {
  id: string
  name: string
  kind: 'seeded' | 'human'
  slot?: string
  role: string
  email?: string
  status: MemberStatus
}

export interface JoinResult {
  workspaceId: string
  memberId: string
  slot: string
  inviteUrl: string
}

export interface Message {
  from: 'human' | 'alter'
  text: string
  citations: Citation[]
  approvalIds: string[]
  traceIds: string[]
  ts: string
}

export interface Answer {
  alter: string
  asker: string
  question: string
  outcome: Outcome
  answer: string
  citations: Citation[]
  escalationId?: string
  traceId: string
  receiptId: string
}

export interface Section {
  section: string
  lines: string[]
}

export interface Diff {
  op: 'add' | 'change' | 'remove'
  section: string
  line: string
}

export interface Approval {
  id: string
  owner: string
  kind: 'doc_create' | 'doc_edit' | 'sheet_update' | 'calendar_event' | 'email'
  title: string
  revision: number
  preview: { before?: Section[]; after: Section[]; diffs: Diff[] }
  citations: Citation[]
  target?: { url: string }
  state: 'proposed' | 'approved' | 'applied' | 'rejected' | 'failed'
  externalUrl?: string
  reason: string
}

export interface Escalation {
  id: string
  owner: string
  fromAlter: string
  askedBy: string
  question: string
  context: string
  effectDescription?: string
  state: 'pending' | 'answered' | 'expired'
  response?: string
}

export interface A2ATrace {
  id: string
  from: string
  to: string
  request: string
  policyChecks: { rule: string; label: string; outcome: Outcome }[]
  sources: Citation[]
  answer: string
  outcome: Outcome
  steps: string[]
}

export interface ActivityItem {
  id: string
  ts: string
  actor: string
  kind: string
  summary: string
  receiptId: string
  visibleTo: string[]
}

export interface Memory {
  id: string
  owner: string
  content: string
  source: 'starter' | 'taught' | 'correction'
  state: 'proposed' | 'approved' | 'revoked'
}
export interface Rule { id: string; label: string; intents: string[]; mode: Outcome }
export interface Receipt {
  id: string
  actor: { human?: string; alter: string }
  action: string
  sourcesUsed: { id: string; locator: string }[]
  policy: { rule: string; outcome: Outcome }
  approval?: { by: string; at: string }
  result: { ok: boolean; externalUrl?: string }
  ts: string
}
export interface InboxMessage { id: string; from: string; subject: string; body: string; gmailMessageUrl?: string; ts: string }
export interface ProgressEvent { id: string; kind: 'thinking' | 'tool' | 'a2a' | 'approval'; label: string; ts: string }
export interface Workspace {
  name: string
  inviteCode: string
  director?: boolean
  state?: 'provisioning' | 'provisioning_failed' | 'ready'
  aiBackend?: 'local' | 'vertex'
  simulated?: boolean
  google: { folderUrl?: string; docs: Record<string, string>; sheetUrl?: string; calendarUrl?: string }
}
export interface WorkspaceData {
  workspace?: Workspace
  members: Member[]
  approvals: Approval[]
  escalations: Escalation[]
  activity: ActivityItem[]
  receipts: Receipt[]
  memories: Memory[]
  rules: Rule[]
  inbox: InboxMessage[]
  traces: A2ATrace[]
  events: ProgressEvent[]
}
export const emptyWorkspace: WorkspaceData = { members: [], approvals: [], escalations: [], activity: [], receipts: [], memories: [], rules: [], inbox: [], traces: [], events: [] }
