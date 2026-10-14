// Typed calls for contract §5. VITE_MOCK=1 serves contract fixtures with no backend.
import type { Answer, Approval, JoinResult, Message, Outcome } from './types'
import { mockApi } from './mock/mockApi'

const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/v1'
const MOCK = import.meta.env.VITE_MOCK === '1'

// TODO(track-b §1 firebase.ts): send the Firebase anonymous ID token instead of a dev header.
const devUid = 'dev-user'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-Uid': devUid },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export interface Api {
  createWorkspace(name: string): Promise<JoinResult>
  joinWorkspace(inviteCode: string, name: string): Promise<JoinResult>
  resetWorkspace(): Promise<JoinResult>
  chat(message: string, conversationId?: string, via?: 'text' | 'voice'): Promise<{ conversationId: string; reply: Message }>
  askAlter(memberId: string, question: string): Promise<Answer>
  revise(approvalId: string, instruction: string, via?: 'text' | 'voice'): Promise<Approval>
  decide(approvalId: string, decision: 'approve' | 'reject', expectedRevision: number): Promise<Approval>
  respondEscalation(escalationId: string, text: string): Promise<{ decision: unknown; applied: string[] }>
  teach(content: string): Promise<unknown>
  decideMemory(memoryId: string, decision: 'approve' | 'revoke'): Promise<unknown>
  setRule(ruleId: string, mode: Outcome): Promise<unknown>
}

const httpApi: Api = {
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
}

export const api: Api = MOCK ? mockApi : httpApi
