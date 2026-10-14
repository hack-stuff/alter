// Typed calls for contract §5. VITE_MOCK=1 serves contract fixtures with no backend.
import type { Answer, Approval, JoinResult, Message, Outcome, Memory, Member, Rule } from './types'
import { mockApi } from './mock/mockApi'

const BASE = import.meta.env.VITE_API_BASE?.trim() || 'http://localhost:8080/v1'
export const MOCK = import.meta.env.VITE_MOCK === '1'

export async function authorizationHeaders(): Promise<Record<string, string>> {
  if (import.meta.env.VITE_DEV_AUTH === '1') return { 'X-Dev-Uid': 'dev-user' }
  const { firebaseIdToken } = await import('../firebase-auth')
  return { Authorization: `Bearer ${await firebaseIdToken()}` }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  teach(content: string): Promise<Memory>
  decideMemory(memoryId: string, decision: 'approve' | 'revoke'): Promise<Pick<Memory, 'id' | 'state'>>
  setRule(ruleId: string, mode: Outcome): Promise<Pick<Rule, 'id' | 'mode'>>
  updateMe(update: { email?: string; status?: 'available' | 'away' }): Promise<Partial<Member> & { email?: string }>
  directorClaim(workspaceId: string, memberId: string, key: string): Promise<JoinResult>
}

const httpApi: Api = {
  me: () => call('GET', '/me'),
  createWorkspace: (name) => call('POST', '/workspaces', { name }),
  joinWorkspace: (inviteCode, name) => call('POST', '/workspaces/join', { inviteCode, name }),
  resetWorkspace: () => call('POST', '/workspaces/reset'),
  chat: (message, conversationId, via = 'text') => call('POST', '/chat', { message, conversationId, via }),
  askAlter: (mid, question) => call('POST', `/alters/${mid}/ask`, { question }),
  revise: (id, instruction, via = 'text') => call('POST', `/approvals/${id}/revise`, { instruction, via }),
  decide: (id, decision, expectedRevision) => call('POST', `/approvals/${id}/decision`, { decision, expectedRevision }),
  respondEscalation: (id, text) => call('POST', `/escalations/${id}/respond`, { text }),
  teach: (content) => call('POST', '/memories', { content }),
  decideMemory: (id, decision) => call('POST', `/memories/${id}/decision`, { decision }),
  setRule: (id, mode) => call('PUT', `/rules/${id}`, { mode }),
  updateMe: (update) => call('PUT', '/me', update),
  directorClaim: async (workspaceId, memberId, key) => {
    await call('POST', '/director/claim', { workspaceId, memberId, key })
    const me = await call<{ workspaceId: string; memberId: string; slot?: string }>('GET', '/me')
    return { workspaceId: me.workspaceId, memberId: me.memberId, slot: me.slot ?? 'seeded', inviteUrl: '' }
  },
}

export const api: Api = MOCK ? mockApi : httpApi
