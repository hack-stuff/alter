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
  owner = 'Priya',
  workspaceId,
  memberId,
  onBack,
  onReview,
  active = true,
}: {
  members: Member[]
  owner?: string
  workspaceId: string
  memberId: string
  onBack: () => void
  onReview: (id: string) => void
  /** Hidden but mounted: no microphone until the companion is on screen. */
  active?: boolean
}) {
  const key = `alter.live.meeting.${workspaceId}.${memberId}`
  const [meetingId, setMeetingId] = useState(
    () => sessionStorage.getItem(key) ?? '',
  )
  const [meeting, setMeeting] = useState<MeetingDetail>()
  const [meetUrl, setMeetUrl] = useState('')
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
  const [unsaved, setUnsaved] = useState(0)
  const queue = useRef<Segment[]>([])
  const upload = useRef<Promise<void> | undefined>(undefined)
  useEffect(() => {
    let stopped = false
    void dayApi
      .get()
      .then((day) => {
        if (!stopped) {
          setMeetUrl(day.meetUrl)
          setUrlDraft(day.meetUrl)
        }
      })
      .catch((e) => {
        if (!stopped) setError(e.message)
      })
    return () => {
      stopped = true
    }
  }, [])
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
    void action('Checking with Rahul’s Alter…', async () => {
      if (!text.trim()) return
      const answer =
        meeting?.state === 'capturing'
          ? await meetingApi.ask(meeting.id, text)
          : await api.askAlter('rahul', text)
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
  const rahul = members.find((m) => m.id === 'rahul')
  const capturing = meeting?.state === 'capturing'
  return (
    <section className="screen meeting-screen">
      <header className="meeting-head">
        <div className="meeting-title">
          <AppIcon app="meet" size={24} />
          <div>
            <p className="eyebrow">{owner}'s team sync</p>
            <h1>Login revamp · Rahul’s Alter</h1>
          </div>
        </div>
        <div className="meeting-badges">
          {capturing && <span className="badge-consent"><span className="rec-dot" aria-hidden="true" />Consented transcript</span>}
          {meetUrl ? <a href={meetUrl} target="_blank" rel="noreferrer" className="source-pill"><AppIcon app="meet" />Call linked · Open Google Meet ↗</a> : <span className="source-pill is-quiet">No call linked</span>}
        </div>
      </header>
      <p className="hint meeting-note">Ask about Rahul’s permitted work. The Google Meet opens separately; this page doesn’t join the call or show who is in it.</p>
      {error && <p role="alert" className="notice is-error">{error}</p>}
      {busy && <p role="status" className="thinking"><span className="alter-glyph" aria-hidden="true">✦</span>{busy}</p>}
      <div className="meeting-grid">
        <div className="meeting-main">
          <section className="alter-tile" aria-label="Rahul's Alter" data-nav-id="rahul" data-nav-label="Rahul's Alter">
            <div className="alter-tile-head">
              <span className="person-pair person-pair-large" aria-hidden="true"><Avatar name="Rahul" size="large" away={rahul?.status === 'on_leave' || !rahul} /><AlterMark size="medium" /></span>
              <div><h2>Rahul’s Alter <AlterBadge /></h2><p className="hint">{rahul?.status === 'on_leave' || !rahul ? 'Rahul is on leave · ' : ''}answers from his permitted notes, and asks Rahul about commitments</p></div>
            </div>
            <OnScreenTips title="Ask Rahul’s Alter" tips={[
              { type: 'say', text: 'Why did we switch to one-tap sign-in?' },
              { type: 'say', text: 'When are we launching the login revamp?' },
              { type: 'say', text: 'Is AUTH-112 approved for production?' },
            ]} onSelectPrompt={ask} />
            <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); ask(question) }}>
              <label className="sr-only" htmlFor="meeting-question">Question for Rahul’s Alter</label>
              <input id="meeting-question" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={!!busy} placeholder="Ask Rahul’s Alter…" />
              <button className="primary" disabled={!!busy || !question.trim()}>Ask</button>
            </form>
                  {!MOCK && capturing && meeting && <VoiceControl mode="huddle" targetId="rahul" meetingId={meeting.id} autoStart active={voiceEnabled && active} onTextFallback={ask} onState={setVoice} onCapture={capture} onResult={(res) => setLatest(res as Answer)} />}
            {latest && <article className={`answer answer-${latest.outcome}`} aria-label="Rahul’s actual answer">
              <p className="eyebrow">{latest.outcome === 'ask' ? '⚑ Owner decision needed' : latest.outcome === 'deny' ? '× Not shared' : '✓ Answer from Rahul’s Alter'}</p>
              <p>{latest.answer}</p>
              <Citations sources={latest.citations} />
              {latest.escalationId && <p className="escalation-note"><span className="alter-glyph" aria-hidden="true">✦</span>Priority question saved for Rahul. Phone delivery depends on his registered notification device.</p>}
              <LiveTrace workspaceId={workspaceId} traceId={latest.traceId} />
            </article>}
          </section>

          <section className="sheet transcript-sheet" aria-label="Meeting transcript">
            {!meetingId && <div className="consent-start">
              <h3>Capture this conversation</h3>
              <p className="hint">Save real questions and voice transcripts, then let your Alter prepare the follow-up.</p>
              <label className="check-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />The participants consent to transcript capture.</label>
              <button className="primary" disabled={!consent || !!busy || MOCK} onClick={() => void action('Starting your saved meeting…', async () => {
                const value = await meetingApi.create('Login revamp · team sync', members.filter((m) => ['priya', 'meera', 'arjun'].includes(m.id)).map((m) => m.id), 'rahul')
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
                <p className="hint">This page captures its selected microphone only. To hear the Google Meet call, use the recording rig and route Meet audio into it.</p>
              </>}
            </>}
            {!meeting && <p className="hint">No transcript has been recorded here yet.</p>}
          </section>
        </div>

        <aside className="followup-tray" aria-label="Follow-ups">
          <section className="sheet">
            <h3>Follow-ups</h3>
            <p className="hint">When the meeting ends, your Alter drafts these for you to review together. Nothing is sent before you approve.</p>
            <ul className="tray-list">
              <li><AppIcon app="docs" /><span>Status doc changes</span><small>{meeting && !capturing ? 'Drafted' : 'After the meeting'}</small></li>
              <li><AppIcon app="gmail" /><span>Team summary</span><small>{meeting && !capturing ? 'Drafted' : 'After the meeting'}</small></li>
              <li><AppIcon app="sheets" /><span>Tracker rows</span><small>{meeting && !capturing ? 'Drafted' : 'After the meeting'}</small></li>
            </ul>
            {meeting && (capturing
              ? <button className="primary" disabled={!!busy} onClick={() => void action('Preparing the meeting follow-up…', finish)}>Meeting finished — prepare my review</button>
              : <button className="primary" onClick={() => onReview(meeting.id)}>Open meeting follow-up</button>)}
          </section>
          {capturing && meeting && <RoomSetup meetingId={meeting.id} memberId="rahul" />}
          <details className="sheet meet-url-box">
            <summary>{meetUrl ? 'Change the linked Google Meet' : 'Connect an existing Google Meet'}</summary>
            <form onSubmit={(e) => { e.preventDefault(); void action('Saving the meeting link…', async () => { const value = await dayApi.setMeetUrl(urlDraft); setMeetUrl(value.meetUrl) }) }}>
              <label>Existing Google Meet link<input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" /></label>
              <button disabled={!!busy}>Save Meet link</button>
            </form>
            <p className="hint">The host must join Rahul’s AI account using the rig and admit external guests. A saved link does not connect the audio.</p>
          </details>
          <button type="button" className="ghost" onClick={onBack}><Icon name="back" size={16} />Back to your Alter</button>
        </aside>
      </div>
    </section>
  )
}
