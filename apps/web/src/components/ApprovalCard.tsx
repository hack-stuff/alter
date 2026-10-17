import { useState } from 'react'
import { api, MOCK } from '../api/client'
import type { Approval } from '../api/types'
import { AlterBadge } from './AlterBadge'
import { Citations } from './Citations'
import { externalUrl } from '../api/presentation'
import { VoiceControl } from './VoiceControl'
import { WorkPreview } from './WorkPreview'
import { AppIcon } from './AppIcon'
import { approvalApp } from './apps'
import { Icon } from './Icon'

const kinds = { doc_create: 'New document', doc_edit: 'Document update', sheet_update: 'Spreadsheet update', calendar_event: 'Calendar event', email: 'Email draft' }
const stateText = (state: Approval['state']) => state === 'applied' ? (MOCK ? 'Applied in demo' : 'Applied') : state === 'proposed' ? 'Needs your approval' : state === 'approved' ? 'Approved · applying' : state === 'rejected' ? 'Rejected' : 'Failed'

export function ApprovalCard({ approval, onUpdate, voiceEnabled = true, allowRevision = true }: { approval: Approval; onUpdate: (a: Approval) => void; voiceEnabled?: boolean; allowRevision?: boolean }) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revising, setRevising] = useState(false)
  async function act(action: 'revise' | 'approve' | 'reject') {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const updated = action === 'revise'
        ? await api.revise(approval.id, instruction.trim())
        : await api.decide(approval.id, action, approval.revision)
      onUpdate(updated)
      if (action === 'revise') { setInstruction(''); setRevising(false) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this change. Please try again.') }
    finally { setBusy(false) }
  }
  const url = externalUrl(approval.externalUrl)
  return <article className={`sheet approval-card state-${approval.state}`} aria-label={approval.title} aria-busy={busy} tabIndex={-1} data-nav-id={approval.id} data-nav-kind={approval.kind} data-nav-label={approval.title}>
    <header className="approval-head">
      <span className="approval-kind"><AppIcon app={approvalApp[approval.kind]} />{kinds[approval.kind]} · Revision {approval.revision}</span>
      <p role="status" className={`state-pill state-${approval.state}`}>{stateText(approval.state)}</p>
    </header>
    <h3>{approval.title}</h3>
    <p className="drafted-by"><span className="alter-glyph" aria-hidden="true">✦</span>Drafted by your Alter <AlterBadge /> · {approval.reason}</p>
    <WorkPreview approval={approval} />
    <Citations sources={approval.citations} />
    {url && <a className="source-pill is-result" href={url} target="_blank" rel="noreferrer"><AppIcon app={approvalApp[approval.kind]} />Open updated file ↗</a>}
    {approval.state === 'proposed' && <>
      <p className="hint">{MOCK ? 'Demo changes stay in this session. No Google files are changed.' : approval.kind === 'email' ? 'Approving sends this email. Rejecting discards the draft.' : 'Approving applies the change shown above. Rejecting leaves the original unchanged.'}</p>
      {voiceEnabled && <p className="voice-lock"><Icon name="mic" size={14} />Or tell your Alter: “{approval.kind === 'email' ? 'send it' : 'approve it'}” or “reject it”</p>}
      <div className="decision-buttons">
        <button className="approve" disabled={busy} onClick={() => void act('approve')}>Approve</button>
        {allowRevision && <button type="button" aria-expanded={revising} disabled={busy} onClick={() => setRevising(!revising)}>Revise</button>}
        <button className="reject" disabled={busy} onClick={() => void act('reject')}>Reject</button>
      </div>
      {allowRevision && revising && <div className="revise-panel">
        <form className="revision-form" onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) void act('revise') }}>
          <label>Revision instructions<textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy} placeholder="What would you like to change?" autoFocus /></label>
          <button disabled={busy || !instruction.trim()}>Revise proposal</button>
        </form>
        {voiceEnabled && <VoiceControl mode="revise" targetId={approval.id} context={approval.title} onResult={(result) => { onUpdate(result as Approval); setInstruction(''); setRevising(false) }} />}
      </div>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>
}
