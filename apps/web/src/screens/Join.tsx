import { useState } from 'react'
import { api, MOCK, httpCall } from '../api/client'
import type { JoinResult } from '../api/types'
import { Icon } from '../components/Icon'
import { PersonWithAlter } from '../components/People'
import { AlterAvatarPreview } from '../components/avatar/AlterAvatarPreview'

// The seeded scenario team, shown so a first-time visitor knows who they will meet.
const TEAM = [
  { name: 'Kani', role: 'Designer' },
  { name: 'Sahil', role: 'Engineer' },
  { name: 'Siddhi', role: 'Login owner · on leave', away: true },
]

export function Join({ inviteCode, onJoined }: { inviteCode?: string; onJoined: (r: JoinResult, name: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = inviteCode ? await api.joinWorkspace(inviteCode, name.trim()) : await api.createWorkspace(name.trim())
      onJoined(r, name.trim())
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not join. Please try again.') }
    finally { setBusy(false) }
  }
  function stepIn() {
    setBusy(true); setError('')
    void httpCall<JoinResult>('POST', '/demo/day').then((result) => onJoined(result, 'Dev')).catch((e) => setError(e.message)).finally(() => setBusy(false))
  }
  const demo = !inviteCode && !MOCK

  return <div className="join">
    <div className="join-intro">
      <p className="brand-line"><span className="brand-mark" aria-hidden="true">A</span>Alter</p>
      <h1>A little more room to get things done.</h1>
      <p className="lede">Everyone on the team gets their own Alter: an AI representative that answers within the limits you set and does the work in Google Docs, Sheets and Calendar. Emails go out only when you say so.</p>
    </div>

    {demo && <section className="sheet id-card" aria-label="Dev's workday">
      <div className="id-card-head">
        <PersonWithAlter name="Dev" size="large" />
        <div><p className="eyebrow">You’ll be</p><h2>Dev</h2><p className="hint">Product lead · Login revamp</p></div>
      </div>
      <ul className="team-row" aria-label="Your teammates">
        {TEAM.map((member) => <li key={member.name} className={member.away ? 'is-away' : undefined}>
          <PersonWithAlter name={member.name} size="small" status={member.away ? 'on_leave' : 'available'} />
          <span><strong>{member.name}</strong><small>{member.role}{member.away && <> · <span className="alter-text">Alter active</span></>}</small></span>
        </li>)}
      </ul>
      <button type="button" className="primary step-in" disabled={busy} onClick={stepIn}><Icon name="play" size={16} />{busy ? 'Preparing your day…' : 'Step into Dev’s day'}</button>
      <p className="hint">A fictional workday with your own isolated project files. The connected build uses real AI and Google services.</p>
    </section>}

    <form className={`sheet join-form${demo ? ' is-secondary' : ''}`} onSubmit={submit}>
      <h2>{inviteCode ? 'Join your team' : demo ? 'Or join as yourself' : 'Get your Alter'}</h2>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!demo} disabled={busy} autoComplete="name" />
      </label>
      <p className="hint">{inviteCode ? 'Join your teammates’ team. Your Alter starts with notes for your role.' : "You'll join the Login revamp team as QA lead. Your Alter starts with the team's QA notes."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className={demo ? '' : 'primary'} disabled={busy || !name.trim()}>{busy ? 'Setting up your team…' : 'Get my Alter'}</button>
      {!inviteCode && <p className="hint">Have an invite link? Open it to join that team.</p>}
    </form>

    <AlterAvatarPreview />
  </div>
}
