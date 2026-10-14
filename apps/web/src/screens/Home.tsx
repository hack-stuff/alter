// My Alter (track-b §2). TODO: progress events, work panel previews, voice mode, approvals.
import { useState } from 'react'
import { api } from '../api/client'
import type { Message } from '../api/types'

const SUGGESTED = [
  'Why did we switch to one-tap sign-in?',
  "Ask Rahul's Alter to confirm the launch date",
  'Add a QA update to the status doc',
  'Book 30 min with Meera on Thursday',
]

export function Home({ name }: { name: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(text: string) {
    const mine: Message = { from: 'human', text, citations: [], approvalIds: [], traceIds: [], ts: new Date().toISOString() }
    setMessages((m) => [...m, mine])
    setDraft('')
    setBusy(true)
    const r = await api.chat(text, conversationId)
    setConversationId(r.conversationId)
    setMessages((m) => [...m, r.reply])
    setBusy(false)
  }

  return (
    <section className="screen">
      <h2>{name}'s Alter <span className="ai-badge">AI</span></h2>
      <div className="messages">
        {messages.map((m, i) => (
          <article key={i} className={`msg ${m.from}`}>
            <p>{m.text}</p>
            <div className="chips">
              {m.citations.map((c) => <span key={c.sourceId} className="chip">{c.title}</span>)}
              {m.approvalIds.map((id) => <span key={id} className="chip approval">Needs your approval</span>)}
            </div>
          </article>
        ))}
        {busy && <p className="thinking">Working on it…</p>}
      </div>
      {messages.length === 0 && (
        <div className="suggested">
          {SUGGESTED.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send(draft) }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask or delegate…" disabled={busy} />
        <button disabled={busy || !draft.trim()}>Send</button>
      </form>
    </section>
  )
}
