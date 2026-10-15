import { httpCall, MOCK } from './client'
import type { Approval } from './types'

export interface DiagramNode {
  id: string
  label: string
  category: 'ui' | 'backend' | 'decision' | 'fallback' | 'review'
  description: string
  x: number
  y: number
  connections: string[]
}
export interface Plan {
  id: string
  owner: string
  title: string
  revision: number
  nodes: DiagramNode[]
  explanation: string
  updatedAt: string
  canUndo: boolean
  approval?: Approval
}
function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return MOCK
    ? Promise.reject(
        new Error(
          'The design canvas needs the connected backend. Run the local API or open the deployed app.',
        ),
      )
    : httpCall(method, path, body)
}
export const planApi = {
  get: (id = 'login'): Promise<Plan> => call('GET', `/plans/${id}`),
  revise: (
    id: string,
    expectedRevision: number,
    instruction: string,
  ): Promise<Plan> =>
    call('POST', `/plans/${id}/revise`, { expectedRevision, instruction }),
  undo: (id: string, expectedRevision: number): Promise<Plan> =>
    call('POST', `/plans/${id}/undo`, { expectedRevision }),
  prepare: (id: string, expectedRevision: number): Promise<Plan> =>
    call('POST', `/plans/${id}/prepare`, { expectedRevision }),
}
