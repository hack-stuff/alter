import { httpCall, MOCK } from './client'
import type { Approval, Answer, Citation } from './types'

export interface WorkTask { id: string; title: string; owner: string; due: string; state: string }
export interface Meeting {
  id: string; owner: string; title: string; participants: string[]; representedMember: string
  state: 'capturing' | 'preparing' | 'ready' | 'applying' | 'completed' | 'needs_attention' | 'cancelled' | 'paused'
  revision: number; createdAt: string; segmentCount: number; approvalIds: string[]
  tasks: WorkTask[]; decisions: (Citation & { text: string })[]
  events: { label: string; kind: string; ts: string; key?: string }[]
  continuation: string; escalationId?: string; launchState?: string; launchDecision?: { date: string }
  followupApprovalId?: string; followupAnswer?: Answer
  grant?: { state: string; expiresAt?: string }
}
export interface MeetingDetail extends Meeting {
  approvals: Approval[]
  segments: { id: string; text: string; speaker: string; kind: 'human' | 'alter'; sequence: number }[]
  jobs: { id: string; state: string; kind: string; reason?: string }[]
}
export interface Notice { id: string; title: string; body: string; path: string; ts: string; read: boolean; delivery: string }
function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (MOCK) return Promise.reject(new Error('Meeting capture needs the connected backend. This rehearsal uses sample chat and approvals.'))
  return httpCall(method, path, body)
}
export const meetingApi = {
  list: (): Promise<Meeting[]> => MOCK ? Promise.resolve([]) : call('GET', '/meetings'),
  get: (id: string): Promise<MeetingDetail> => call('GET', `/meetings/${id}`),
  create: (title: string, participants: string[], representedMember: string): Promise<Meeting> => call('POST', '/meetings', { title, participants, representedMember, consent: true }),
  append: (id: string, segments: { id: string; text: string; speaker?: string; kind: 'human' | 'alter' }[]) => call('POST', `/meetings/${id}/segments`, { segments }),
  finish: (id: string) => call('POST', `/meetings/${id}/finalize`),
  revise: (id: string, expectedRevision: number, instruction: string): Promise<MeetingDetail> => call('POST', `/meetings/${id}/revise`, { expectedRevision, instruction }),
  approve: (value: MeetingDetail, allowContinuation: boolean) => call('POST', `/meetings/${value.id}/approve`, { expectedRevision: value.revision, approvals: Object.fromEntries(value.approvals.map((a) => [a.id, a.revision])), allowContinuation }),
  revoke: (id: string) => call('POST', `/meetings/${id}/grant`, { decision: 'revoke' }),
  command: (id: string, command: 'retry' | 'cancel' | 'pause' | 'resume') => call('POST', `/meetings/${id}/commands`, { command }),
  ask: (id: string, question: string): Promise<Answer> => call('POST', `/meetings/${id}/ask`, { question }),
  room: (id: string): Promise<{ token: string; expiresAt: string }> => call('POST', `/meetings/${id}/room`),
}
