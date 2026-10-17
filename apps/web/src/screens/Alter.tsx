import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { alterNav } from '../agent/navigator'
import { parseDecision, pickApproval, type DecisionIntent } from '../agent/decisions'
import { api, MOCK, httpCall } from '../api/client'
import { dayApi, type Day } from '../api/day'
import { canvasEdit, requestedCard, parseNavigation, startMeetingIntent, navigateTo, LEGACY_SURFACES, type NavigationAction, type NavigationSource, type WorkSurface } from '../agent/navigation'
import { dispatchLiveTool } from '../live/tools'
import { timestamp } from '../api/presentation'
import { LiveTrace } from '../components/LiveTrace'
import { VoiceControl } from '../components/VoiceControl'
import { AlterBadge } from '../components/AlterBadge'
import { ApprovalCard } from '../components/ApprovalCard'
import { Citations } from '../components/Citations'
import { Icon } from '../components/Icon'
import { AlterMark, Avatar, PersonWithAlter } from '../components/People'
import { AppIcon } from '../components/AppIcon'
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

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const eventDay = (value: string) => dayKey(new Date(value))

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

export function Alter({ name, workspaceId, members, meId, approvals, escalations, events, active = true, ready = true, setupState, retryingSetup = false, setupRetryError = '', onRetrySetup, onUpdate, onRefresh, onNavigate, onStartMeeting }: {
  name: string
  workspaceId: string
  members: Member[]
  meId?: string
  approvals: Approval[]
  escalations: Escalation[]
  events: ProgressEvent[]
  active?: boolean
  ready?: boolean
  setupState?: string
  retryingSetup?: boolean
  setupRetryError?: string
  onRetrySetup?: () => Promise<void>
  onUpdate: (a: Approval) => void
  onRefresh: () => void
  onNavigate: (action: NavigationAction, source?: NavigationSource) => void
  onStartMeeting: () => void
}) {
  const onOpen = (surface: WorkSurface) => onNavigate(navigateTo(LEGACY_SURFACES[surface]))
  const [day, setDay] = useState<Day>()
  const [dayError, setDayError] = useState('')
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()))
  const [voiceState, setVoiceState] = useState<'connecting' | 'listening' | 'speaking' | 'closed'>('closed')
  const liveVoice = import.meta.env.VITE_MOCK !== '1' || !!import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()
  const greetedBefore = useRef(!!sessionStorage.getItem('alter.live.greeted.' + workspaceId))
  const [opened, setOpened] = useState(() => !!sessionStorage.getItem('alter.live.opened.' + workspaceId))
  const [voiceError, setVoiceError] = useState('')
  const [openingSlow, setOpeningSlow] = useState(false)
  useEffect(() => {
    if (MOCK || !active || !ready) return
    let stopped = false
    void dayApi.get().then((value) => { if (!stopped) { setDay(value); setDayError(value.agendaError) } }).catch((e) => { if (!stopped) setDayError(e.message) })
    return () => { stopped = true }
  }, [workspaceId, active, ready])
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
  const [briefing, setBriefing] = useState(0)
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
  // "Send it", "approve the invite", "reject that": decide the matching waiting draft.
  async function decide(intent: DecisionIntent) {
    const target = pickApproval(approvals, intent)
    if (!target) return { decided: false, instruction: 'Nothing is waiting for that decision. Say so briefly.' }
    const updated = await api.decide(target.id, intent.decision, target.revision)
    onUpdate(updated)
    const done = intent.decision === 'reject' ? `Rejected “${updated.title}”.` : updated.kind === 'email' ? `Sent “${updated.title}”.` : `Applied “${updated.title}”.`
    setMessages((m) => [...m, { from: 'alter', text: done, citations: [], approvalIds: [updated.id], traceIds: [], ts: timestamp() }])
    return { decided: true, decision: intent.decision, title: updated.title, state: updated.state }
  }
  const decideRef = useRef(decide)
  useEffect(() => { decideRef.current = decide })

  async function send(text: string) {
    if (busy || !text.trim()) return
    if (startMeetingIntent(text)) { onStartMeeting(); setDraft(''); return }
    const decision = parseDecision(text)
    if (decision && pickApproval(approvals, decision)) {
      setBusy(true); setError('')
      try {
        setMessages((m) => [...m, { from: 'human', text: text.trim(), citations: [], approvalIds: [], traceIds: [], ts: timestamp() }])
        await decide(decision)
        setDraft('')
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that. Please try again.'); setDraft(text) }
      finally { setBusy(false) }
      return
    }
    // Fast path: a clear "open X" never waits on the model.
    const intent = parseNavigation(text)
    if (intent?.confidence === 'high') { onNavigate(intent.action, 'text'); setDraft(''); return }
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

  async function recoverSpokenAction(text: string) {
    if (!parseNavigation(text) && !parseDecision(text) && !canvasEdit(text, alterNav.current()) && requestedCard(text) !== 4) return
    setError('')
    try {
      await dispatchLiveTool('alter_chat', { message: text }, {
        mode: 'chat', conversationId, onNavigate: (action, source) => onNavigate(action, source ?? 'voice-tool'), onDecide: (intent) => decideRef.current(intent),
        onResult: (value, _tool, input) => receive(value as { conversationId: string; reply: Message }, input),
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that voice action. Please try again.') }
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
  const workedText = 'Continue the design, ask a teammate’s Alter, or open the team sync. I’ll show you the work before publishing it.'
  const needsText = pending.length && asks.length
    ? `${pending.length} drafts wait for your okay, and the team has a question only you can answer — both are listed below.`
    : pending.length ? `${pending.length === 1 ? 'One draft is' : `${pending.length} drafts are`} waiting for your okay — I haven’t touched a single file until you say so.`
      : asks.length ? 'One question from the team needs your answer — it’s below.'
        : 'Nothing is waiting on you right now.'
  const greetingText = `${statusText} ${workedText} ${needsText} Say what you need when voice is connected, or pick a card.`

  const opening = active && liveVoice && !opened && (MOCK || day?.voiceConfigured !== false)
  const autoVoice = liveVoice && ready
  useEffect(() => {
    if (!opening) return
    const timer = window.setTimeout(() => setOpeningSlow(true), 8000)
    return () => window.clearTimeout(timer)
  }, [opening])
  useEffect(() => {
    if (!opening || !openingSlow || voiceState !== 'closed' || setupState === 'provisioning_failed') return
    sessionStorage.setItem('alter.live.opened.' + workspaceId, '1')
    setOpened(true)
  }, [opening, openingSlow, voiceState, setupState, workspaceId])

  function say(text: string) {
    speak(text, { onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false) })
  }

  const OFFERS: Offer[] = [
    {
      key: 'meet', num: '01', glyph: 'work', kicker: day?.meetUrl ? 'Call linked' : 'Team conversation', title: 'Join the team sync',
      desc: `Open Google Meet, then review the follow-up with ${rahulName}’s Alter.`,
      go: 'Join the call', hot: /join|sync|meet|room|call/, sayLine: 'Opening the team sync in Google Meet.',
      run: onStartMeeting,
    },
    {
      key: 'plan', num: '02', glyph: 'files', kicker: 'On the canvas', title: 'Shape the login plan',
      desc: 'Edit the saved login journey by voice, then review the Google Doc.',
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
      desc: `Get a sourced launch update from ${rahulName}’s Alter.`,
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
    if (!MOCK || liveVoice || !active || sessionStorage.getItem('alter.greeted.' + workspaceId)) return
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
  const startMeetingRef = useRef(onStartMeeting)
  useEffect(() => { startMeetingRef.current = onStartMeeting })
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
        if (startMeetingIntent(phrase)) { startMeetingRef.current(); return }
        const match = offersRef.current.find((offer) => offer.hot.test(phrase.toLowerCase()))
        if (match) { pickRef.current(match); return }
        routeRef.current(phrase)
      },
    })
  }, [liveVoice, active])

  const micLine = liveVoice ? voiceState === 'listening' ? 'Listening' : voiceState === 'speaking' ? 'Speaking' : voiceState === 'connecting' ? 'Connecting voice…' : 'Voice is off' : mic === 'listening' ? 'Always listening' : mic === 'unsupported' ? 'Voice is unavailable in this browser — typing still works' : 'Starting to listen…'

  const me = members.find((m) => m.id === meId)
  const agendaTarget = (title: string): 'plan' | 'meet' | undefined => /review|design|journey|canvas|plan/i.test(title) ? 'plan' : /sync|meeting|stand-?up|call/i.test(title) ? 'meet' : undefined
  const calendarDays = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() + offset)
    return date
  })
  const selectedEvents = (day?.agenda ?? []).filter((event) => eventDay(event.start) === selectedDay)
  const QUICK = [
    { label: 'Hear my briefing', run: () => { if (liveVoice) setBriefing((n) => n + 1); else say(greetingText) } },
    { label: 'Continue the login flow', run: () => onOpen('plan') },
    { label: `Ask ${rahulName}'s Alter why we switched to one-tap sign-in`, run: () => void send("Ask Rahul's Alter why we switched to one-tap sign-in") },
  ]

  return <section className={`screen home${opening ? ' is-opening' : ''}`}>
    {opening && <div className="alter-opening" aria-label="Opening your workday">
      <div className="opening-card">
        <span className={`opening-mark${voiceState === 'connecting' ? ' is-connecting' : ''}`} aria-hidden="true">✦</span>
        <p className="eyebrow">{name}&apos;s Alter · Workday</p>
        <h1>Your day is already in motion.</h1>
        <p className="alter-opening-status" role="status">{setupState === 'provisioning_failed' ? 'Your team’s Google setup needs attention.' : !ready ? 'Gathering the team’s work…' : voiceError ? 'Voice needs a moment of attention.' : voiceState === 'connecting' ? 'Connecting your Alter…' : voiceState === 'listening' ? 'Your briefing is coming together…' : 'Preparing your briefing…'}</p>
        {setupState === 'provisioning_failed' && onRetrySetup && <button type="button" className="primary" disabled={retryingSetup} onClick={() => void onRetrySetup()}>{retryingSetup ? 'Retrying setup…' : 'Retry Google setup'}</button>}
        {setupState === 'provisioning_failed' && setupRetryError && <p role="alert" className="error">{setupRetryError}</p>}
        {setupState !== 'provisioning_failed' && (openingSlow || voiceError) && <button type="button" className="alter-opening-skip" onClick={() => { sessionStorage.setItem('alter.live.opened.' + workspaceId, '1'); setOpened(true) }}>Enter without voice <span aria-hidden="true">↗</span></button>}
      </div>
    </div>}

    <header className="identity-strip">
      <PersonWithAlter name={name} size="large" />
      <div className="identity-copy">
        <h1 className="identity-name">{name}&apos;s Alter <AlterBadge /></h1>
        <p className="identity-role">{day?.role ?? me?.role ?? 'Your personal work companion'}</p>
        <p className={`alter-state${busy || speaking || voiceState === 'listening' || mic === 'listening' ? ' is-active' : ''}`}><span className="presence-dot" aria-hidden="true" />{stateLine}{!liveVoice && <> · {micLine}</>}</p>
      </div>
      <div className="identity-side">
        {!liveVoice && <button type="button" className="ghost icon-only" aria-label={muted ? 'Unmute your Alter' : 'Mute your Alter'} onClick={() => { const next = !muted; setVoiceMuted(next); setMuted(next); if (next) { stopSpeaking(); setSpeaking(false) } }}><Icon name={muted ? 'micOff' : 'mic'} size={18} /></button>}
      </div>
    </header>

    {setupState === 'provisioning' && <p role="status" className="notice">Your Alter is connecting to your team’s Google resources…</p>}
    {setupState === 'provisioning_failed' && !opening && <div role="alert" className="notice is-error setup-retry"><span>Google setup didn’t finish. Your workspace and work are saved.</span>{onRetrySetup && <button type="button" disabled={retryingSetup} onClick={() => void onRetrySetup()}>{retryingSetup ? 'Retrying setup…' : 'Retry Google setup'}</button>}{setupRetryError && <span>{setupRetryError}</span>}</div>}

    <section className="next-up" aria-label="What your Alter can do next">
      <h3>Where should we start?</h3>
      <ol className={`offer-list ${picked ? 'is-clearing' : ''}`}>
        {OFFERS.map((offer) => <li key={offer.key}>
          <button type="button" disabled={!ready || busy} className={`offer-card ${hot === offer.key ? 'is-hot' : ''} ${picked === offer.key ? 'is-picked' : ''}`} onClick={() => pickAndRun(offer)}>
            <span className="offer-num">{offer.num}</span>
            <span className="offer-body"><strong>{offer.title}</strong><span className="offer-desc">{offer.desc}</span></span>
            <span className="offer-kicker">{offer.kicker}</span>
            <Icon name="arrow" size={16} />
          </button>
        </li>)}
      </ol>
      <p className="pick-echo" role="status">{pickEcho && <><span className="alter-glyph" aria-hidden="true">✦</span>{pickEcho}</>}</p>
    </section>

    <div className="home-grid">
      <section className="sheet today" aria-label="Your Google Calendar agenda">
        <div className="sheet-head"><div><p className="eyebrow">Your calendar</p><h2>{selectedDay === dayKey(new Date()) ? 'Today' : calendarDays.find((date) => dayKey(date) === selectedDay)?.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div><span className="source-pill is-quiet"><AppIcon app="calendar" />Google Calendar</span></div>
        <div className="calendar-days" role="group" aria-label="Choose a day">{calendarDays.map((date) => {
          const key = dayKey(date)
          const count = day?.agenda.filter((event) => eventDay(event.start) === key).length ?? 0
          return <button type="button" key={key} className={`calendar-day${selectedDay === key ? ' is-selected' : ''}`} aria-pressed={selectedDay === key} onClick={() => setSelectedDay(key)}><span>{date.toLocaleDateString([], { weekday: 'short' })}</span><strong>{date.getDate()}</strong><small>{count ? `${count} event${count === 1 ? '' : 's'}` : 'Free'}</small></button>
        })}</div>
        {selectedEvents.length ? <ol className="agenda">{selectedEvents.map((event) => {
          const target = agendaTarget(event.title)
          const meet = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(event.meetUrl) ? event.meetUrl : ''
          return <li key={event.id} className="agenda-row">
            <time dateTime={event.start}>{new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<small>{new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></time>
            <span className="agenda-title"><span className="agenda-color" aria-hidden="true" /><strong>{event.title}</strong></span>
            <span className="agenda-actions">
              {meet && <a className="source-pill" href={meet} target="_blank" rel="noreferrer"><AppIcon app="meet" />Join Meet ↗</a>}
              {target && <button type="button" className="ghost small" onClick={() => onOpen(target)}>{target === 'plan' ? 'Open canvas' : 'Open review'} <Icon name="arrow" size={14} /></button>}
            </span>
          </li>
        })}</ol> : <p className="calendar-empty">{MOCK ? 'Connect Google Calendar to see your day.' : dayError || 'No events on this day. Your time is yours.'}</p>}
      </section>

      <aside className="sheet waiting" aria-label="Waiting on you">
        <div className="sheet-head"><h2>Waiting on you</h2>{needsCount > 0 && <span className="count-pill">{needsCount}</span>}</div>
        {needsCount === 0 && <p className="hint">Nothing is waiting on you. Your Alter makes doc, sheet and calendar changes directly; emails wait until you say send.</p>}
        {pending.length > 0 && <button type="button" className="waiting-row" onClick={() => onOpen('approvals')}><Icon name="approvals" size={18} /><span><strong>{pending.length} draft{pending.length === 1 ? '' : 's'} waiting</strong><small>Say “send it” or “reject it”, or open to review.</small></span><Icon name="arrow" size={16} /></button>}
        {asks.length > 0 && <a className="waiting-row" href="#team-questions"><Icon name="decision" size={18} /><span><strong>{asks.length} question{asks.length === 1 ? '' : 's'} only you can answer</strong><small>Escalated by a teammate’s Alter.</small></span><Icon name="arrow" size={16} /></a>}
      </aside>
    </div>

    {asks.length > 0 && <section className="alter-needs" id="team-questions" aria-label="The team is waiting on your answer">
      <h3>The team is waiting on your answer</h3>
      {asks.map((e) => <Question key={e.id} item={e} members={members} meName={name} onRefresh={onRefresh} />)}
    </section>}

    <section className="sheet conversation" aria-label="Ask and delegate">
      <div className="messages" role="log" aria-label="Conversation">
        {conversation.map((m, i) => <article key={i} className={`msg ${m.from}`}>
          {m.from === 'alter' ? <div className="message-author"><AlterMark size="small" />Your Alter <AlterBadge /></div> : <div className="message-author"><Avatar name={name} size="small" />You</div>}
          <p>{m.text}</p><Citations sources={m.citations} />
          {m.traceIds.map((id) => <LiveTrace key={id} workspaceId={workspaceId} traceId={id} />)}
          {m.approvalIds.length > 0 && <button className="chip" onClick={() => { const target = document.getElementById(`proposal-${m.approvalIds[0]}`); target?.scrollIntoView({ block: 'center' }); target?.focus() }}>Review proposal</button>}
          {m.approvalIds.map((id) => { const a = approvals.find((x) => x.id === id); return a ? <div id={`proposal-${id}`} key={id} tabIndex={-1}><ApprovalCard voiceEnabled approval={a} onUpdate={onUpdate} /></div> : null })}
        </article>)}
      </div>
      {busy && <p className="thinking" role="status"><span className="alter-glyph" aria-hidden="true">✦</span>{latest ?? 'Your Alter is working on your request…'}</p>}
      <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <label className="sr-only" htmlFor="message">Message your Alter</label>
        <input id="message" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask or delegate…" disabled={busy || !ready} />
        <button className="primary" disabled={busy || !ready || !draft.trim()}>Send</button>
      </form>
      <div className="chip-row">{QUICK.map((chip) => <button key={chip.label} type="button" className="chip" disabled={busy || !ready} onClick={chip.run}>{chip.label}</button>)}</div>
      {conversation.length === 0 && <details className="more-requests"><summary>More things to ask</summary><div className="chip-row">{DIRECTIVES.map((d) => <button key={d.text} type="button" className="chip" disabled={busy} onClick={() => d.open ? onOpen(d.open) : void send(d.text)}>{d.text}</button>)}</div></details>}
      {waitingDrafts.length > 0 && <button type="button" className="ghost small" onClick={() => onOpen('approvals')}>{waitingDrafts.length} draft{waitingDrafts.length === 1 ? '' : 's'} waiting — open approvals</button>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>

    {/* The Voice Bar lives on the page, not on Home, so the Alter keeps talking while it moves between screens. */}
    {liveVoice && createPortal(<VoiceControl dock mode="chat" active={ready} greet={!greetedBefore.current} briefing={briefing} onTextFallback={(text) => void send(text)} onNavigate={(action, source) => onNavigate(action, source ?? 'voice-tool')} onDecide={(intent) => decideRef.current(intent)} onUserUtterance={(text) => { if (startMeetingIntent(text)) onStartMeeting() }} onUnroutedUtterance={(text) => void recoverSpokenAction(text)} onState={(state) => { setVoiceState(state); if (state === 'connecting') setVoiceError(''); if (state === 'listening' && greetedBefore.current) setOpened(true) }} onError={setVoiceError} onFirstSpeech={() => { sessionStorage.setItem('alter.live.greeted.' + workspaceId, '1'); greetedBefore.current = true; setOpened(true) }} onSpeaking={setSpeaking} autoStart={autoVoice} conversationId={conversationId} onTranscript={setDraft} onResult={(result, _tool, text) => receive(result as { conversationId: string; reply: Message }, text)} />, document.body)}
  </section>
}
