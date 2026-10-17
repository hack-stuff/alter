import { useState } from 'react'
import { api } from '../api/client'
import type { Answer, Member } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { Citations } from '../components/Citations'
import { LiveTrace } from '../components/LiveTrace'
import { VoiceControl } from '../components/VoiceControl'
import { Icon } from '../components/Icon'
import { AlterMark, Avatar } from '../components/People'
import { statusLabels } from '../components/apps'

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
    <form onSubmit={ask}><label>Question for {member.name}'s Alter<textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about their work…" disabled={busy} required /></label><button className="primary" disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Send question'}</button></form>
    <VoiceControl mode="huddle" targetId={member.id} onResult={(result) => setAnswer(result as Answer)} />
    {busy && <p role="status" className="thinking"><span className="alter-glyph" aria-hidden="true">✦</span>Waiting for {member.name}'s Alter <AlterBadge />…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {answer && <section className={`answer answer-${answer.outcome}`} aria-label="Answer">
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
  return <section className="screen">
    <header className="page-head with-action"><div><h1>Your team</h1><p className="hint">Each person has an Alter that answers for them within their rules, even when they’re away.</p></div><button onClick={() => void copyInvite()}><Icon name="link" size={16} />Copy invite link</button></header>
    {inviteMessage && <div role="status" className="notice"><p>{inviteMessage}</p><input aria-label="Invite link" value={inviteUrl} readOnly onFocus={(e) => e.target.select()} /></div>}
    {members.length === 0 && <p className="empty">Team details are not available yet.</p>}
    <div className="team-grid">{members.filter((m) => m.id !== memberId).map((m) => {
      const away = m.status === 'on_leave' || m.status === 'away'
      return <article className={`sheet member-card${away ? ' is-away' : ''}`} key={m.id} tabIndex={-1} data-nav-id={m.id} data-nav-label={m.name}>
        <div className="member-pair">
          <div className="member-human"><Avatar name={m.name} id={m.id} away={away} /><div><h3>{m.name}</h3><p className="hint">{m.role}</p><span className={`member-status status-${m.status}`}>{statusLabels[m.status]}</span></div></div>
          <div className="member-alter"><AlterMark name={m.name} size="medium" /><div><strong>{m.name}'s Alter</strong><p className="hint">{away ? 'Answering while they’re away' : 'Ready to answer'}</p></div></div>
        </div>
        <button className="ask-toggle" aria-expanded={selected === m.id} onClick={() => setSelected(selected === m.id ? undefined : m.id)}>Ask {m.name}'s Alter <AlterBadge /></button>
        {selected === m.id && <AskMember member={m} workspaceId={workspaceId} />}
      </article>
    })}</div>
  </section>
}
