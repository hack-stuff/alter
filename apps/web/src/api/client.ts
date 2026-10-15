// Typed calls for contract §5. VITE_MOCK=1 serves contract fixtures with no backend.
import type { Answer, Approval, JoinResult, Message, Outcome, Memory, Member, Rule } from './types'
import { mockApi } from './mock/mockApi'

const BASE = import.meta.env.VITE_API_BASE?.trim() || 'http://localhost:8080/v1'
export const MOCK = import.meta.env.VITE_MOCK === '1'

export async function authorizationHeaders(): Promise<Record<string, string>> {
  const room = sessionStorage.getItem('alter.meeting.room')
  if (room && new URLSearchParams(location.search).get('kiosk') === '1') return { 'X-Meeting-Room': room }
  if (import.meta.env.VITE_DEV_AUTH === '1') {
    let uid = localStorage.getItem('alter.dev.uid')
    if (!uid) { uid = 'dev_' + crypto.randomUUID(); localStorage.setItem('alter.dev.uid', uid) }
    return { 'X-Dev-Uid': uid }
  }
  const { firebaseIdToken } = await import('../firebase-auth')
  return { Authorization: `Bearer ${await firebaseIdToken()}` }
}

export async function httpCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...await authorizationHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    const error = body?.error ?? body?.detail?.error
    throw new ApiError(typeof error?.message === 'string' ? error.message : `Request failed (${res.status}). Please try again.`, res.status)
  }
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export interface Api {
  me(): Promise<{ workspaceId: string; memberId: string; name: string; slot: string }>
  createWorkspace(name: string): Promise<JoinResult>
  joinWorkspace(inviteCode: string, name: string): Promise<JoinResult>
  resetWorkspace(): Promise<JoinResult>
  chat(message: string, conversationId?: string, via?: 'text' | 'voice'): Promise<{ conversationId: string; reply: Message }>
  askAlter(memberId: string, question: string): Promise<Answer>
  revise(approvalId: string, instruction: string, via?: 'text' | 'voice'): Promise<Approval>
  decide(approvalId: string, decision: 'approve' | 'reject', expectedRevision: number): Promise<Approval>
  respondEscalation(escalationId: string, text: string): Promise<{ decision: unknown; applied: string[] }>
  teach(content: string, audience?: 'owner' | 'team', appliesTo?: string): Promise<Memory>
  decideMemory(memoryId: string, decision: 'approve' | 'revoke'): Promise<Pick<Memory, 'id' | 'state'>>
  setRule(ruleId: string, mode: Outcome): Promise<Pick<Rule, 'id' | 'mode'>>
  updateMe(update: { email?: string; status?: 'available' | 'away' }): Promise<Partial<Member> & { email?: string }>
  directorClaim(workspaceId: string, memberId: string, key: string): Promise<JoinResult>
}

const httpApi: Api = {
  me: () => httpCall('GET', '/me'),
  createWorkspace: (name) => httpCall('POST', '/workspaces', { name }),
  joinWorkspace: (inviteCode, name) => httpCall('POST', '/workspaces/join', { inviteCode, name }),
  resetWorkspace: () => httpCall('POST', '/workspaces/reset'),
  chat: (message, conversationId, via = 'text') => httpCall('POST', '/chat', { message, conversationId, via }),
  askAlter: (mid, question) => httpCall('POST', `/alters/${mid}/ask`, { question }),
  revise: (id, instruction, via = 'text') => httpCall('POST', `/approvals/${id}/revise`, { instruction, via }),
  decide: (id, decision, expectedRevision) => httpCall('POST', `/approvals/${id}/decision`, { decision, expectedRevision }),
  respondEscalation: (id, text) => httpCall('POST', `/escalations/${id}/respond`, { text }),
  teach: (content, audience = 'team', appliesTo = 'Login revamp') => httpCall('POST', '/memories', { content, audience, appliesTo }),
  decideMemory: (id, decision) => httpCall('POST', `/memories/${id}/decision`, { decision }),
  setRule: (id, mode) => httpCall('PUT', `/rules/${id}`, { mode }),
  updateMe: (update) => httpCall('PUT', '/me', update),
  directorClaim: async (workspaceId, memberId, key) => {
    await httpCall('POST', '/director/claim', { workspaceId, memberId, key })
    const me = await httpCall<{ workspaceId: string; memberId: string; slot?: string }>('GET', '/me')
    return { workspaceId: me.workspaceId, memberId: me.memberId, slot: me.slot ?? 'seeded', inviteUrl: '' }
  },
}

export const api: Api = MOCK ? mockApi : httpApi
