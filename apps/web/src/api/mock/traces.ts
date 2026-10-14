import { addMockTrace } from './workspace'
import type { A2ATrace, Answer, Outcome } from '../types'

// Sample policy results for the contract's three canned answers, not a client policy engine.
const sampleRules: Record<Outcome, { rule: string; label: string }> = {
  allow: { rule: 'share-rationale', label: 'Share project rationale with the team' },
  ask: { rule: 'commitments', label: 'Ask the owner before committing to dates' },
  deny: { rule: 'personal', label: 'Keep personal information private' },
}
const traces = new Map<string, A2ATrace>()
let sequence = 0

export function rememberMockTrace(answer: Answer): Answer {
  const id = `trc_mock_${++sequence}`
  traces.set(id, {
    id, from: answer.asker, to: answer.alter, request: answer.question,
    policyChecks: [{ ...sampleRules[answer.outcome], outcome: answer.outcome }],
    sources: answer.citations, answer: answer.answer, outcome: answer.outcome,
    steps: ['Question sent to the teammate’s Alter', 'Sharing rules checked', answer.outcome === 'allow' ? 'Answer returned with sources' : answer.outcome === 'ask' ? 'Decision requested from the owner' : 'Private information kept private'],
  })
  addMockTrace(traces.get(id)!)
  return { ...answer, traceId: id }
}
export function mockTrace(id: string) { return traces.get(id) }
export function resetMockTraces() { traces.clear() }
