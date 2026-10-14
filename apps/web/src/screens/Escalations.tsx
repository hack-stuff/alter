import { useState } from 'react'
import { api } from '../api/client'
import type { Escalation, Member } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { VoiceControl } from '../components/VoiceControl'

function Question({ item, members, onRefresh }: { item: Escalation; members: Member[]; onRefresh: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const name = members.find((m) => m.id === item.fromAlter)?.name ?? 'Your teammate'
  async function send() {
    setBusy(true); setError('')
    try { await api.respondEscalation(item.id, reply.trim()); setConfirm(false); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send your reply. Please try again.') }
    finally { setBusy(false) }
  }
  return <article className="card"><p className="eyebrow">{item.state === 'pending' ? '⚑ Needs your decision' : item.state}</p><h3>{item.question}</h3><p>{name}'s Alter <AlterBadge /></p><p className="hint">{item.context}</p>
    {item.state === 'pending' ? <>
      <label>Your reply<textarea value={reply} onChange={(e) => { setReply(e.target.value); setConfirm(false) }} disabled={busy} /></label>
      <VoiceControl mode="reply" targetId={item.id} context={item.question} onTranscript={setReply} onResult={() => onRefresh()} draftOnly />
      {confirm ? <div className="confirmation"><p>Your answer will be sent to {name}'s Alter <AlterBadge />. Any proposed actions still need their owner's approval.</p><blockquote>{reply}</blockquote><div className="actions"><button className="primary" onClick={() => void send()} disabled={busy}>Send reply</button><button onClick={() => setConfirm(false)} disabled={busy}>Keep editing</button></div></div>
        : <button onClick={() => setConfirm(true)} disabled={busy || !reply.trim()}>Review reply</button>}
    </> : item.response && <p className="saved-response">Your answer: {item.response}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>
}
export function Escalations({ items, members, onRefresh }: { items: Escalation[]; members: Member[]; onRefresh: () => void }) {
  return <section className="screen"><h2>Decisions only you can make</h2><p className="hint">Your Alter asks when a request needs your judgment.</p><div className="card-list">{items.map((item) => <Question key={item.id} item={item} members={members} onRefresh={onRefresh} />)}</div>{!items.length && <p className="empty">Nothing needs your decision right now.</p>}</section>
}
