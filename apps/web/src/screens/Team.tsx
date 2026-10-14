import { useState } from 'react'
import { api } from '../api/client'
import type { Answer, Member } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { Citations } from '../components/Citations'
import { LiveTrace } from '../components/LiveTrace'
import { VoiceControl } from '../components/VoiceControl'

const statusLabels = { available: 'Available', in_meetings: 'In meetings', on_leave: 'On leave', away: 'Away' }

function AskMember({ member, workspaceId }: { member: Member; workspaceId: string }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<Answer>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!question.trim() || busy) return
    setBusy(true)
    setError('')
    setAnswer(undefined)
    try { setAnswer(await api.askAlter(member.id, question.trim())) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send your question. Please try again.') }
    finally { setBusy(false) }
  }
  return <div className="ask-panel">
    <form onSubmit={ask}><label>Question for {member.name}'s Alter <AlterBadge /><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about their work…" disabled={busy} required /></label><button className="primary" disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Send question'}</button></form>
    <VoiceControl mode="huddle" targetId={member.id} onResult={(result) => setAnswer(result as Answer)} />
    {busy && <p role="status">Waiting for {member.name}'s Alter <AlterBadge />…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {answer && <section className="answer" aria-label="Answer">
      <span className={`outcome outcome-${answer.outcome}`}>{answer.outcome === 'allow' ? '✓ Allowed' : answer.outcome === 'ask' ? `⚑ Asked ${member.name}` : '× Not shared'}</span>
      <p>{answer.answer}</p><Citations sources={answer.citations} />
      <LiveTrace workspaceId={workspaceId} traceId={answer.traceId} />
      <details><summary>Your question</summary><p>Your question: {answer.question}</p>{answer.escalationId && <p>A decision has been requested from {member.name}.</p>}</details>
    </section>}
  </div>
}

export function Team({ members, memberId, inviteUrl, workspaceId }: { members: Member[]; memberId: string; inviteUrl: string; workspaceId: string }) {
  const [selected, setSelected] = useState<string>()
  const [inviteMessage, setInviteMessage] = useState('')
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); setInviteMessage('Invite link copied.') }
    catch { setInviteMessage('Copy the invite link below to share it.') }
  }
  return <section className="screen"><div className="section-heading"><div><h2>Your team</h2><p className="hint">Ask their Alters, even when your teammates are away.</p></div><button onClick={() => void copyInvite()}>Copy invite link</button></div>
    {inviteMessage && <div role="status"><p>{inviteMessage}</p><input aria-label="Invite link" value={inviteUrl} readOnly onFocus={(e) => e.target.select()} /></div>}
    {members.length === 0 && <p className="empty">Team details are not available yet.</p>}
    <div className="team-grid">{members.filter((m) => m.id !== memberId).map((m) => <article className="card" key={m.id}>
      <span className="member-status">{statusLabels[m.status]}</span><h3>{m.name}</h3><p>{m.role}</p>
      <button className="ask-toggle" aria-expanded={selected === m.id} onClick={() => setSelected(selected === m.id ? undefined : m.id)}>Ask {m.name}'s Alter <AlterBadge /></button>
      {selected === m.id && <AskMember member={m} workspaceId={workspaceId} />}
    </article>)}</div>
  </section>
}
