import { useState } from 'react'
import { Icon, Avatar } from '../components/Icon'
import { AlterBadge } from '../components/AlterBadge'
import { OnScreenTips, type TipItem } from '../components/OnScreenTips'
import { VoiceControl } from '../components/VoiceControl'
import { Citations } from '../components/Citations'
import type { Answer, Member } from '../api/types'

export function MeetCompanion({
  members,
  onBack,
}: {
  members: Member[]
  onBack: () => void
}) {
  const [meetUrl, setMeetUrl] = useState<string>(
    () => localStorage.getItem('alter.demo.meet_url') || 'https://meet.google.com/new'
  )
  const [editingUrl, setEditingUrl] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [latestAnswer, setLatestAnswer] = useState<Answer | null>(null)
  const [simulatedEscalation, setSimulatedEscalation] = useState(false)

  function saveMeetUrl(url: string) {
    const trimmed = url.trim() || 'https://meet.google.com/new'
    setMeetUrl(trimmed)
    localStorage.setItem('alter.demo.meet_url', trimmed)
    setEditingUrl(false)
  }

  function handlePromptTrigger(promptText: string) {
    const text = promptText.toLowerCase()
    if (text.includes('launch') || text.includes('date') || text.includes('when')) {
      setLatestAnswer({
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
      })
      setSimulatedEscalation(true)
    } else if (text.includes('why') || text.includes('one-tap') || text.includes('button')) {
      setLatestAnswer({
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
      })
      setSimulatedEscalation(false)
    } else if (text.includes('auth-112') || text.includes('prod') || text.includes('approved')) {
      setLatestAnswer({
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
      })
      setSimulatedEscalation(false)
    }
  }

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

  return (
    <section className="screen meet-companion-screen">
      <div className="canvas-header">
        <button type="button" className="back-link-btn" onClick={onBack}>
          ← Back to Priya's Workday
        </button>
        <div className="plan-title-block">
          <p className="eyebrow">Google Meet Integration · Live Team Sync</p>
          <h2>Team Sync (Google Meet) — Rahul&apos;s Stand-in</h2>
          <p className="hint">
            Rahul is on leave. His Alter is standing in with his verified knowledge and decision boundaries.
          </p>
        </div>
        <div className="canvas-header-actions">
          <a
            href={meetUrl}
            target="_blank"
            rel="noreferrer"
            className="primary button icon-button join-meet-hero-btn"
          >
            <Icon name="work" size={18} /> Join Google Meet Call ↗
          </a>
        </div>
      </div>

      <OnScreenTips
        tips={tips}
        title="Tips for asking questions in Meet"
        onSelectPrompt={handlePromptTrigger}
      />

      <div className="meet-layout-grid">
        {/* Left Side: Real Meet Gateway & Room Configuration */}
        <div className="meet-gateway-card card">
          <div className="meet-banner">
            <div className="live-pulse-badge">
              <span className="pulse-dot" /> LIVE GOOGLE MEET
            </div>
            <h3>Join with any device</h3>
            <p className="hint">
              Anyone with this link can join the real Google Meet call. Rahul&apos;s Alter is logged in as a
              participant with an animated avatar and live voice.
            </p>
          </div>

          <div className="meet-url-box">
            <span className="url-label">Google Meet Link:</span>
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
                <button type="button" className="edit-btn" onClick={() => setEditingUrl(true)}>
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Meeting Room Roster */}
          <div className="meet-roster">
            <h4>Call Participants ({members.length ? members.length : 4})</h4>
            <div className="roster-list">
              <div className="roster-item">
                <Avatar name="Priya" size="small" />
                <div>
                  <strong>Priya (You)</strong>
                  <p className="hint">Product Lead · Organizer</p>
                </div>
              </div>

              <div className="roster-item alter-roster-item">
                <div className="avatar-cube-small">R</div>
                <div>
                  <strong>
                    {members.find((m) => m.id === 'rahul')?.name ?? 'Rahul'}&apos;s Alter <AlterBadge />
                  </strong>
                  <p className="hint">{members.find((m) => m.id === 'rahul')?.role ?? 'Senior Engineer'} · AI stand-in</p>
                </div>
                <span className="status-pill active">In Call</span>
              </div>

              <div className="roster-item">
                <Avatar name={members.find((m) => m.id === 'meera')?.name ?? 'Meera'} size="small" />
                <div>
                  <strong>{members.find((m) => m.id === 'meera')?.name ?? 'Meera'}</strong>
                  <p className="hint">{members.find((m) => m.id === 'meera')?.role ?? 'Product Designer'} · Sign-in mock-ups</p>
                </div>
              </div>

              <div className="roster-item">
                <Avatar name={members.find((m) => m.id === 'arjun')?.name ?? 'Arjun'} size="small" />
                <div>
                  <strong>{members.find((m) => m.id === 'arjun')?.name ?? 'Arjun'}</strong>
                  <p className="hint">{members.find((m) => m.id === 'arjun')?.role ?? 'Backend Engineer'} · Auth endpoints</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: In-App Companion HUD & Live Voice Tester */}
        <div className="meet-hud-card card">
          <div className="hud-header">
            <h4>Live Meeting HUD & In-App Voice</h4>
            <span className="hud-indicator">
              {speaking ? 'Rahul’s Alter is Speaking' : 'Listening for questions…'}
            </span>
          </div>

          {/* Speaking Visualizer Avatar */}
          <div className={`meet-avatar-stage ${speaking ? 'is-speaking' : ''}`}>
            <div
              className="alter-cube"
              style={{
                transform: `scale(${1 + voiceLevel * 0.1})`,
                boxShadow: speaking ? `0 0 ${20 + voiceLevel * 30}px rgba(133, 166, 234, 0.5)` : undefined,
              }}
            >
              R
            </div>
            <div className="avatar-label">
              <strong>Rahul&apos;s Alter <AlterBadge /></strong>
              <span>Representing Rahul (Senior Engineer · On Leave)</span>
            </div>
          </div>

          {/* Embedded Voice Control for In-App Live Interaction */}
          <div className="in-app-voice-bar">
            <VoiceControl
              mode="huddle"
              targetId="rahul"
              onSpeaking={setSpeaking}
              onLevel={setVoiceLevel}
              onResult={(res) => setLatestAnswer(res as Answer)}
            />
          </div>

          {/* Latest Answer & Escalation Result */}
          {latestAnswer && (
            <div className="latest-answer-bubble">
              <p className="eyebrow">Answer from Rahul&apos;s Alter</p>
              <p className="answer-text">{latestAnswer.answer}</p>
              <Citations sources={latestAnswer.citations} />

              {simulatedEscalation && (
                <div className="escalation-alert-toast">
                  <span className="alert-icon">⚑</span>
                  <div>
                    <strong>Priority notification sent to Rahul</strong>
                    <p className="hint">
                      Sent to Rahul&apos;s phone: &quot;Confirm launch date for Login Revamp (Asked in 2:00 PM Sync)&quot;
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
