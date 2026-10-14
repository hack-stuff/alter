import workspace from '@contracts/fixtures/workspace.json'
import approvals from '@contracts/fixtures/approvals.json'
import activity from '@contracts/fixtures/activity.json'
import defaults from '../../../../../services/api/seed/policies/slot-default.json'
import { resetMockTraces } from './traces'
import { timestamp } from '../presentation'
import { emptyWorkspace } from '../types'
import type { Approval, JoinResult, Member, WorkspaceData, Outcome, Memory, Receipt, Answer, A2ATrace } from '../types'

let generation = 0
let counter = 10
let session = { ...workspace.created }
const listeners = new Set<() => void>()

const extraApprovals: Approval[] = [
  { id: 'apr_sheet', owner: 'm_judge', kind: 'sheet_update', title: 'Login revamp tracker · iOS crash', revision: 1, state: 'proposed', reason: 'You asked for a tracker row for the iOS crash.', citations: [], preview: { before: [{ section: 'Tracker row', lines: ['No row yet'] }], after: [{ section: 'Tracker row', lines: ['AUTH-113 | iOS sign-in crash | QA | Open | Sign-off pending'] }], diffs: [{ op: 'add', section: 'Tracker row', line: 'AUTH-113 | iOS sign-in crash | QA | Open | Sign-off pending' }] } },
  { id: 'apr_email', owner: 'm_judge', kind: 'email', title: 'Team email · QA summary', revision: 1, state: 'proposed', reason: 'You asked to email the team a QA summary.', citations: [{ sourceId: 'test-plan', title: 'Test plan v1', locator: '§3' }], preview: { after: [{ section: 'To', lines: ['Workspace team inboxes'] }, { section: 'Subject', lines: ['Login revamp · QA summary'] }, { section: 'Body', lines: ['Test plan covers Android 12+ and iOS 16+. Two open bugs; sign-off is pending.'] }], diffs: [] } },
]

function fresh(): WorkspaceData {
  return {
    ...structuredClone(emptyWorkspace), workspace: structuredClone(workspace.workspace),
    members: mockMembers(session, 'You'),
    approvals: [...structuredClone(approvals.approvals) as Approval[], ...structuredClone(extraApprovals)].map((a) => ({ ...a, owner: session.memberId })),
    escalations: [{ ...activity.escalation, state: 'pending', owner: session.memberId }],
    activity: activity.activity.map((a) => ({ ...a, visibleTo: [session.memberId] })),
    receipts: [activity.receipt as Receipt],
    memories: [{ id: 'mem_qa', owner: session.memberId, source: 'starter', state: 'approved', content: 'Test plan v1: Android 12+, iOS 16+. Two open bugs; sign-off pending.' }],
    rules: structuredClone(defaults.rules) as WorkspaceData['rules'],
    inbox: [{ id: 'inbox_welcome', from: 'priya', subject: 'Welcome to the Login revamp team', body: 'Your QA notes are ready. Please review the sign-off question in Needs you.', ts: timestamp() }],
  }
}
let data = fresh()
export function mockGeneration() { return generation }
export function mockSnapshot() { return data }
export function subscribeMock(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(next: WorkspaceData) { data = next; listeners.forEach((listener) => listener()) }
export function patchMock(patch: Partial<WorkspaceData>) { publish({ ...data, ...patch }) }
export function mockApprovals() { return structuredClone(data.approvals) }
export function mockMembers(join: JoinResult, name: string): Member[] {
  return [...(workspace.members as Member[]).filter((m) => m.id !== 'm_judge'), { id: join.memberId, name, kind: 'human', slot: join.slot, role: join.slot === 'security_engineer' ? 'Security engineer' : 'QA lead', status: 'available' }]
}
export function resetMockWorkspace(invited?: boolean, name = 'You') {
  generation++
  resetMockTraces()
  if (invited !== undefined) session = { ...workspace.created, memberId: invited ? 'm_invited' : 'm_judge', slot: invited ? 'security_engineer' : 'qa_lead' }
  const next = fresh()
  next.members = mockMembers(session, name)
  publish(next)
}
export function findMockApproval(id: string): Approval {
  const card = data.approvals.find((c) => c.id === id)
  if (!card) throw new Error('This proposal is no longer available.')
  return structuredClone(card)
}
export function saveMockApproval(card: Approval) {
  patchMock({ approvals: data.approvals.map((c) => c.id === card.id ? structuredClone(card) : c) })
  return structuredClone(card)
}
export function mockJoinResult(): JoinResult { return { ...session, inviteUrl: new URL(`/join/${workspace.workspace.inviteCode}`, window.location.origin).href } }
export function setMockProgress(label?: string) { patchMock({ events: label ? [{ id: 'progress', kind: 'thinking', label, ts: timestamp() }] : [] }) }
export function addMockTrace(trace: A2ATrace) { patchMock({ traces: [...data.traces, trace] }) }
export function addMockActivity(summary: string, action: string, outcome: Outcome = 'allow', sources: Receipt['sourcesUsed'] = [], result: Receipt['result'] = { ok: true }, approved = false) {
  const id = `rcp_mock_${++counter}`
  const ts = timestamp()
  const receipt: Receipt = { id, actor: { alter: session.memberId }, action, sourcesUsed: sources, policy: { rule: approved ? 'owner-approval' : 'share-rationale', outcome }, result, ts, ...(approved ? { approval: { by: session.memberId, at: ts } } : {}) }
  patchMock({ receipts: [...data.receipts, receipt], activity: [...data.activity, { id: `act_mock_${counter}`, ts, actor: session.memberId, kind: action, summary, receiptId: id, visibleTo: [session.memberId] }] })
  return id
}
export function teachMock(content: string): Memory {
  const memory: Memory = { id: `mem_mock_${++counter}`, owner: session.memberId, source: 'taught', state: 'proposed', content }
  patchMock({ memories: [...data.memories, memory] })
  return memory
}
export function recordMockAnswer(answer: Answer) {
  if (answer.outcome === 'ask' && answer.escalationId && !data.escalations.some((e) => e.id === answer.escalationId)) {
    patchMock({ escalations: [...data.escalations, { id: answer.escalationId, owner: answer.alter, fromAlter: session.memberId, askedBy: session.memberId, question: answer.question, context: answer.answer, state: 'pending' }] })
  }
}
