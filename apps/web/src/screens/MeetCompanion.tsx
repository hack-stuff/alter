import { useEffect, useRef, useState } from 'react'
import { Icon, Avatar } from '../components/Icon'
import { AlterBadge } from '../components/AlterBadge'
import { AlterOrb } from '../components/AlterOrb'
import { OnScreenTips, type TipItem } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { Citations } from '../components/Citations'
import { listen, speak } from '../agent/voice'
import type { Answer, Member } from '../api/types'

// The meeting opens itself — a short live scene between the team and the Alters.
// Rahul is on leave; his Alter sits in the room and answers for him.
const SCRIPT: { at: number; who: string; tile: string; line: string }[] = [
  { at: 900, who: 'Meera', tile: 'meera', line: 'Priya’s here. Let’s start with the sign-in rework.' },
  { at: 5400, who: 'Arjun', tile: 'arjun', line: 'Quick one — why one-tap sign-in over the old Google button?' },
  { at: 10000, who: "Rahul’s Alter", tile: 'rahul', line: 'The old button is being retired. Rahul switched us on October 8 — the sources are in the receipt.' },
  { at: 15200, who: 'Meera', tile: 'meera', line: 'And when are we launching?' },
  { at: 19600, who: "Rahul’s Alter", tile: 'rahul', line: 'That one is Rahul’s call. I’ve sent him a priority message to confirm the date.' },
]

export function MeetCompanion({
  members,
  owner = 'Priya',
  onBack,
}: {
  members: Member[]
  owner?: string
  onBack: () => void
}) {
  const [meetUrl, setMeetUrl] = useState<string>(
    () => localStorage.getItem('alter.demo.meet_url') || 'https://meet.google.com/new'
  )
  const [editingUrl, setEditingUrl] = useState(false)
  const [caption, setCaption] = useState('You’re in. The room is live — Rahul’s Alter is standing in for him.')
  const [feed, setFeed] = useState<{ who: string; line: string }[]>([])
  const [sceneIdx, setSceneIdx] = useState(-1)
  const [speaking, setSpeaking] = useState(false)
  const [orbSpeaking, setOrbSpeaking] = useState(false)
  const [mic, setMic] = useState<'idle' | 'listening' | 'unsupported'>('idle')
  const [latestAnswer, setLatestAnswer] = useState<Answer | null>(null)
  const [simulatedEscalation, setSimulatedEscalation] = useState(false)
  const rahulName = members.find((m) => m.id === 'rahul')?.name ?? 'Rahul'
  const liveVoice = !!import.meta.env.VITE_LIVE_TOKEN_BASE?.trim()

  function saveMeetUrl(url: string) {
    const trimmed = url.trim() || 'https://meet.google.com/new'
    setMeetUrl(trimmed)
    localStorage.setItem('alter.demo.meet_url', trimmed)
    setEditingUrl(false)
  }

  // The scene plays on its own — the "meeting starts" moment.
  useEffect(() => {
    const timers = SCRIPT.map((beat, index) => setTimeout(() => {
      setSceneIdx(index)
      setFeed((lines) => [...lines, { who: beat.who, line: beat.line }])
      setCaption(`${beat.who}: ${beat.line}`)
    }, beat.at))
    const done = setTimeout(() => {
      setSceneIdx(-1)
      setCaption('Open floor — ask Rahul’s Alter anything below, out loud or by tapping.')
    }, (SCRIPT.at(-1)?.at ?? 0) + 4600)
    return () => { timers.forEach(clearTimeout); clearTimeout(done) }
  }, [])

  function say(text: string, onEnd?: () => void) {
    setOrbSpeaking(true)
    speak(text, { onStart: () => setOrbSpeaking(true), onEnd: () => { setOrbSpeaking(false); onEnd?.() } })
  }

  function handlePromptTrigger(promptText: string) {
    const text = promptText.toLowerCase()
    if (text.includes('launch') || text.includes('date') || text.includes('when')) {
      const answer: Answer = {
        alter: 'rahul',
        asker: 'priya',
        question: promptText,
        outcome: 'ask',
        answer:
          "That one is Rahul's call. Since he is on leave, I've sent him a priority message to confirm the launch date.",
        citations: [
          { sourceId: 'roadmap', title: 'Login revamp roadmap', locator: 'Priorities' },
        ],
        escalationId: 'esc-launch-date',
        traceId: 'trace-escalation-1',
        receiptId: 'rcpt-esc-1',
      }
      setLatestAnswer(answer)
      setSimulatedEscalation(true)
      setCaption(`${rahulName}’s Alter: ${answer.answer}`)
      say(answer.answer)
      setFeed((lines) => [...lines, { who: 'You → Rahul’s Alter', line: promptText }, { who: 'Rahul’s Alter', line: answer.answer }])
    } else if (text.includes('why') || text.includes('one-tap') || text.includes('button')) {
      const answer: Answer = {
        alter: 'rahul',
        asker: 'priya',
        question: promptText,
        outcome: 'allow',
        answer:
          'The old Google Sign-In button is being retired by Google, so Rahul switched us on October 8. One-tap sign-in is also significantly faster for mobile users.',
        citations: [
          { sourceId: 'arch-sync-2026-10-08', title: 'Arch sync · Oct 8', locator: '12:04' },
          { sourceId: 'doc-login', title: 'Login design doc §2', locator: 'Decision record' },
        ],
        traceId: 'trace-onetap-decision',
        receiptId: 'rcpt-onetap-1',
      }
      setLatestAnswer(answer)
      setSimulatedEscalation(false)
      setCaption(`${rahulName}’s Alter: ${answer.answer}`)
      say(answer.answer)
      setFeed((lines) => [...lines, { who: 'You → Rahul’s Alter', line: promptText }, { who: 'Rahul’s Alter', line: answer.answer }])
    } else if (text.includes('auth-112') || text.includes('prod') || text.includes('approved')) {
      const answer: Answer = {
        alter: 'rahul',
        asker: 'priya',
        question: promptText,
        outcome: 'allow',
        answer:
          'Google one-tap sign-in was approved for production on October 10 under ticket AUTH-112. It is already verified and live in production.',
        citations: [
          { sourceId: 'ticket-AUTH-112', title: 'AUTH-112', locator: 'status: approved' },
        ],
        traceId: 'trace-auth-112',
        receiptId: 'rcpt-auth-1',
      }
      setLatestAnswer(answer)
      setSimulatedEscalation(false)
      setCaption(`${rahulName}’s Alter: ${answer.answer}`)
      say(answer.answer)
      setFeed((lines) => [...lines, { who: 'You → Rahul’s Alter', line: promptText }, { who: 'Rahul’s Alter', line: answer.answer }])
    } else {
      setCaption(`Rahul’s Alter heard “${promptText}” — try asking about one-tap sign-in, AUTH-112, or the launch date.`)
    }
  }

  const promptRef = useRef(handlePromptTrigger)
  useEffect(() => { promptRef.current = handlePromptTrigger })
  useEffect(() => {
    if (liveVoice) return
    return listen({
      onState: (state) => setMic(state),
      onInterim: (phrase) => setCaption(`“${phrase}”`),
      onFinal: (phrase) => promptRef.current(phrase),
    })
  }, [liveVoice])

  const tips: TipItem[] = [
    {
      type: 'say',
      text: 'Why did we switch to one-tap sign-in instead of the old button?',
      highlight: true,
    },
    {
      type: 'say',
      text: 'When are we launching the login revamp?',
      highlight: true,
    },
    {
      type: 'say',
      text: 'Is the sign-in setup approved for production under AUTH-112?',
    },
    {
      type: 'do',
      text: 'Open Google Meet in a new browser tab',
      action: () => window.open(meetUrl, '_blank', 'noreferrer'),
    },
  ]

  const tileGlow = sceneIdx >= 0 ? SCRIPT[sceneIdx]?.tile : speaking ? 'rahul' : undefined

  return (
    <section className="screen meet-stage fx stage-dark">
      <div className="fx-aurora" aria-hidden="true" />
      <div className="stage-wipe" aria-hidden="true" />
      <div className="stage-top">
        <button type="button" className="back-link-btn" onClick={onBack}>
          ← Back to the cards
        </button>
        <span className="live-pill"><span className="pulse-dot" aria-hidden="true" /> LIVE · Google Meet</span>
        <a href={meetUrl} target="_blank" rel="noreferrer" className="stage-join">
          <Icon name="work" size={16} /> Open the real call ↗
        </a>
      </div>

      <div className="stage-heading">
        <p className="eyebrow">2:00 PM · Team sync</p>
        <h2>Login Revamp — {rahulName}&apos;s stand-in</h2>
        <p className="hint">
          {rahulName} is on leave. His Alter is standing in with his verified knowledge and decision boundaries — ask it anything, out loud.
        </p>
      </div>

      <div className="mtile-grid">
        <div className={`mtile ${tileGlow === 'you' ? 'is-live' : ''}`}>
          <div className="mtile-avatar">{owner[0]?.toUpperCase() ?? 'Y'}</div>
          <strong>{owner} (You)</strong>
          <span className="mtile-sub">Product Lead · Organizer</span>
          <span className="mtile-chip">Your Alter is in the room ✦</span>
        </div>
        <div className={`mtile ${tileGlow === 'meera' ? 'is-live' : ''}`}>
          <Avatar name={members.find((m) => m.id === 'meera')?.name ?? 'Meera'} size="small" />
          <strong>{members.find((m) => m.id === 'meera')?.name ?? 'Meera'}</strong>
          <span className="mtile-sub">Product Designer · Sign-in mock-ups</span>
          <span className="mtile-chip">Meera’s Alter · listening</span>
        </div>
        <div className={`mtile ${tileGlow === 'arjun' ? 'is-live' : ''}`}>
          <Avatar name={members.find((m) => m.id === 'arjun')?.name ?? 'Arjun'} size="small" />
          <strong>{members.find((m) => m.id === 'arjun')?.name ?? 'Arjun'}</strong>
          <span className="mtile-sub">Backend Engineer · Auth endpoints</span>
          <span className="mtile-chip">Arjun’s Alter · listening</span>
        </div>
        <div className={`mtile mtile-alter ${tileGlow === 'rahul' ? 'is-live' : ''}`}>
          <div className="mtile-cube">R</div>
          <strong>{rahulName}’s Alter <AlterBadge /></strong>
          <span className="mtile-sub">In the room for {rahulName} — live voice, verified knowledge</span>
          <span className="mtile-chip alter">AI stand-in · speaking now<span className="eq" aria-hidden="true"><i /><i /><i /><i /><i /></span></span>
        </div>
        <div className="mtile mtile-ghost">
          <div className="mtile-avatar ghost">?</div>
          <strong>{rahulName}</strong>
          <span className="mtile-sub">On leave — not in this call</span>
          <span className="mtile-chip ghost">His Alter answers for him</span>
        </div>
      </div>

      <p className="stage-caption">{caption}{mic === 'listening' && !liveVoice ? <span className="stage-mic"> · ● Listening</span> : null}</p>

      <div className="stage-lower">
        <div className="stage-feed-card">
          <p className="eyebrow">Live transcript</p>
          {feed.length ? <ul className="stage-feed">{feed.map((line, i) => <li key={i}><strong>{line.who}</strong> {line.line}</li>)}</ul> : <p className="hint">The room is settling in…</p>}
        </div>
        <div className="stage-side">
          {latestAnswer && (
            <div className="latest-answer-bubble">
              <p className="eyebrow">Answer from {rahulName}&apos;s Alter</p>
              <p className="answer-text">{latestAnswer.answer}</p>
              <Citations sources={latestAnswer.citations} />
              {simulatedEscalation && (
                <div className="escalation-alert-toast">
                  <span className="alert-icon">⚑</span>
                  <div>
                    <strong>Priority notification sent to {rahulName}</strong>
                    <p className="hint">
                      Sent to {rahulName}&apos;s phone: &quot;Confirm launch date for Login Revamp (Asked in 2:00 PM Sync)&quot;
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <OnScreenTips tips={tips} title="Ask the room — out loud or tap" onSelectPrompt={handlePromptTrigger} />
          <div className="meet-url-box compact">
            <span className="url-label">Meet link</span>
            {editingUrl ? (
              <form
                className="url-edit-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  const input = (e.currentTarget.elements.namedItem('url') as HTMLInputElement).value
                  saveMeetUrl(input)
                }}
              >
                <input name="url" defaultValue={meetUrl} placeholder="https://meet.google.com/..." autoFocus />
                <button type="submit" className="primary">Save</button>
                <button type="button" onClick={() => setEditingUrl(false)}>Cancel</button>
              </form>
            ) : (
              <div className="url-display">
                <code>{meetUrl}</code>
                <button type="button" className="edit-btn" onClick={() => setEditingUrl(true)}>Change</button>
              </div>
            )}
          </div>
          {liveVoice && (
            <VoiceControl
              mode="huddle"
              targetId="rahul"
              autoStart
              onSpeaking={setSpeaking}
              onResult={(res) => setLatestAnswer(res as Answer)}
            />
          )}
        </div>
      </div>

      <AlterOrb
        state={orbSpeaking ? 'speaking' : sceneIdx >= 0 ? 'working' : mic === 'listening' && !liveVoice ? 'listening' : 'idle'}
        caption={orbSpeaking ? 'Rahul’s Alter is answering…' : 'Say what you need in the room — I’m handling it.'}
        label="Your Alter"
        onHome={onBack}
      />
    </section>
  )
}
