import { useState } from 'react'
import { api, MOCK } from '../api/client'
import type { Approval } from '../api/types'
import { AlterBadge } from './AlterBadge'
import { Citations } from './Citations'
import { externalUrl } from '../api/presentation'
import { VoiceControl } from './VoiceControl'
import { WorkPreview } from './WorkPreview'

const kinds = { doc_create: 'New document', doc_edit: 'Document update', sheet_update: 'Spreadsheet update', calendar_event: 'Calendar event', email: 'Email draft' }

export function ApprovalCard({ approval, onUpdate, voiceEnabled = true, allowRevision = true }: { approval: Approval; onUpdate: (a: Approval) => void; voiceEnabled?: boolean; allowRevision?: boolean }) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(action: 'revise' | 'approve' | 'reject') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const updated = action === 'revise'
        ? await api.revise(approval.id, instruction.trim())
        : await api.decide(approval.id, action, approval.revision)
      onUpdate(updated)
      if (action === 'revise') setInstruction('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this change. Please try again.') }
    finally { setBusy(false) }
  }
  const url = externalUrl(approval.externalUrl)
  return <article className="card approval-card" aria-label={approval.title} aria-busy={busy}>
    <div className="eyebrow">{kinds[approval.kind]} · Revision {approval.revision}</div>
    <h3>{approval.title}</h3>
    <p className="hint">Your Alter <AlterBadge /> · {approval.reason}</p>
    <WorkPreview approval={approval} />
    <Citations sources={approval.citations} />
    <p role="status" className={`approval-state state-${approval.state}`}>{approval.state === 'applied' ? (MOCK ? 'Applied in demo' : 'Applied') : approval.state === 'proposed' ? 'Needs your approval' : approval.state}</p>
    {url && <a href={url} target="_blank" rel="noreferrer">Open updated file ↗</a>}
    {approval.state === 'proposed' && <>
      {allowRevision && <form className="revision-form" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) void act('revise') }}>
        <label>Revision instructions<textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy} placeholder="What would you like to change?" /></label>
        <button disabled={busy || !instruction.trim()}>Revise proposal</button>
      </form>}
      {voiceEnabled && allowRevision && <VoiceControl mode="revise" targetId={approval.id} context={approval.title} onResult={(result) => { onUpdate(result as Approval); setInstruction('') }} />}
      <p className="hint">{MOCK ? 'Demo changes stay in this session. No Google files are changed.' : 'Approving applies the proposal shown above. Rejecting leaves the original unchanged.'}</p>
      <div className="actions"><button className="primary" disabled={busy} onClick={() => void act('approve')}>Approve</button><button disabled={busy} onClick={() => void act('reject')}>Reject</button></div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>
}
