import { useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { api, MOCK, httpCall } from '../api/client'
import type { JoinResult } from '../api/types'
import { pretendsToBeSiddhi, SIDDHI_TAKEN } from '../api/presentation'
import { Icon } from '../components/Icon'
import { AlterAvatar, PersonWithAlter } from '../components/People'
import { AlterAvatarPreview } from '../components/avatar/AlterAvatarPreview'

// The seeded scenario team, shown so a first-time visitor knows who they will meet.
const TEAM = [
  { name: 'Kani', role: 'Designer' },
  { name: 'Sahil', role: 'Engineer' },
  { name: 'Ansh', role: 'Analyst' },
  { name: 'Siddhi', role: 'Login owner · on leave', away: true },
]

export function Join({ inviteCode, onJoined }: { inviteCode?: string; onJoined: (r: JoinResult, name: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim()) return
    if (pretendsToBeSiddhi(name)) { setError(SIDDHI_TAKEN); return }
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
      <div className="join-top"><p className="brand-line"><BrandMark />Alter</p><ThemeToggle /></div>
      <h1>Your work, covered.</h1>
    </div>

    <section className="sheet join-card" aria-label={demo ? "Dev's workday" : undefined}>
      {demo && <>
        <div className="id-card-head">
          <PersonWithAlter name="Dev" />
          <div><p className="eyebrow">You’ll be</p><h2>Dev</h2><p className="hint">Product lead · Login revamp</p></div>
        </div>
        <ul className="team-row" aria-label="Your teammates">
          {TEAM.map((member) => <li key={member.name} className={member.away ? 'is-away' : undefined}>
            <PersonWithAlter name={member.name} size="small" status={member.away ? 'on_leave' : 'available'} />
            <strong>{member.name}</strong>
            <small>{member.away ? <span className="alter-text">On leave</span> : member.role}</small>
          </li>)}
        </ul>
        <button type="button" className="primary step-in" disabled={busy} onClick={stepIn}><Icon name="play" size={16} />{busy ? 'Preparing your day…' : 'Step into Dev’s day'}</button>
        <p className="join-or"><span>or use your own name</span></p>
      </>}

      <form className="join-form" onSubmit={submit}>
        {!demo && <h2>{inviteCode ? 'Join your team' : 'Get your Alter'}</h2>}
        <label>
          Your name
          <span className="name-field">
            <span className="name-input">
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!demo} disabled={busy} autoComplete="name" />
              {name.trim() && <button className="primary name-go" aria-label="Continue" title={busy ? 'Setting up your team…' : 'Continue'} disabled={busy}><Icon name="arrow" size={18} /></button>}
            </span>
            <AlterAvatar name={name.trim() || '?'} variant="paired-offset" size="sm" className={name.trim() ? undefined : 'is-blank'} />
          </span>
        </label>
        {name.trim() && <AlterAvatarPreview name={name.trim()} />}
        {error && <p className="error" role="alert">{error}</p>}
        {busy && <p className="hint" role="status">Setting up your team…</p>}
      </form>
    </section>
  </div>
}
