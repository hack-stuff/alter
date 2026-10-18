import { useEffect, useRef, useState } from 'react'
import { api, MOCK, ApiError } from '../api/client'
import { roomApi, roomLink } from '../api/rooms'
import { unlockVoiceAudio } from '../live/voiceAudio'
import { MeetingRoom, MeetingSummary } from './MeetingRoom'
import { meetingApi, type MeetingDetail } from '../api/meetings'
import { AlterBadge } from '../components/AlterBadge'
import { AppIcon } from '../components/AppIcon'
import { Icon } from '../components/Icon'
import { AlterMark, PersonWithAlter } from '../components/People'
import { OnScreenTips } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { voiceHold } from '../live/dock'
import { Citations } from '../components/Citations'
import { LiveTrace } from '../components/LiveTrace'
import type { Answer, Member } from '../api/types'

type Segment = { id: string; text: string; kind: 'human' | 'alter' }
export function MeetCompanion({
  members,
  owner = 'Dev',
  workspaceId,
  memberId,
  onBack,
  onReview,
  active = true,
  ready = true,
  startRequest = 0,
}: {
  members: Member[]
  owner?: string
  workspaceId: string
  memberId: string
  onBack: () => void
  onReview: (id: string) => void
  /** Hidden but mounted: no microphone until the companion is on screen. */
  active?: boolean
  ready?: boolean
  startRequest?: number
}) {
  const key = `alter.live.meeting.${workspaceId}.${memberId}`
  const [meetingId, setMeetingId] = useState(
    () => sessionStorage.getItem(key) ?? '',
  )
  const [meeting, setMeeting] = useState<MeetingDetail>()
  const [meetError, setMeetError] = useState('')
  const [question, setQuestion] = useState('')
  const [transcript, setTranscript] = useState('')
  const [latest, setLatest] = useState<Answer>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [, setVoice] = useState<
    'connecting' | 'listening' | 'speaking' | 'closed'
  >('closed')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [askOpen, setAskOpen] = useState(false)
  const [unsaved, setUnsaved] = useState(0)
  const queue = useRef<Segment[]>([])
  const upload = useRef<Promise<void> | undefined>(undefined)
  const launching = useRef(false)
  const [roomCode, setRoomCode] = useState(() => {
    const saved = sessionStorage.getItem(key)
    return saved ? sessionStorage.getItem(`alter.room.${saved}`) ?? '' : ''
  })
  const [inRoom, setInRoom] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Start the recorded team sync in Alter's own room. Siddhi's Alter speaks there from this page. */
  async function joinMeeting() {
    if (launching.current) return
    launching.current = true
    setMeetError('')
    setError('')
    // Inside the click, so the browser lets the Alter's voice play.
    unlockVoiceAudio()
    try {
      let id = meetingId
      if (!id || meeting?.state !== 'capturing') {
        const value = await meetingApi.create('Login revamp · team sync', members.filter((m) => m.id !== memberId && m.id !== 'siddhi').map((m) => m.id), 'siddhi')
        sessionStorage.setItem(key, value.id)
        setMeetingId(value.id)
        setMeeting(await meetingApi.get(value.id))
        id = value.id
      }
      let code = sessionStorage.getItem(`alter.room.${id}`) ?? ''
      if (!code) {
        code = (await roomApi.create(id)).code
        sessionStorage.setItem(`alter.room.${id}`, code)
      }
      setRoomCode(code)
      setInRoom(true)
    } catch (e) {
      setMeetError(e instanceof Error ? e.message : 'The meeting room could not open. Please retry.')
    } finally {
      launching.current = false
    }
  }
  const [summaryCode, setSummaryCode] = useState('')
  function endMeeting() {
    if (roomCode) void roomApi.end(roomCode).catch(() => {})
    // Leaving the room ends the Alter's voice session, so the review can start.
    setInRoom(false)
    setSummaryCode(roomCode)
    if (meetingId) sessionStorage.removeItem(`alter.room.${meetingId}`)
    setRoomCode('')
    void action('Preparing the meeting follow-up…', () => finish(false))
  }
  const startByVoice = useRef(() => {})
  useEffect(() => { startByVoice.current = () => { if (!MOCK) void joinMeeting() } })
  useEffect(() => {
    if (startRequest <= 0) return
    const timer = window.setTimeout(() => startByVoice.current(), 0)
    return () => window.clearTimeout(timer)
  }, [startRequest])
  useEffect(() => {
    if (!meetingId) return
    try {
      queue.current = JSON.parse(
        localStorage.getItem('alter.capture.' + meetingId) ?? '[]',
      )
      setUnsaved(queue.current.length)
    } catch {
      queue.current = []
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const update = async () => {
      try {
        const value = await meetingApi.get(meetingId)
        if (!stopped) setMeeting(value)
      } catch (e) {
        if (!stopped) {
          setError(
            e instanceof Error ? e.message : 'The meeting could not load.',
          )
          if (e instanceof ApiError && e.status === 404) {
            sessionStorage.removeItem(key)
            setMeetingId('')
          }
        }
      }
      if (!stopped) timer = setTimeout(() => void update(), 2000)
    }
    void update()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [meetingId, key])
  async function action(label: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'The request could not finish. Please retry.',
      )
    } finally {
      setBusy('')
    }
  }
  function flush(): Promise<void> {
    if (upload.current)
      return upload.current.then(() =>
        queue.current.length ? flush() : undefined,
      )
    upload.current = (async () => {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 10)
        await meetingApi.append(meetingId, batch)
        queue.current.splice(0, batch.length)
        localStorage.setItem(
          'alter.capture.' + meetingId,
          JSON.stringify(queue.current),
        )
        setUnsaved(queue.current.length)
      }
    })().finally(() => {
      upload.current = undefined
    })
    return upload.current
  }
  function capture(text: string, kind: 'human' | 'alter') {
    if (!meetingId || meeting?.state !== 'capturing') return
    for (let i = 0; i < text.length; i += 4000) {
      const part = text.slice(i, i + 4000).trim()
      if (part)
        queue.current.push({
          id: 'seg_' + crypto.randomUUID().replaceAll('-', ''),
          text: part,
          kind,
        })
    }
    localStorage.setItem(
      'alter.capture.' + meetingId,
      JSON.stringify(queue.current),
    )
    setUnsaved(queue.current.length)
    void flush().catch(() =>
      setError(
        'Some transcript segments are saved on this device. Retry upload before preparing the review.',
      ),
    )
  }
  const ask = (text: string) =>
    void action('Checking with Siddhi’s Alter…', async () => {
      if (!text.trim()) return
      const answer =
        meeting?.state === 'capturing'
          ? await meetingApi.ask(meeting.id, text)
          : await api.askAlter('siddhi', text)
      setLatest(answer)
      setQuestion('')
      capture(text, 'human')
      capture(answer.answer, 'alter')
    })
  async function finish(openReview = true) {
    setVoiceEnabled(false)
    // Let microphone cleanup flush the last utterance and the server release its lease.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flush()
    for (let attempt = 0; ; attempt++) {
      try {
        await meetingApi.finish(meetingId)
        break
      } catch (e) {
        // Siddhi's Alter leaves the call first; its voice session takes a moment to close.
        if (!(e instanceof ApiError) || e.status !== 409 || attempt >= 8)
          throw e
        await new Promise((resolve) => setTimeout(resolve, 750))
      }
    }
    if (openReview) onReview(meetingId)
  }
  const siddhi = members.find((m) => m.id === 'siddhi')
  const capturing = meeting?.state === 'capturing'
  const others = members.filter((m) => m.id !== memberId && m.id !== 'siddhi')
  // Asking Siddhi's Alter here also takes the microphone from the owner's own Alter.
  const asking = !MOCK && capturing && !!meeting && voiceEnabled && active && askOpen
  useEffect(() => asking ? voiceHold.take('meeting-ask') : undefined, [asking])
  const alterStatus = inRoom ? 'In the meeting' : capturing && roomCode ? 'Waiting in the room' : 'Joins with you'
  if (active && !ready) return (
    <section className="screen meeting-screen meeting-preflight" aria-label="Preparing your meeting">
      <div className="opening-card">
        <span className="opening-mark is-connecting" aria-hidden="true">✦</span>
        <p className="eyebrow">Team sync</p>
        <h1>Getting your meeting ready</h1>
        <p role="status" className="hint">Connecting your Google workspace…</p>
      </div>
    </section>
  )
  if (active && summaryCode) return (
    <MeetingSummary code={summaryCode} onReview={() => { setSummaryCode(''); onReview(meetingId) }} onClose={() => setSummaryCode('')} />
  )
  if (active && inRoom && roomCode && meeting) return (
    <MeetingRoom code={roomCode} name={owner} onLeave={() => setInRoom(false)} host={{
      meetingId: meeting.id,
      alterId: 'siddhi',
      alterName: siddhi?.name ?? 'Siddhi',
      onCapture: capture,
      onEnd: endMeeting,
      others: others.map((member) => member.name),
    }} />
  )
  if (active && meetError && !meetingId) return (
    <section className="screen meeting-screen meeting-preflight" aria-label="Meeting setup">
      <div className="sheet meeting-setup-card">
        <Icon name="video" size={28} />
        <p className="eyebrow">Team sync</p>
        <h1>The meeting room needs attention</h1>
        <p role="alert" className="hint">{meetError}</p>
        <button type="button" className="primary" onClick={() => void joinMeeting()}>Try again</button>
        <button type="button" className="ghost" onClick={onBack}>Back to your Alter</button>
      </div>
    </section>
  )
  return (
    <section className="screen meeting-screen">
      <header className="meeting-head meeting-review-head">
        <div className="meeting-title">
          <span className="meeting-title-icon" aria-hidden="true"><Icon name="video" size={22} /></span>
          <div>
            <p className="eyebrow">Scheduled · Today</p>
            <h1>Team sync</h1>
          </div>
        </div>
      </header>
      <section className="sheet team-sync" aria-label="Team sync">
        <p className="team-sync-need"><span className="alter-glyph" aria-hidden="true">✦</span>The launch date and LOGIN-7 need Siddhi. She’s on leave, so her Alter joins in her place.</p>
        <h2 className="eyebrow">Attendees</h2>
        <ul className="attendees" aria-label="Attendees">
          <li><PersonWithAlter name={owner} size="small" /><span><strong>{owner} (you)</strong><small>Organizer · your Alter takes notes, off screen</small></span></li>
          {others.map((member) => <li key={member.id}><PersonWithAlter name={member.name} size="small" status={member.status} /><span><strong>{member.name}</strong><small>{member.role}</small></span></li>)}
          <li className={`is-alter${inRoom ? ' is-in_call' : ''}`} data-nav-id="siddhi" data-nav-label="Siddhi's Alter"><AlterMark name="Siddhi" size="medium" /><span><strong>Siddhi’s Alter <AlterBadge /></strong><small>{siddhi?.status === 'on_leave' || !siddhi ? 'For Siddhi, on leave · ' : ''}{alterStatus}</small></span></li>
        </ul>
        <div className="actions">
          <button type="button" className="primary" disabled={MOCK} onClick={() => void joinMeeting()}><Icon name="video" size={18} />{capturing && roomCode ? 'Rejoin meeting' : 'Join meeting'}</button>
          {capturing && roomCode && <button type="button" onClick={() => { void navigator.clipboard.writeText(roomLink(roomCode)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => setError(roomLink(roomCode))) }}><Icon name={copied ? 'check' : 'link'} size={16} />{copied ? 'Link copied' : 'Copy invite link'}</button>}
        </div>
        {capturing && roomCode && <p className="hint">Anyone with <span className="mono">{roomLink(roomCode)}</span> can join and talk to Siddhi’s Alter.</p>}
        {meetError && meetingId && <p role="alert" className="hint">{meetError} You can still ask Siddhi’s Alter here.</p>}
      </section>
      {error && <p role="alert" className="notice is-error">{error}</p>}
      {busy && <p role="status" className="thinking"><span className="alter-glyph" aria-hidden="true">✦</span>{busy}</p>}
      {meeting && <div className="meeting-grid">
        <div className="meeting-main">
          <details key={meeting.id} className="sheet transcript-sheet" aria-label="Meeting transcript">
            <summary className="sheet-head"><strong>Conversation record</strong><span className="meeting-badges">{capturing && <span className="badge-consent"><span className="rec-dot" aria-hidden="true" />Recording</span>}<span className="source-pill is-quiet">{meeting.segmentCount} saved</span></span></summary>
            {unsaved > 0 && <p className="hint">{unsaved} waiting to upload</p>}
            {meeting.segments.length > 0 && <ol className="transcript-feed">
              {meeting.segments.map((segment) => <li key={segment.id} className={segment.kind === 'alter' ? 'is-alter' : undefined}>
                <strong>{segment.kind === 'alter' ? 'Alter' : 'Meeting audio / entered transcript'}</strong> {segment.text}
              </li>)}
            </ol>}
            {capturing && <>
              <label>Add actual meeting transcript<textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} /></label>
              <div className="actions">
                <button disabled={!transcript.trim() || !!busy} onClick={() => { capture(transcript, 'human'); setTranscript('') }}>Save transcript</button>
                {unsaved > 0 && <button onClick={() => void action('Uploading transcript…', flush)}>Retry transcript upload</button>}
              </div>
            </>}
          </details>
        </div>
        <aside className="followup-tray" aria-label="Meeting tools">
          <section className="sheet">
            <h3>Prepared for your review</h3>
            <p className="hint">Nothing is shared until you approve the completed review.</p>
            <ul className="tray-list">
              <li><AppIcon app="docs" /><span>Status doc changes</span><small>{capturing ? 'After the call' : 'Drafted'}</small></li>
              <li><AppIcon app="gmail" /><span>Team summary</span><small>{capturing ? 'After the call' : 'Drafted'}</small></li>
              <li><AppIcon app="sheets" /><span>Tracker rows</span><small>{capturing ? 'After the call' : 'Drafted'}</small></li>
            </ul>
            {capturing
              ? <button className="primary" disabled={!!busy} onClick={() => void action('Preparing the meeting follow-up…', finish)}>Finish and prepare review</button>
              : <button className="primary" onClick={() => onReview(meeting.id)}>Open prepared review <Icon name="arrow" size={16} /></button>}
          </section>
        </aside>
      </div>}
      <details className="sheet meeting-ask-details" onToggle={(event) => setAskOpen(event.currentTarget.open)}>
        <summary>Ask Siddhi's Alter about the work</summary>
        <div className="alter-tile" aria-label="Siddhi's Alter" data-nav-id="siddhi" data-nav-label="Siddhi's Alter">
          <div className="alter-tile-head">
            <PersonWithAlter name="Siddhi" size="large" status={siddhi?.status ?? 'on_leave'} />
            <div><h2>Siddhi’s Alter <AlterBadge /></h2><p className="hint">{siddhi?.status === 'on_leave' || !siddhi ? 'Siddhi is on leave · ' : ''}answers from Siddhi’s permitted notes, and asks Siddhi about commitments</p></div>
          </div>
          <OnScreenTips title="Ask Siddhi’s Alter" tips={[
            { type: 'say', text: 'Why did we switch to one-tap sign-in?' },
            { type: 'say', text: 'When are we launching the login revamp?' },
            { type: 'say', text: 'Is LOGIN-7 approved for production?' },
          ]} onSelectPrompt={ask} />
          <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); ask(question) }}>
            <label className="sr-only" htmlFor="meeting-question">Question for Siddhi’s Alter</label>
            <input id="meeting-question" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!!busy} placeholder="Ask Siddhi’s Alter…" />
            <button className="primary" disabled={!!busy || !question.trim()}>Ask</button>
          </form>
          {!MOCK && capturing && meeting && <VoiceControl mode="huddle" targetId="siddhi" meetingId={meeting.id} autoStart active={voiceEnabled && active && askOpen} onState={setVoice} onCapture={capture} onResult={(res) => setLatest(res as Answer)} />}
          {latest && <article className={`answer answer-${latest.outcome}`} aria-label="Siddhi’s actual answer">
            <p className="eyebrow">{latest.outcome === 'ask' ? '⚑ Owner decision needed' : latest.outcome === 'deny' ? '× Not shared' : '✓ Answer from Siddhi’s Alter'}</p>
            <p>{latest.answer}</p>
            <Citations sources={latest.citations} />
            {latest.escalationId && <p className="escalation-note"><span className="alter-glyph" aria-hidden="true">✦</span>Priority question saved for Siddhi. Phone delivery depends on Siddhi’s registered notification device.</p>}
            <LiveTrace workspaceId={workspaceId} traceId={latest.traceId} />
          </article>}
        </div>
      </details>
    </section>
  )
}
