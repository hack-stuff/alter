import { useEffect, useRef, useState } from 'react'
import { api, MOCK, ApiError } from '../api/client'
import { dayApi } from '../api/day'
import { meetingApi, type MeetingDetail } from '../api/meetings'
import { AlterBadge } from '../components/AlterBadge'
import { AppIcon } from '../components/AppIcon'
import { Icon } from '../components/Icon'
import { AlterMark, Avatar } from '../components/People'
import { OnScreenTips } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { Citations } from '../components/Citations'
import { LiveTrace } from '../components/LiveTrace'
import { RoomSetup } from '../components/RoomSetup'
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
  const [meetUrl, setMeetUrl] = useState('')
  const [meetChecking, setMeetChecking] = useState(true)
  const [meetError, setMeetError] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [consent, setConsent] = useState(false)
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
  async function launchMeet() {
    if (launching.current) return
    launching.current = true
    setMeetError('')
    try {
      const value = await dayApi.createMeet()
      setMeetUrl(value.meetUrl)
      setUrlDraft(value.meetUrl)
      window.location.assign(value.meetUrl)
    } catch (e) {
      setMeetError(e instanceof Error ? e.message : 'Google Meet could not start. Retry after checking Calendar access.')
      launching.current = false
    }
  }
  useEffect(() => {
    if (startRequest <= 0) return
    const timer = window.setTimeout(() => void launchMeet(), 0)
    return () => window.clearTimeout(timer)
  }, [startRequest])
  useEffect(() => {
    if (!ready) return
    let stopped = false
    void dayApi
      .get()
      .then(async (day) => {
        const link = day.meetUrl ? { meetUrl: day.meetUrl } : await dayApi.createMeet()
        if (!stopped) {
          setMeetUrl(link.meetUrl)
          setUrlDraft(link.meetUrl)
          setMeetError('')
        }
      })
      .catch((e) => {
        if (!stopped) setMeetError(e instanceof Error ? e.message : 'Google Meet setup failed.')
      })
      .finally(() => { if (!stopped) setMeetChecking(false) })
    return () => {
      stopped = true
    }
  }, [ready])
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
  async function finish() {
    setVoiceEnabled(false)
    // Let microphone cleanup flush the last utterance and the server release its lease.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flush()
    for (let attempt = 0; ; attempt++) {
      try {
        await meetingApi.finish(meetingId)
        break
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || attempt >= 3)
          throw e
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    onReview(meetingId)
  }
  const siddhi = members.find((m) => m.id === 'siddhi')
  const capturing = meeting?.state === 'capturing'
  const meetingAlters = [
    { id: memberId, name: owner, note: 'Your Alter · taking notes and preparing your review' },
    ...members.filter((member) => member.id !== memberId && (member.status === 'on_leave' || member.status === 'away' || member.status === 'in_meetings')).slice(0, 2).map((member) => ({ id: member.id, name: member.name, note: member.status === 'on_leave' ? 'Covering while away' : 'Available while busy' })),
  ]
  if (active && (meetChecking || !ready)) return (
    <section className="screen meeting-screen meeting-preflight" aria-label="Preparing your meeting">
      <div className="opening-card">
        <span className="opening-mark is-connecting" aria-hidden="true">✦</span>
        <p className="eyebrow">Team sync</p>
        <h1>Getting your meeting ready</h1>
        <p role="status" className="hint">{!ready ? 'Connecting your Google workspace…' : 'Checking your Google Meet link…'}</p>
      </div>
    </section>
  )
  if (active && !meetUrl) return (
    <section className="screen meeting-screen meeting-preflight" aria-label="Meeting setup">
      <div className="sheet meeting-setup-card">
        <AppIcon app="meet" size={28} />
        <p className="eyebrow">Team sync</p>
        <h1>Google Meet needs attention</h1>
        <p className="hint">{meetError || 'A Meet link is needed before the review opens.'}</p>
        <button type="button" className="primary" onClick={() => void launchMeet()}>Retry and open Google Meet</button>
        <details className="meet-url-box">
          <summary>Use an existing Meet link</summary>
          <form onSubmit={(e) => { e.preventDefault(); void action('Saving the meeting link…', async () => { const value = await dayApi.setMeetUrl(urlDraft); setMeetUrl(value.meetUrl); setMeetError('') }) }}>
            <label>Google Meet link<input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" /></label>
            <button disabled={!!busy}>Save Meet link</button>
          </form>
        </details>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="button" className="ghost" onClick={onBack}>Back to your Alter</button>
      </div>
    </section>
  )
  return (
    <section className="screen meeting-screen">
      <header className="meeting-head meeting-review-head">
        <div className="meeting-title">
          <AppIcon app="meet" size={24} />
          <div>
            <p className="eyebrow">Meeting review</p>
            <h1>Team sync</h1>
          </div>
        </div>
        {meetUrl ? <a href={meetUrl} target="_blank" rel="noreferrer" className="primary meet-launch"><AppIcon app="meet" />Join Google Meet ↗</a> : <button type="button" className="primary meet-launch" disabled={meetChecking || launching.current} onClick={() => void launchMeet()}><AppIcon app="meet" />{meetChecking ? 'Creating Google Meet…' : 'Start Google Meet'} ↗</button>}
      </header>
      <p className="hint meeting-note">Your call opens in Google Meet. Return here to capture a consenting conversation and review what your Alter prepares.</p>
      {meetError && <div className="notice is-error" role="alert"><span>{meetError}</span><button type="button" onClick={() => void launchMeet()}>Retry Meet setup</button></div>}
      <div className="meeting-review-steps" aria-label="Meeting workflow"><span><strong>1</strong> Meet in Google Meet</span><span><strong>2</strong> Capture with consent</span><span><strong>3</strong> Review before sharing</span></div>
      <section className="sheet meeting-alter-lineup" aria-label="Alters ready for the demo">
        <div><p className="eyebrow">Ready in Alter</p><h2>Your meeting team</h2><p className="hint">These Alters are available here. Google Meet participants are separate; connect the room audio below to bring an Alter into the call.</p></div>
        <div className="meeting-alter-list">{meetingAlters.map((item) => <div className="meeting-alter-person" key={item.id}><AlterMark size="small" /><span><strong>{item.name}'s Alter</strong><small>{item.note}</small></span></div>)}</div>
      </section>
      {error && <p role="alert" className="notice is-error">{error}</p>}
      {busy && <p role="status" className="thinking"><span className="alter-glyph" aria-hidden="true">✦</span>{busy}</p>}
      <div className="meeting-grid">
        <div className="meeting-main">
          <section className="sheet meeting-review-panel" aria-label="Meeting review status">
            <p className="eyebrow">Your review</p>
            <h2>{!meeting ? 'The review begins after your call.' : capturing ? 'Your meeting is being captured.' : 'Your follow-up is ready to review.'}</h2>
            <p className="hint">{!meeting ? 'Start a consenting session to save the conversation. Your Alter will prepare the status doc, team summary, and tasks.' : capturing ? `${meeting.segmentCount} transcript segments saved. Finish the meeting to prepare a review.` : 'Inspect the proposed changes and approve them before anything is shared.'}</p>
            {capturing && <span className="badge-consent"><span className="rec-dot" aria-hidden="true" />Consented transcript</span>}
            {meeting && !capturing && <button className="primary" onClick={() => onReview(meeting.id)}>Open prepared review <Icon name="arrow" size={16} /></button>}
          </section>
          <details key={meeting?.id ?? 'new'} className="sheet transcript-sheet" aria-label="Meeting transcript" open={!meeting}>
            <summary className="sheet-head"><strong>Conversation record</strong><span className="source-pill is-quiet">{meeting?.segmentCount ?? 0} saved</span></summary>
            {!meetingId && <div className="consent-start">
              <p className="hint">Capture a real conversation only when the participants agree.</p>
              <label className="check-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />The participants consent to transcript capture.</label>
              <button className="primary" disabled={!consent || !!busy || MOCK} onClick={() => void action('Starting your saved meeting…', async () => {
                const value = await meetingApi.create('Login revamp · team sync', members.filter((m) => ['dev', 'kani', 'sahil'].includes(m.id)).map((m) => m.id), 'siddhi')
                sessionStorage.setItem(key, value.id)
                setMeetingId(value.id)
                setMeeting(await meetingApi.get(value.id))
                setVoiceEnabled(true)
              })}>Start consenting session</button>
            </div>}
            {meeting && <>
              <p className="eyebrow mono">{meeting.state} · {meeting.segmentCount} saved transcript segments{unsaved ? ` · ${unsaved} waiting to upload` : ''}</p>
              <ol className="transcript-feed">
                {meeting.segments.map((segment) => <li key={segment.id} className={segment.kind === 'alter' ? 'is-alter' : undefined}>
                  <strong>{segment.kind === 'alter' ? 'Alter' : 'Meeting audio / entered transcript'}</strong> {segment.text}
                </li>)}
              </ol>
              {capturing && <>
                <label>Add actual meeting transcript<textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} /></label>
                <div className="actions">
                  <button disabled={!transcript.trim() || !!busy} onClick={() => { capture(transcript, 'human'); setTranscript('') }}>Save transcript</button>
                  {unsaved > 0 && <button onClick={() => void action('Uploading transcript…', flush)}>Retry transcript upload</button>}
                </div>
                <p className="hint">This page captures its selected microphone. To capture Google Meet audio, route the room audio into it.</p>
              </>}
            </>}
            {!meeting && <p className="hint">No transcript has been recorded here yet.</p>}
          </details>
        </div>
        <aside className="followup-tray" aria-label="Meeting tools">
          <section className="sheet">
            <h3>Prepared for your review</h3>
            <p className="hint">Nothing is shared until you approve the completed review.</p>
            <ul className="tray-list">
              <li><AppIcon app="docs" /><span>Status doc changes</span><small>{meeting && !capturing ? 'Drafted' : 'After the call'}</small></li>
              <li><AppIcon app="gmail" /><span>Team summary</span><small>{meeting && !capturing ? 'Drafted' : 'After the call'}</small></li>
              <li><AppIcon app="sheets" /><span>Tracker rows</span><small>{meeting && !capturing ? 'Drafted' : 'After the call'}</small></li>
            </ul>
            {meeting && (capturing
              ? <button className="primary" disabled={!!busy} onClick={() => void action('Preparing the meeting follow-up…', finish)}>Meeting finished — prepare my review</button>
              : <button className="primary" onClick={() => onReview(meeting.id)}>Open meeting follow-up</button>)}
          </section>
          {capturing && meeting && <RoomSetup meetingId={meeting.id} memberId="siddhi" />}
          <details className="sheet meet-url-box">
            <summary>{meetUrl ? 'Change the linked Google Meet' : 'Link the Google Meet you started'}</summary>
            <form onSubmit={(e) => { e.preventDefault(); void action('Saving the meeting link…', async () => { const value = await dayApi.setMeetUrl(urlDraft); setMeetUrl(value.meetUrl); setMeetError('') }) }}>
              <label>Existing Google Meet link<input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" /></label>
              <button disabled={!!busy}>Save Meet link</button>
            </form>
            <p className="hint">Linking the call lets you reopen it here. A link alone does not connect an Alter to the call.</p>
          </details>
          <button type="button" className="ghost" onClick={onBack}><Icon name="back" size={16} />Back to your Alter</button>
        </aside>
      </div>
      <details className="sheet meeting-ask-details" onToggle={(event) => setAskOpen(event.currentTarget.open)}>
        <summary>Ask Siddhi's Alter about the work</summary>
        <div className="alter-tile" aria-label="Siddhi's Alter" data-nav-id="siddhi" data-nav-label="Siddhi's Alter">
          <div className="alter-tile-head">
            <span className="person-pair person-pair-large" aria-hidden="true"><Avatar name="Siddhi" size="large" away={siddhi?.status === 'on_leave' || !siddhi} /><AlterMark size="medium" /></span>
            <div><h2>Siddhi’s Alter <AlterBadge /></h2><p className="hint">{siddhi?.status === 'on_leave' || !siddhi ? 'Siddhi is on leave · ' : ''}answers from Siddhi’s permitted notes, and asks Siddhi about commitments</p></div>
          </div>
          <OnScreenTips title="Ask Siddhi’s Alter" tips={[
            { type: 'say', text: 'Why did we switch to one-tap sign-in?' },
            { type: 'say', text: 'When are we launching the login revamp?' },
            { type: 'say', text: 'Is AUTH-112 approved for production?' },
          ]} onSelectPrompt={ask} />
          <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); ask(question) }}>
            <label className="sr-only" htmlFor="meeting-question">Question for Siddhi’s Alter</label>
            <input id="meeting-question" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!!busy} placeholder="Ask Siddhi’s Alter…" />
            <button className="primary" disabled={!!busy || !question.trim()}>Ask</button>
          </form>
          {!MOCK && capturing && meeting && <VoiceControl mode="huddle" targetId="siddhi" meetingId={meeting.id} autoStart active={voiceEnabled && active && askOpen} onTextFallback={ask} onState={setVoice} onCapture={capture} onResult={(res) => setLatest(res as Answer)} />}
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
