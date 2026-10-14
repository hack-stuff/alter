// Offline stand-in for Track A, built from the shared contract fixtures.
import answers from '@contracts/fixtures/answers.json'
import approvals from '@contracts/fixtures/approvals.json'
import workspace from '@contracts/fixtures/workspace.json'
import type { Api } from '../client'
import type { Answer, Approval, Message } from '../types'

const delay = <T,>(value: T, ms = 600) => new Promise<T>((r) => setTimeout(() => r(value), ms))
const cards = approvals.approvals as Approval[]
const find = (id: string) => {
  const a = cards.find((x) => x.id === id)
  if (!a) throw new Error(`mock: no approval ${id}`)
  return a
}

function answerKey(question: string): keyof typeof answers {
  const q = question.toLowerCase()
  if (q.includes('launch') || q.includes('confirm')) return 'launch_date'
  if (q.includes('leave')) return 'personal'
  return 'why_one_tap'
}

export const mockApi: Api = {
  createWorkspace: () => delay(workspace.created),
  joinWorkspace: () => delay({ ...workspace.created, memberId: 'm_invited', slot: 'security_engineer' }),
  resetWorkspace: () => delay(workspace.created),
  chat: (message) => {
    const reply = /why|when|launch|leave/i.test(message)
      ? { from: 'alter' as const, text: answers[answerKey(message)].answer, citations: answers[answerKey(message)].citations,
          approvalIds: [], traceIds: [answers[answerKey(message)].traceId], ts: new Date().toISOString() }
      : (approvals.chat_reply.reply as Message)
    return delay({ conversationId: 'conv_01', reply }, 1500)
  },
  askAlter: (mid, question) => delay({ ...(answers[answerKey(question)] as Answer), alter: mid, question }, 1500),
  revise: (id, instruction) => {
    const a = find(id)
    return delay({
      ...a,
      revision: a.revision + 1,
      preview: {
        ...a.preview,
        after: [...a.preview.after, { section: 'Notes', lines: [instruction] }],
        diffs: [{ op: 'add' as const, section: 'Notes', line: instruction }],
      },
    })
  },
  decide: (id, decision) => delay({ ...find(id), state: decision === 'approve' ? 'applied' : 'rejected' }),
  respondEscalation: (_id, text) => delay({ decision: { type: 'free_text', text }, applied: [] }),
  teach: (content) => delay({ id: 'mem_new', content, source: 'taught', state: 'proposed' }),
  decideMemory: (id, decision) => delay({ id, state: decision === 'approve' ? 'approved' : 'revoked' }),
  setRule: (id, mode) => delay({ id, mode }),
}
