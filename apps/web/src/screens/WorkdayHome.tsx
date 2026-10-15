import { useState } from 'react'
import { Icon, Avatar } from '../components/Icon'
import { AlterBadge } from '../components/AlterBadge'
import { OnScreenTips, type TipItem } from '../components/OnScreenTips'
import type { Member, Approval } from '../api/types'

interface WorkdayHomeProps {
  name: string
  members: Member[]
  approvals: Approval[]
  onOpenMeet: () => void
  onOpenPlan: () => void
  onOpenAdmin: (screen: 'activity' | 'team' | 'files' | 'settings') => void
  onVoiceChat?: (prompt: string) => void
}

export function WorkdayHome({
  name,
  members,
  approvals,
  onOpenMeet,
  onOpenPlan,
  onOpenAdmin,
  onVoiceChat,
}: WorkdayHomeProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const greetingText = `Good afternoon ${name}. Here's what's on your agenda: The 2:00 PM Login Revamp Sync is starting now on Google Meet, and we have the Login Revamp UI architecture diagram ready for your review.`
  const rahulName = members.find((m) => m.id === 'rahul')?.name ?? 'Rahul'
  const pendingCount = approvals.filter((a) => a.state === 'proposed').length

  function playGreetingAudio() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(greetingText)
      utterance.rate = 1.05
      utterance.pitch = 1.0
      utterance.onstart = () => setIsPlayingAudio(true)
      utterance.onend = () => setIsPlayingAudio(false)
      utterance.onerror = () => setIsPlayingAudio(false)
      window.speechSynthesis.speak(utterance)
    } else {
      setIsPlayingAudio(true)
      setTimeout(() => setIsPlayingAudio(false), 3000)
    }
  }

  const tips: TipItem[] = [
    {
      type: 'do',
      text: "Click 'Join Team Sync' to hop into Google Meet with Rahul's Alter",
      action: onOpenMeet,
      highlight: true,
    },
    {
      type: 'do',
      text: "Click 'Work on Ongoing Plan' to inspect and edit the UI diagram by voice",
      action: onOpenPlan,
      highlight: true,
    },
    {
      type: 'say',
      text: "What's on my agenda today?",
      action: () => onVoiceChat?.("What's on my agenda today?"),
    },
    {
      type: 'say',
      text: 'Did Rahul confirm the launch date yet?',
      action: () => onVoiceChat?.('Did Rahul confirm the launch date yet?'),
    },
  ]

  return (
    <div className="workday-home">
      {/* Google Workspace Ambient Status Bar */}
      <div className="workspace-status-bar">
        <div className="workspace-apps">
          <span className="workspace-chip">
            <span className="google-dot dot-blue" /> Calendar
          </span>
          <span className="workspace-chip">
            <span className="google-dot dot-green" /> Meet
          </span>
          <span className="workspace-chip">
            <span className="google-dot dot-yellow" /> Docs
          </span>
          <span className="workspace-chip">
            <span className="google-dot dot-red" /> Drive
          </span>
          <span className="connection-status">● Connected to Google Workspace</span>
        </div>
        <div className="workspace-clock">
          <time>2:00 PM · Team Sync Starting Now</time>
        </div>
      </div>

      {/* Alter Intern Daily Briefing Card */}
      <section className="card alter-briefing-hero">
        <div className="briefing-left">
          <div className="briefing-avatar-wrap">
            <div className={`alter-cube-briefing ${isPlayingAudio ? 'is-speaking' : ''}`}>{name[0].toUpperCase()}</div>
            <span className="online-indicator" title="Connected and listening" />
          </div>
          <div className="briefing-content">
            <div className="briefing-tag">
              <span className="sparkle">✦</span> Your Personal AI Intern <AlterBadge />
            </div>
            <h2>{name}&apos;s Workday Briefing</h2>
            <p className="briefing-speech">&ldquo;{greetingText}&rdquo;</p>
            <div className="briefing-actions">
              <button
                type="button"
                className="voice-play-btn"
                onClick={playGreetingAudio}
                aria-label="Listen to Alter greeting"
              >
                <Icon name="mic" size={15} />
                {isPlayingAudio ? 'Speaking greeting…' : 'Hear Alter speak'}
              </button>
              <span className="briefing-meta">Connected to Google Calendar & Docs</span>
            </div>
          </div>
        </div>

        {/* Ambient Agenda Timeline */}
        <div className="briefing-timeline">
          <p className="eyebrow">Today&apos;s Schedule · Google Calendar</p>
          <div className="timeline-items">
            <div className="timeline-slot slot-past">
              <span className="time">09:30 AM</span>
              <div className="slot-info">
                <strong>Architecture Catchup</strong>
                <p>Status doc §1 updated</p>
              </div>
              <span className="slot-badge done">✓ Done</span>
            </div>

            <div className="timeline-slot slot-now">
              <span className="time">02:00 PM</span>
              <div className="slot-info">
                <strong>Login Revamp Team Sync</strong>
                <p>Google Meet · Rahul on leave</p>
              </div>
              <span className="slot-badge now">Now</span>
            </div>

            <div className="timeline-slot slot-future">
              <span className="time">03:30 PM</span>
              <div className="slot-info">
                <strong>Design Review · Meera</strong>
                <p>Mobile mock-ups sign-off</p>
              </div>
              <span className="slot-badge future">Upcoming</span>
            </div>
          </div>
        </div>
      </section>

      {/* Guidance Ribbon: Try Saying / Try Doing */}
      <OnScreenTips
        tips={tips}
        title="Judge Quick Guide: Choose a path below or try a prompt"
      />

      {/* The Two Hero Paths */}
      <section className="workday-hero-choices">
        {/* Card 1: Live Google Meet */}
        <div className="hero-choice-card card choice-meet" onClick={onOpenMeet}>
          <div className="choice-header">
            <span className="badge-live-meet">
              <span className="live-dot" /> Google Meet · Happening Now
            </span>
            <span className="choice-number">Option 01</span>
          </div>

          <h3>Join Team Sync (Google Meet)</h3>
          <p className="choice-description">
            Hop into a <strong>real Google Meet call</strong>. <strong>Rahul is on leave</strong>, but his Alter is
            present in the call on live video/audio to answer login architecture questions and escalate launch dates.
          </p>

          <div className="choice-roster-preview">
            <span className="roster-avatar-pill">
              <Avatar name="Rahul" size="small" /> Rahul&apos;s Alter (AI)
            </span>
            <span className="roster-avatar-pill">
              <Avatar name="Meera" size="small" /> Meera
            </span>
            <span className="roster-avatar-pill">
              <Avatar name="Arjun" size="small" /> Arjun
            </span>
          </div>

          <div className="choice-tip-hint">
            <strong>💡 What to try in the meeting:</strong>
            <p>&ldquo;Why did we switch to one-tap sign-in?&rdquo; or &ldquo;When are we launching?&rdquo;</p>
          </div>

          <button type="button" className="primary choice-cta-btn">
            <Icon name="work" size={17} /> Join Team Sync ↗
          </button>
        </div>

        {/* Card 2: Visual Ongoing Plan Canvas */}
        <div className="hero-choice-card card choice-plan" onClick={onOpenPlan}>
          <div className="choice-header">
            <span className="badge-plan">
              <Icon name="files" size={14} /> Ongoing Plan · Interactive Diagram
            </span>
            <span className="choice-number">Option 02</span>
          </div>

          <h3>Work on Ongoing Plan (UI Diagram)</h3>
          <p className="choice-description">
            Priya and Meera have drafted the <strong>Google One-Tap Login architecture flow</strong>.
            Inspect the visual diagram and <strong>edit it live using voice</strong> with on-screen prompt tips.
          </p>

          <div className="diagram-preview-thumb">
            <div className="thumb-node">App Entry</div>
            <span className="thumb-arrow">→</span>
            <div className="thumb-node thumb-active">Google One-Tap</div>
            <span className="thumb-arrow">→</span>
            <div className="thumb-node">Token Verify</div>
            <span className="thumb-arrow">→</span>
            <div className="thumb-node">Home</div>
          </div>

          <div className="choice-tip-hint">
            <strong>💡 What to try with voice:</strong>
            <p>&ldquo;Add biometric fallback to the mobile prompt&rdquo; or &ldquo;Include Meera&apos;s review&rdquo;</p>
          </div>

          <button type="button" className="primary choice-cta-btn">
            <Icon name="plus" size={17} /> Open Visual Plan & Edit by Voice ↗
          </button>
        </div>
      </section>

      {/* Autonomous Background Activity Feed */}
      <section className="card workday-intern-activity">
        <div className="activity-header">
          <div>
            <p className="eyebrow">Behind the Scenes · Personal Intern Actions</p>
            <h3>What Your Alter Handled Automatically</h3>
          </div>
          <div className="admin-drawer-triggers">
            <button
              type="button"
              className="chip text-btn"
              onClick={() => onOpenAdmin('activity')}
            >
              Audit Receipts
            </button>
            <button
              type="button"
              className="chip text-btn"
              onClick={() => onOpenAdmin('team')}
            >
              Team Rules
            </button>
            <button
              type="button"
              className="chip text-btn"
              onClick={() => onOpenAdmin('files')}
            >
              Google Drive Files
            </button>
          </div>
        </div>

        <div className="recent-activity-feed">
          <div className="activity-item">
            <span className="activity-dot dot-green" />
            <div className="activity-details">
              <strong>{name}&apos;s Alter ↔ {rahulName}&apos;s Alter (A2A Handoff)</strong>
              <p>Verified production status for ticket AUTH-112 without human chasing. {rahulName}&apos;s rules: allowed.{pendingCount > 0 ? ` · ${pendingCount} pending approval${pendingCount > 1 ? 's' : ''} in queue.` : ''}</p>
            </div>
            <time>1:42 PM</time>
          </div>

          <div className="activity-item">
            <span className="activity-dot dot-blue" />
            <div className="activity-details">
              <strong>Google Docs Sync · Login Revamp Status</strong>
              <p>Updated Section 2 with Google Identity Services rationale. Cited Oct 8 architecture sync.</p>
            </div>
            <time>1:15 PM</time>
          </div>

          <div className="activity-item">
            <span className="activity-dot dot-yellow" />
            <div className="activity-details">
              <strong>Calendar Sync & Agenda Preparation</strong>
              <p>Scheduled 2:00 PM Team Sync with Meera, Arjun, and Rahul&apos;s AI stand-in.</p>
            </div>
            <time>9:00 AM</time>
          </div>
        </div>
      </section>
    </div>
  )
}
