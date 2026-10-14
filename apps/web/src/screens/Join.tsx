import { useState } from 'react'
import { api } from '../api/client'
import type { JoinResult } from '../api/types'

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

  return (
    <form className="screen join" onSubmit={submit}>
      <h1>Alter</h1>
      <p>Your own AI representative at work. It answers for you, asks teammates' Alters, and acts in Google Docs, Sheets, Calendar and Gmail when you approve.</p>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={busy} />
      </label>
      <p className="hint">{inviteCode ? 'Join your teammates in their workspace. Your Alter starts with notes for your role.' : "You'll join the Login revamp team as QA lead. Your Alter starts with the team's QA notes."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !name.trim()}>{busy ? 'Setting up your team…' : 'Get my Alter'}</button>
    </form>
  )
}
