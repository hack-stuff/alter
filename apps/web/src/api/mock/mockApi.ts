// Offline stand-in for Track A, built from the shared contract fixtures.
import answers from '@contracts/fixtures/answers.json'
import approvals from '@contracts/fixtures/approvals.json'
import workspace from '@contracts/fixtures/workspace.json'
import { rememberMockTrace } from './traces'
import type { Api } from '../client'
import { findMockApproval, mockGeneration, mockJoinResult, resetMockWorkspace, saveMockApproval, mockSnapshot, patchMock, teachMock, addMockActivity, setMockProgress } from './workspace'
import type { Answer, Message } from '../types'

const delay = <T,>(value: T, ms = 600) => new Promise<T>((r) => setTimeout(() => r(value), ms))

function answerKey(question: string): keyof typeof answers {
  const q = question.toLowerCase()
  if (q.includes('launch') || q.includes('confirm')) return 'launch_date'
  if (q.includes('leave')) return 'personal'
  return 'why_one_tap'
}

export const mockApi: Api = {
  me: () => delay({ ...mockJoinResult(), name: mockSnapshot().members.find((m) => m.id === mockJoinResult().memberId)?.name ?? 'You' }),
  createWorkspace: (name) => { resetMockWorkspace(false, name); return delay(mockJoinResult()) },
  joinWorkspace: (code, name) => { if (code !== 'INV123') return Promise.reject(new Error('This invite link is not valid. Ask your teammate for a new link.')); resetMockWorkspace(true, name); return delay(mockJoinResult()) },
  resetWorkspace: () => { const name = mockSnapshot().members.find((m) => m.id === mockJoinResult().memberId)?.name ?? 'You'; resetMockWorkspace(undefined, name); return delay(mockJoinResult()) },
  chat: async (message) => {
    const generation = mockGeneration()
    setMockProgress(/why|launch|leave|confirm/i.test(message) ? "Asking Rahul's Alter…" : 'Preparing a preview for your review…')
    await delay(undefined, 600)
    if (generation !== mockGeneration()) throw new Error('The workspace was reset. Please try again.')
    setMockProgress()
    if (/why|when|launch|leave/i.test(message)) {
      const answer = rememberMockTrace({ ...(answers[answerKey(message)] as Answer), question: message })
      return delay({ conversationId: 'conv_01', reply: {
        from: 'alter' as const, text: answer.answer, citations: answer.citations,
        approvalIds: [], traceIds: [answer.traceId], ts: new Date().toISOString(),
      } }, 1500)
    }
    const id = /book|meeting|calendar/i.test(message) ? 'apr_event' : /tracker|row|sheet|crash/i.test(message) ? 'apr_sheet' : /email|summary/i.test(message) ? 'apr_email' : 'apr_doc'
    const card = findMockApproval(id)
    const reply: Message = { ...structuredClone(approvals.chat_reply.reply as Message), text: id === 'apr_doc' ? approvals.chat_reply.reply.text : `I drafted ${card.title.toLowerCase()}. Review the preview before I apply it.`, approvalIds: [id], traceIds: [], ts: new Date().toISOString() }
    return delay({ conversationId: 'conv_01', reply }, 600)
  },
  askAlter: (mid, question) => {
    const sample = answers[answerKey(question)] as Answer
    const name = workspace.members.find((m) => m.id === mid)?.name ?? 'Your teammate'
    const answer = sample.outcome === 'allow' ? sample.answer
      : sample.outcome === 'ask' ? `That decision needs ${name}'s approval. I've asked them to confirm.`
      : `I can't share that. It's outside what ${name} allows me to share.`
    return delay(rememberMockTrace({ ...sample, alter: mid, question, answer }), 1500)
  },
  revise: async (id, instruction) => {
    const generation = mockGeneration()
    await delay(undefined)
    if (generation !== mockGeneration()) throw new Error('The workspace was reset. Please try again.')
    const a = findMockApproval(id)
    if (a.state !== 'proposed') throw new Error('Only pending proposals can be revised.')
    if (!instruction.trim()) throw new Error('Enter revision instructions.')
    return saveMockApproval({
      ...a,
      revision: a.revision + 1,
      preview: {
        ...a.preview,
        after: [...a.preview.after, { section: 'Notes', lines: [instruction] }],
        diffs: [{ op: 'add' as const, section: 'Notes', line: instruction }],
      },
    })
  },
  decide: async (id, decision, expectedRevision) => {
    const generation = mockGeneration()
    await delay(undefined)
    if (generation !== mockGeneration()) throw new Error('The workspace was reset. Please try again.')
    const a = findMockApproval(id)
    if (a.revision !== expectedRevision) throw new Error('This proposal changed. Review the latest version.')
    if (a.state !== 'proposed') throw new Error('This proposal has already been decided.')
    const updated = saveMockApproval({ ...a, state: decision === 'approve' ? 'applied' : 'rejected' })
    addMockActivity(`${decision === 'approve' ? 'Applied' : 'Rejected'} ${a.title}`, decision === 'approve' ? a.kind : 'rejected', 'allow', a.citations.map((c) => ({ id: c.sourceId, locator: c.locator })), { ok: decision === 'approve' }, true)
    if (decision === 'approve' && a.kind === 'email') {
      patchMock({ inbox: [...mockSnapshot().inbox, { id: `mail_${a.id}_${a.revision}`, from: mockJoinResult().memberId, subject: a.preview.after.find((s) => s.section === 'Subject')?.lines.join(' ') ?? a.title, body: a.preview.after.find((s) => s.section === 'Body')?.lines.join('\n') ?? '', ts: new Date().toISOString() }] })
    }
    return updated
  },
  respondEscalation: async (id, text) => {
    if (!text.trim()) throw new Error('Enter a reply before sending.')
    await delay(undefined)
    const item = mockSnapshot().escalations.find((e) => e.id === id)
    if (!item || item.owner !== mockJoinResult().memberId || item.state !== 'pending') throw new Error('This question is no longer awaiting your reply.')
    patchMock({ escalations: mockSnapshot().escalations.map((e) => e.id === id ? { ...e, state: 'answered', response: text.trim() } : e) })
    addMockActivity('Replied to the QA sign-off question', 'answered', 'allow')
    return { decision: { type: 'free_text', text: text.trim() }, applied: [] }
  },
  teach: async (content) => { if (!content.trim()) throw new Error('Enter a memory.'); await delay(undefined); return teachMock(content.trim()) },
  decideMemory: async (id, decision) => {
    await delay(undefined)
    const state = decision === 'approve' ? 'approved' as const : 'revoked' as const
    if (!mockSnapshot().memories.some((m) => m.id === id)) throw new Error('This memory is no longer available.')
    patchMock({ memories: mockSnapshot().memories.map((m) => m.id === id ? { ...m, state } : m) })
    return { id, state }
  },
  setRule: async (id, mode) => { await delay(undefined); patchMock({ rules: mockSnapshot().rules.map((r) => r.id === id ? { ...r, mode } : r) }); return { id, mode } },
  updateMe: async (update) => { await delay(undefined); patchMock({ members: mockSnapshot().members.map((m) => m.id === mockJoinResult().memberId ? { ...m, ...update } : m) }); return update },
  directorClaim: async () => { throw new Error('Director mode requires a configured video workspace.') },
}
