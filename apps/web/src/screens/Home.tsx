import { useEffect, useState } from 'react'
import { api, MOCK } from '../api/client'
import { timestamp } from '../api/presentation'
import { LiveTrace } from '../components/LiveTrace'
import { VoiceControl } from '../components/VoiceControl'
import type { Approval, Message, ProgressEvent } from '../api/types'
import { AlterBadge } from '../components/AlterBadge'
import { ApprovalCard } from '../components/ApprovalCard'
import { Citations } from '../components/Citations'

const SUGGESTED = ['Why did we switch to one-tap sign-in?', "What's blocking launch?", "Ask Rahul's Alter to confirm the launch date", 'Add a QA update to the status doc', 'Add a tracker row for the iOS crash', 'Book 30 min with Meera on Thursday', 'Email the team a QA summary']

export function Home({ name, workspaceId, approvals, events, onUpdate, active = true }: { name: string; workspaceId: string; approvals: Approval[]; events: ProgressEvent[]; onUpdate: (a: Approval) => void; active?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mobileTab, setMobileTab] = useState<'chat' | 'work'>('chat')
  const [liveEvents, setLiveEvents] = useState<ProgressEvent[]>([])
  const [streamedMessages, setStreamedMessages] = useState<{ id: string; items: Message[] }>()
  useEffect(() => {
    if (MOCK || !conversationId || import.meta.env.VITE_DEV_AUTH === '1') return
    let stopped = false
    const unsubscribe: (() => void)[] = []
    void import('../firebase').then(({ watchEvents, watchMessages }) => {
      if (stopped) return
      unsubscribe.push(watchEvents(workspaceId, conversationId, setLiveEvents, () => setLiveEvents([])))
      unsubscribe.push(watchMessages(workspaceId, conversationId, (items) => setStreamedMessages({ id: conversationId, items }), () => setStreamedMessages({ id: conversationId, items: [] })))
    }).catch(() => { if (!stopped) setLiveEvents([]) })
    return () => { stopped = true; unsubscribe.forEach((off) => off()) }
  }, [workspaceId, conversationId])
  function receive(r: { conversationId: string; reply: Message }, text: string) {
    setMessages((m) => [...m, { from: 'human', text, citations: [], approvalIds: [], traceIds: [], ts: timestamp() }, r.reply])
    setConversationId(r.conversationId)
  }
  async function send(text: string) {
    if (busy || !text.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = await api.chat(text.trim(), conversationId)
      receive(r, text.trim())
      setDraft('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send your message. Please try again.'); setDraft(text) }
    finally { setBusy(false) }
  }
  const conversation = streamedMessages && streamedMessages.id === conversationId && streamedMessages.items.length ? streamedMessages.items : messages
  const approvalIds = [...new Set(conversation.flatMap((m) => m.approvalIds))]
  const work = approvals.filter((a) => approvalIds.includes(a.id))
  return <section className="screen"><h2>{name}'s Alter <AlterBadge /></h2><p className="hint">Ask a question. Delegate a task. Stay in control of what happens next.</p>
    <div className="mobile-tabs"><button aria-pressed={mobileTab === 'chat'} onClick={() => setMobileTab('chat')}>Chat</button><button aria-pressed={mobileTab === 'work'} onClick={() => setMobileTab('work')}>Work ({work.length})</button></div>
    <div className={`home-layout mobile-${mobileTab}`}>
      <div className="chat-panel">
        <div className="messages" role="log" aria-label="Conversation">
          {conversation.map((m, i) => <article key={i} className={`msg ${m.from}`}>
            {m.from === 'alter' && <div className="message-author">Your Alter <AlterBadge /></div>}
            <p>{m.text}</p><Citations sources={m.citations} />
            {m.traceIds.map((id) => <LiveTrace key={id} workspaceId={workspaceId} traceId={id} />)}
            {m.approvalIds.length > 0 && <button className="chip approval" onClick={() => { setMobileTab('work'); document.getElementById('work-panel')?.focus() }}>Review proposal</button>}
          </article>)}
        </div>
        {busy && <p className="thinking" role="status">{[...(MOCK ? events : liveEvents)].sort((a, b) => a.ts.localeCompare(b.ts)).at(-1)?.label ?? 'Your Alter is working on your request…'}</p>}
        {conversation.length === 0 && <div className="suggested">{SUGGESTED.map((s) => <button key={s} disabled={busy} onClick={() => void send(s)}>{s} <span aria-hidden="true">↗</span></button>)}</div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(draft) }}><label className="sr-only" htmlFor="message">Message your Alter</label><input id="message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask or delegate…" disabled={busy} /><button className="primary" disabled={busy || !draft.trim()}>Send</button></form>
        {active && <VoiceControl mode="chat" conversationId={conversationId} onTranscript={setDraft} onResult={(result, _tool, text) => receive(result as { conversationId: string; reply: Message }, text)} />}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
      <aside className="work-panel" id="work-panel" tabIndex={-1} aria-label="Work panel"><h3>Work panel</h3>
        {work.length ? work.map((a) => <ApprovalCard key={a.id} voiceEnabled={active} approval={a} onUpdate={onUpdate} />) : <p className="empty">{approvalIds.length ? 'Your proposal preview is not available yet.' : 'Proposals will appear here when you ask your Alter to draft a change.'}</p>}
      </aside>
    </div>
  </section>
}
