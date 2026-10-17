import { useState } from 'react'
import { api, httpCall, MOCK } from '../api/client'
import type { Escalation, Member } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { VoiceControl } from '../components/VoiceControl'
import { AlterMark, Avatar } from '../components/People'

// Quick replies only fill the draft; nothing is sent until the reply is reviewed.
const QUICK_REPLIES = ['Yes, go ahead.', 'Not yet — let’s hold.', 'I’ll check and get back to you.']

export function Question({ item, members, meName = 'You', onRefresh }: { item: Escalation; members: Member[]; meName?: string; onRefresh: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [date, setDate] = useState('')
  async function preview() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const value = MOCK ? { decision: null } : await httpCall<{ decision: { date: string } | null }>('POST', `/escalations/${item.id}/preview`, { text: reply.trim() })
      setDate(value.decision?.date ?? ''); setConfirm(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not preview your reply.') }
    finally { setBusy(false) }
  }
  const name = members.find((m) => m.id === item.fromAlter)?.name ?? 'Your teammate'
  const asker = members.find((m) => m.id === item.askedBy)?.name ?? name
  async function send() {
    setBusy(true); setError('')
    try { await api.respondEscalation(item.id, reply.trim()); setConfirm(false); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send your reply. Please try again.') }
    finally { setBusy(false) }
  }
  return <article className="sheet decision-card" tabIndex={-1} data-nav-id={item.id} data-nav-label={`${item.question} ${asker} ${name}`}>
    <ol className="escalation-path" aria-label="How this question reached you">
      <li><Avatar name={asker} size="small" /><span>{asker}</span></li>
      <li className="is-alter"><AlterMark size="small" /><span>{name}’s Alter · needs owner</span></li>
      <li><Avatar name={meName} size="small" /><span>You</span></li>
    </ol>
    <p className="eyebrow">{item.state === 'pending' ? 'Needs your decision' : item.state === 'answered' ? 'Answered' : 'Expired'}</p>
    <h3>{item.question}</h3>
    <p className="hint">From {name}'s Alter <AlterBadge /> · {item.context}</p>
    {item.effectDescription && item.state === 'pending' && <p className="effect-note">If you confirm a date: {item.effectDescription}</p>}
    {item.state === 'pending' ? <>
      <div className="chip-row" aria-label="Quick replies">{QUICK_REPLIES.map((text) => <button key={text} type="button" className="chip" disabled={busy} onClick={() => { setReply(text); setConfirm(false) }}>{text}</button>)}</div>
      <label>Your reply<textarea value={reply} onChange={(e) => { setReply(e.target.value); setConfirm(false) }} disabled={busy} /></label>
      <VoiceControl mode="reply" targetId={item.id} context={item.question} onTranscript={setReply} onResult={() => onRefresh()} draftOnly />
      {confirm ? <div className="confirmation"><p>Your answer will be sent to {name}'s Alter <AlterBadge />. {date ? `Confirming ${date} will update the status document and notify the authorized meeting participants.` : 'This reply does not confirm a parsed launch date.'}</p><blockquote>{reply}</blockquote><div className="actions"><button className="primary" onClick={() => void send()} disabled={busy}>Send reply</button><button onClick={() => setConfirm(false)} disabled={busy}>Keep editing</button></div></div>
        : <div className="actions"><button onClick={() => void preview()} disabled={busy || !reply.trim()}>Review reply</button></div>}
    </> : item.response && <><p className="saved-response">Your answer: {item.response}</p>{item.effectState === 'failed' && <p className="error">Your decision was recorded, but the document update could not be confirmed. The team has not been told the update succeeded.</p>}{item.effectState === 'applied' && <p className="state-applied">✓ Date recorded in the status doc · team notified in Alter</p>}</>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>
}

export function Escalations({ items, members, meName, onRefresh }: { items: Escalation[]; members: Member[]; meName?: string; onRefresh: () => void }) {
  return <section className="screen">
    <header className="page-head"><h1>Decisions only you can make</h1><p className="hint">Your Alter asks when a request needs your judgment, such as committing to a date.</p></header>
    <div className="stack">{items.map((item) => <Question key={item.id} item={item} members={members} meName={meName} onRefresh={onRefresh} />)}</div>
    {!items.length && <p className="empty">Nothing needs your decision right now.</p>}
  </section>
}
