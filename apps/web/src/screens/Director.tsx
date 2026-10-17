import { useState } from 'react'
import { api } from '../api/client'
import type { JoinResult } from '../api/types'

export function Director({ onJoined }: { onJoined: (join: JoinResult, name: string) => void }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [memberId, setMemberId] = useState('siddhi')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function claim(e: React.FormEvent) {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { const join = await api.directorClaim(workspaceId, memberId, key); setKey(''); onJoined(join, memberId[0].toUpperCase() + memberId.slice(1)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not claim this member.') }
    finally { setBusy(false) }
  }
  return <section className="screen"><h1>Video director mode</h1><p className="hint">For the staged recording workspace only.</p><form className="join" onSubmit={claim}><label>Workspace ID<input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} required /></label><label>Role<select value={memberId} onChange={(e) => setMemberId(e.target.value)}>{['siddhi', 'dev', 'kani', 'sahil'].map((id) => <option key={id}>{id}</option>)}</select></label><label>Director key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} required autoComplete="off" /></label><button disabled={busy}>Claim role</button></form>{error && <p className="error" role="alert">{error}</p>}</section>
}
