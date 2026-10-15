import { useEffect, useRef, useState } from 'react'
import { api, MOCK, httpCall } from '../api/client'
import { dayApi, type Day } from '../api/day'
import { workSurface } from '../agent/navigation'
import { timestamp } from '../api/presentation'
import { LiveTrace } from '../components/LiveTrace'
import { VoiceControl } from '../components/VoiceControl'
import { AlterBadge } from '../components/AlterBadge'
import { ApprovalCard } from '../components/ApprovalCard'
import { Citations } from '../components/Citations'
import { Icon } from '../components/Icon'
import { Question } from './Escalations'
import { listen, speak, stopSpeaking, isVoiceMuted, setVoiceMuted } from '../agent/voice'
import type { Approval, Escalation, Member, Message, ProgressEvent } from '../api/types'

const DIRECTIVES: { kind: 'do' | 'say'; text: string; open?: 'meet' | 'plan' }[] = [
  { kind: 'do', text: 'Join the 2:00 team sync on Meet', open: 'meet' },
  { kind: 'do', text: 'Open the shared plan', open: 'plan' },
  { kind: 'say', text: 'Why did we switch to one-tap sign-in?' },
  { kind: 'say', text: "Ask Rahul's Alter to confirm the launch date" },
  { kind: 'say', text: 'Add a QA update to the status doc' },
  { kind: 'say', text: 'Add a tracker row for the iOS crash' },
  { kind: 'say', text: 'Book 30 min with Meera on Thursday' },
  { kind: 'say', text: 'Email the team a QA summary' },
  { kind: 'say', text: "What's blocking launch?" },
]

interface Offer {
  key: string
  num: string
  glyph: string
  kicker: string
  title: string
  desc: string
  go: string
  hot: RegExp
  sayLine: string
  run: () => void
}

export function Alter({ name, workspaceId, members, approvals, escalations, events, active = true, onUpdate, onRefresh, onOpen }: {
  name: string
  workspaceId: string
  members: Member[]
  approvals: Approval[]
  escalations: Escalation[]
  events: ProgressEvent[]
  active?: boolean
  onUpdate: (a: Approval) => void
  onRefresh: () => void
  onOpen: (screen: 'meet' | 'plan' | 'approvals' | 'activity') => void
}) {
  const [day, setDay] = useState<Day>()
  const [dayError, setDayError] = useState('')
  const [voiceState, setVoiceState] = useState<'connecting' | 'listening' | 'speaking' | 'closed'>('closed')
  useEffect(() => {
    if (MOCK || !active) return
    let stopped = false
    void dayApi.get().then((value) => { if (!stopped) { setDay(value); setDayError(value.agendaError) } }).catch((e) => { if (!stopped) setDayError(e.message) })
    return () => { stopped = true }
  }, [workspaceId, active])
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(() => MOCK ? undefined : sessionStorage.getItem('alter.conversation.' + workspaceId) ?? undefined)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [liveEvents, setLiveEvents] = useState<ProgressEvent[]>([])
  const [streamedMessages, setStreamedMessages] = useState<{ id: string; items: Message[] }>()
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(() => isVoiceMuted())
  const [mic, setMic] = useState<'idle' | 'listening' | 'unsupported'>('idle')
  const [heard, setHeard] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [pickEcho, setPickEcho] = useState('')
  useEffect(() => { if (conversationId && !MOCK) sessionStorage.setItem('alter.conversation.' + workspaceId, conversationId) }, [workspaceId, conversationId])
  useEffect(() => {
    if (MOCK || !conversationId) return
    let stopped = false
    const unsubscribe: (() => void)[] = []
    void (import.meta.env.VITE_DEV_AUTH === '1' ? import('../api/polling') : import('../firebase')).then(({ watchEvents, watchMessages }) => {
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
    const destination = workSurface(text)
    if (destination) { onOpen(destination); setDraft(''); return }
    setBusy(true); setError('')
    try {
      let cid = conversationId
      if (!MOCK && !cid) { cid = (await httpCall<{ conversationId: string }>('POST', '/conversations')).conversationId; setConversationId(cid) }
      const r = await api.chat(text.trim(), cid)
      receive(r, text.trim())
      setDraft('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send your message. Please try again.'); setDraft(text) }
    finally { setBusy(false) }
  }

  const conversation = streamedMessages && streamedMessages.id === conversationId && streamedMessages.items.length ? streamedMessages.items : messages
  const rahulName = members.find((m) => m.id === 'rahul')?.name ?? 'Rahul'
  const pending = approvals.filter((a) => a.state === 'proposed')
  const tiedIds = new Set(conversation.flatMap((m) => m.approvalIds))
  const waitingDrafts = pending.filter((a) => !tiedIds.has(a.id))
  const asks = escalations.filter((e) => e.state === 'pending')
  const latest = [...(MOCK ? events : liveEvents)].sort((a, b) => a.ts.localeCompare(b.ts)).at(-1)?.label
  const needsCount = pending.length + asks.length
  const stateLine = busy ? `Working — ${latest ?? 'on it'}` : needsCount ? `${needsCount} thing${needsCount === 1 ? '' : 's'} waiting on you` : 'Here with you'

  const statusText = `Hello ${name}. Your login journey and team follow-up are here. ${rahulName}'s Alter can help with his permitted project knowledge.`
  const workedText = 'Continue the design, ask a teammate’s Alter, or open the meeting companion. I’ll show you the work before publishing it.'
  const needsText = pending.length && asks.length
    ? `${pending.length} drafts wait for your okay, and the team has a question only you can answer — both are listed below.`
    : pending.length ? `${pending.length === 1 ? 'One draft is' : `${pending.length} drafts are`} waiting for your okay — I haven’t touched a single file until you say so.`
      : asks.length ? 'One question from the team needs your answer — it’s below.'
        : 'Nothing is waiting on you right now.'
  const greetingText = `${statusText} ${workedText} ${needsText} Say what you need when voice is connected, or pick a card.`

  const liveVoice = import.meta.env.VITE_MOCK !== '1' || !!import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()
  // The agent is present by default: no tap-to-talk anywhere.
  const autoVoice = liveVoice

  function say(text: string) {
    speak(text, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })
  }

  const OFFERS: Offer[] = [
    {
      key: 'meet', num: '01', glyph: 'work', kicker: day?.meetUrl ? 'Google Meet linked' : 'Team conversation', title: 'Join the team sync',
      desc: `Ask ${rahulName}’s Alter, capture the conversation, and prepare the follow-up. Open the actual Meet from the companion.`,
      go: 'Take me in', hot: /join|sync|meet|room|call/, sayLine: 'Opening your meeting companion. Start capture after participants consent.',
      run: () => onOpen('meet'),
    },
    {
      key: 'plan', num: '02', glyph: 'files', kicker: 'On the canvas', title: 'Shape the login plan',
      desc: 'Continue your saved login journey. Edit by voice, undo, then review its Google Docs publication.',
      go: 'Open the canvas', hot: /plan|diagram|canvas|redraw|shape/, sayLine: 'Opening the live diagram — say what to change and watch it redraw.',
      run: () => onOpen('plan'),
    },
    {
      key: 'queue', num: '03', glyph: 'approvals', kicker: 'Waiting on you', title: 'What needs me',
      desc: needsCount ? `${pending.length} draft${pending.length === 1 ? '' : 's'} · ${asks.length} open question${asks.length === 1 ? '' : 's'} — waiting for your call.` : 'Nothing is waiting on you. Good place to be.',
      go: 'Show me', hot: /need|waiting|queue|review|draft/, sayLine: 'Here is what is waiting on you.',
      run: () => onOpen('approvals'),
    },
    {
      key: 'ask', num: '04', glyph: 'sparkle', kicker: 'One question', title: 'Ask about the launch',
      desc: `I’ll check with ${rahulName}’s Alter and bring back sources.`,
      go: 'Ask now', hot: /launch|date|when|ask about/, sayLine: 'Checking with the team now — one moment.',
      run: () => void send("Ask Rahul's Alter to confirm the launch date"),
    },
  ]
  const hot = heard ? OFFERS.find((offer) => offer.hot.test(heard))?.key : undefined

  // Picking a card is a beat: it lights up, the Alter echoes the choice, then
  // the card becomes the screen and the intern takes the corner.
  const pickedRef = useRef<string | null>(null)
  function pickAndRun(offer: Offer) {
    if (pickedRef.current) return
    pickedRef.current = offer.key
    setPicked(offer.key)
    setPickEcho(offer.sayLine)
    if (MOCK) say(offer.sayLine)
    window.setTimeout(() => {
      pickedRef.current = null
      setPicked(null)
      setPickEcho('')
      offer.run()
    }, 720)
  }

  // The Alter greets directly — talking is the interface, no buttons to press.
  useEffect(() => {
    if (!MOCK || !active || sessionStorage.getItem('alter.greeted.' + workspaceId)) return
    const timer = setTimeout(() => {
      sessionStorage.setItem('alter.greeted.' + workspaceId, '1')
      say(greetingText)
    }, 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickRef = useRef(pickAndRun)
  useEffect(() => { pickRef.current = pickAndRun })
  const offersRef = useRef(OFFERS)
  useEffect(() => { offersRef.current = OFFERS })

  const routeRef = useRef<(phrase: string) => void>(() => {})
  useEffect(() => {
    routeRef.current = (phrase) => {
      const text = phrase.toLowerCase()
      if (/work log|receipt|handled/.test(text)) { onOpen('activity'); return }
      if (/need|waiting|queue|approval|review/.test(text)) { onOpen('approvals'); return }
      if (text.split(/\s+/).length >= 2) void send(phrase)
    }
  })
  useEffect(() => {
    if (liveVoice || !active) return
    return listen({
      onState: (state) => setMic(state),
      onInterim: (phrase) => setHeard(phrase.toLowerCase()),
      onFinal: (phrase) => {
        setHeard('')
        const match = offersRef.current.find((offer) => offer.hot.test(phrase.toLowerCase()))
        if (match) { pickRef.current(match); return }
        routeRef.current(phrase)
      },
    })
  }, [liveVoice, active])

  const micLine = liveVoice ? voiceState === 'listening' ? 'Listening' : voiceState === 'speaking' ? 'Speaking' : voiceState === 'connecting' ? 'Connecting voice…' : 'Voice is off — start below' : mic === 'listening' ? 'Always listening' : mic === 'unsupported' ? 'Voice is unavailable in this browser — the cards and typing still work' : 'Starting to listen…'
  const ticker = [
    { text: day?.role ?? 'Your personal work companion' },
    { text: day?.meetUrl ? 'Google Meet linked · host presence unverified' : 'Connect a Meet link in the companion' },
    { text: needsCount ? `${needsCount} awaiting your call` : 'Nothing waiting on you' },
  ]

  return <section className="screen alter-screen fx">
    <div className="fx-aurora" aria-hidden="true" />
    <div className="alter-face">
      <div className={`alter-core ${speaking ? 'is-speaking' : ''} ${mic === 'listening' ? 'is-listening' : ''}`} aria-hidden="true">
        <span className="core-sweep" />
        <span className="alter-core-ring" />
        <span className="alter-core-ring alter-core-ring-far" />
        <span className="alter-core-letter">{(name[0] ?? 'A').toUpperCase()}</span>
      </div>
      <div className="alter-face-copy">
        <h2>{name}&apos;s Alter <AlterBadge /></h2>
        <p className="alter-state"><span className="presence-dot" aria-hidden="true" /> {stateLine}</p>
        <p className="alter-mic"><span className="alter-mic-dot" aria-hidden="true" /> {micLine}
          {!liveVoice && <button type="button" className="alter-mute" aria-label={muted ? 'Unmute your Alter' : 'Mute your Alter'} onClick={() => { const next = !muted; setVoiceMuted(next); setMuted(next); if (next) { stopSpeaking(); setSpeaking(false) } }}>{muted ? '🔇' : '🔊'}</button>}
        </p>
      </div>
    </div>

    <div className="fx-ticker" aria-hidden="true">
      {ticker.map((chip, i) => <span key={i} className={`fx-chip `}><i /> {chip.text}</span>)}
    </div>

    {day?.agenda.length ? <section className="day-agenda" aria-label="Your Google Calendar agenda"><p className="eyebrow">From your connected Calendar</p>{day.agenda.map((event) => <article key={event.id}><time>{new Date(event.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time><strong>{event.title}</strong>{/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(event.meetUrl) && <a href={event.meetUrl} target="_blank" rel="noreferrer">Join Google Meet ↗</a>}</article>)}</section> : !MOCK && <p className="hint">{dayError || 'No upcoming events in your connected demo calendar.'}</p>}
    <article className="alter-says">
      <p>{statusText}</p>
      <p>{workedText}</p>
      <p>{needsText}</p>
      <p className="alter-ask">What would you like me to do next?</p>
    </article>

    <div className={`offer-grid ${picked ? 'is-clearing' : ''}`}>
      {OFFERS.map((offer) => (
        <button key={offer.key} type="button" disabled={!active || busy} className={`offer-card ${hot === offer.key ? 'is-hot' : ''} ${picked === offer.key ? 'is-picked' : ''}`} onClick={() => pickAndRun(offer)}>
          <span className="offer-head">
            <span className="offer-glyph"><Icon name={offer.glyph} size={18} /></span>
            <span className="offer-num">{offer.num}</span>
          </span>
          <span className="offer-kicker">{offer.kicker}</span>
          <strong>{offer.title}</strong>
          <span className="offer-desc">{offer.desc}</span>
          <span className="offer-go">{offer.go} <span aria-hidden="true">↗</span></span>
        </button>
      ))}
    </div>
    <p className="pick-echo" role="status">{pickEcho && <><span className="sparkle-i" aria-hidden="true">✦</span>{pickEcho}</>}</p>

    {asks.length > 0 && <div className="alter-needs">
      <p className="eyebrow">The team is waiting on your answer</p>
      {asks.map((e) => <Question key={e.id} item={e} members={members} onRefresh={onRefresh} />)}
    </div>}

    {waitingDrafts.length > 0 && <div className="alter-quicklinks">
      <button type="button" className="chip text-btn" onClick={() => onOpen('approvals')}>{waitingDrafts.length} draft{waitingDrafts.length === 1 ? '' : 's'} waiting — open the queue</button>
    </div>}
    <div className="alter-quicklinks">
      <button type="button" className="chip text-btn" onClick={() => onOpen('activity')}>See the work log</button>
    </div>

    <div className="messages" role="log" aria-label="Conversation">
      {conversation.map((m, i) => <article key={i} className={`msg ${m.from}`}>
        {m.from === 'alter' && <div className="message-author">Your Alter <AlterBadge /></div>}
        <p>{m.text}</p><Citations sources={m.citations} />
        {m.traceIds.map((id) => <LiveTrace key={id} workspaceId={workspaceId} traceId={id} />)}
        {m.approvalIds.length > 0 && <button className="chip approval" onClick={() => { const target = document.getElementById(`proposal-${m.approvalIds[0]}`); target?.scrollIntoView({ block: 'center' }); target?.focus() }}>Review proposal</button>}
        {m.approvalIds.map((id) => { const a = approvals.find((x) => x.id === id); return a ? <div id={`proposal-${id}`} key={id} tabIndex={-1}>{<ApprovalCard voiceEnabled approval={a} onUpdate={onUpdate} />}</div> : null })}
      </article>)}
    </div>
    {busy && <p className="thinking" role="status">{latest ?? 'Your Alter is working on your request…'}</p>}
    {conversation.length === 0 && <div className="suggested">{DIRECTIVES.map((d) => <button key={d.text} disabled={busy} onClick={() => d.open ? onOpen(d.open) : void send(d.text)}>{d.text} <span aria-hidden="true">↗</span></button>)}</div>}
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(draft) }}><label className="sr-only" htmlFor="message">Message your Alter</label><input id="message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask or delegate…" disabled={busy} /><button className="primary" disabled={busy || !draft.trim()}>Send</button></form>
    {liveVoice && <VoiceControl mode="chat" active={active} greet={!sessionStorage.getItem('alter.live.greeted.' + workspaceId)} onNavigate={onOpen} onState={(state) => { setVoiceState(state); if (state === 'listening') sessionStorage.setItem('alter.live.greeted.' + workspaceId, '1') }} onSpeaking={setSpeaking} autoStart={autoVoice} conversationId={conversationId} onTranscript={setDraft} onResult={(result, _tool, text) => receive(result as { conversationId: string; reply: Message }, text)} />}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}
