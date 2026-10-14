import { useState } from 'react'
import { api } from '../api/client'
import type { JoinResult } from '../api/types'

export function Join({ inviteCode, onJoined }: { inviteCode?: string; onJoined: (r: JoinResult, name: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = inviteCode ? await api.joinWorkspace(inviteCode, name) : await api.createWorkspace(name)
    onJoined(r, name)
  }

  return (
    <form className="screen join" onSubmit={submit}>
      <h1>Alter</h1>
      <p>Your own AI representative at work. It answers for you, asks teammates' Alters, and acts in Google Docs, Sheets, Calendar and Gmail when you approve.</p>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <p className="hint">You'll join the Login revamp team as QA lead. Your Alter starts with the team's QA notes.</p>
      <button disabled={busy || !name.trim()}>{busy ? 'Setting up your team…' : 'Get my Alter'}</button>
    </form>
  )
}
